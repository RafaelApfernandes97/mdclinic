import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enviarManual } from '../src/envioManual.js';
import { criarStore } from '../src/store.js';

function storeComItem(extra = {}) {
  const s = criarStore(':memory:');
  s.upsertAgendaItem({
    id_agendamento: 1, data_lote: '2026-06-24', id_usuario: 7, nome_medico: 'Dra. Marina',
    id_paciente: 9, nome_paciente: 'Joao', telefone: '5534999998888',
    inicio: '2026-06-24T10:00:00', elegivel: 1, motivo: null, descricao: 'Joao',
    capturado_em: '2026-06-23T08:00:00Z', ...extra,
  });
  return s;
}
const cfg = (over = {}) => ({
  templateNome: 'confirmacao_agendamento',
  templateVariaveis: ['nome', 'medico', 'data', 'hora'], dryRun: false, ...over,
});

test('enviarManual envia e registra (DRY_RUN=false)', async () => {
  const store = storeComItem();
  const enviados = [];
  const maischat = { sendTemplate: async (p) => { enviados.push(p); return { idMensagem: 'w1' }; } };
  const r = await enviarManual({ maischat, store, config: cfg(), idAgendamento: 1, agora: new Date('2026-06-23T09:00:00Z') });
  assert.equal(r.ok, true);
  assert.equal(r.enviado, true);
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].variaveis, ['Joao', 'Marina', '24/06/2026', '10:00']);
  assert.equal(store.jaEnviado(1), true);
});

test('enviarManual suporta variáveis dia e hora_curta (template MD Infusion)', async () => {
  const store = storeComItem({ inicio: '2026-06-24T14:30:00' });
  const enviados = [];
  const maischat = { sendTemplate: async (p) => { enviados.push(p); return { idMensagem: 'w2' }; } };
  const config = cfg({ templateVariaveis: ['nome', 'dia', 'hora_curta'] });
  const r = await enviarManual({ maischat, store, config, idAgendamento: 1, agora: new Date('2026-06-23T09:00:00Z') });
  assert.equal(r.ok, true);
  // 2026-06-24 é quarta-feira; 14:30 mantém os minutos
  assert.deepEqual(enviados[0].variaveis, ['Joao', 'Quarta-feira 24/06', '14:30']);
});

test('enviarManual usa o template próprio da agenda quando houver', async () => {
  const store = storeComItem({ nome_medico: 'Dra Livia Araujo', inicio: '2026-06-24T08:00:00' });
  const enviados = [];
  const maischat = { sendTemplate: async (p) => { enviados.push(p); return { idMensagem: 'w3' }; } };
  // 06:00 BRT => "Bom dia"
  const r = await enviarManual({ maischat, store, config: cfg(), idAgendamento: 1, agora: new Date('2026-06-23T09:00:00Z') });
  assert.equal(r.ok, true);
  assert.equal(enviados[0].template, 'confirmar_dralivia');
  assert.deepEqual(enviados[0].variaveis, ['Bom dia', '24/06', '08:00']);
});

test('enviarManual com DRY_RUN=true só simula (não envia, não registra)', async () => {
  const store = storeComItem();
  let chamou = false;
  const maischat = { sendTemplate: async () => { chamou = true; return { idMensagem: 'x' }; } };
  const r = await enviarManual({ maischat, store, config: cfg({ dryRun: true }), idAgendamento: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  assert.equal(r.enviado, false);
  assert.equal(chamou, false);
  assert.equal(store.jaEnviado(1), false);
});

test('enviarManual recusa reenvio de agendamento já enviado — só pendentes (409)', async () => {
  const store = storeComItem();
  let chamou = false;
  const maischat = { sendTemplate: async () => { chamou = true; return { idMensagem: 'w1' }; } };
  await enviarManual({ maischat, store, config: cfg(), idAgendamento: 1 });
  chamou = false;
  const r = await enviarManual({ maischat, store, config: cfg(), idAgendamento: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(chamou, false);
});

test('enviarManual permite reenviar após falha (falha não é "enviado")', async () => {
  const store = storeComItem();
  const maischat = { sendTemplate: async () => { throw new Error('boom'); } };
  await enviarManual({ maischat, store, config: cfg(), idAgendamento: 1 });
  maischat.sendTemplate = async () => ({ idMensagem: 'w2' });
  const r = await enviarManual({ maischat, store, config: cfg(), idAgendamento: 1 });
  assert.equal(r.ok, true);
  assert.equal(store.jaEnviado(1), true);
});

test('enviarManual recusa não elegível (400)', async () => {
  const store = storeComItem({ id_agendamento: 2, elegivel: 0, motivo: 'sem_telefone', telefone: null });
  const maischat = { sendTemplate: async () => ({ idMensagem: 'x' }) };
  const r = await enviarManual({ maischat, store, config: cfg(), idAgendamento: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('enviarManual: erro do Mais Chat registra falha e retorna 502', async () => {
  const store = storeComItem();
  const maischat = { sendTemplate: async () => { throw new Error('boom'); } };
  const r = await enviarManual({ maischat, store, config: cfg(), idAgendamento: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 502);
  assert.equal(store.jaEnviado(1), false);
});

test('enviarManual: agendamento inexistente retorna 404', async () => {
  const store = storeComItem();
  const r = await enviarManual({ maischat: { sendTemplate: async () => ({}) }, store, config: cfg(), idAgendamento: 999 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});

function capturarLog(fn) {
  const linhas = []; const orig = console.log; console.log = (...a) => linhas.push(a.join(' '));
  return Promise.resolve(fn()).finally(() => { console.log = orig; }).then(() => linhas.join('\n'));
}

test('enviarManual loga o acionamento e o ENVIADO com wamid', async () => {
  const store = storeComItem();
  const maischat = { sendTemplate: async () => ({ idMensagem: 'wamid.M1' }) };
  const txt = await capturarLog(() => enviarManual({ maischat, store, config: cfg(), idAgendamento: 1 }));
  assert.match(txt, /\[envio-manual\].*acionado.*1/);
  assert.match(txt, /\[envio-manual\].*ENVIADO.*wamid\.M1/);
});

test('enviarManual loga DRY_RUN simulado', async () => {
  const store = storeComItem();
  const maischat = { sendTemplate: async () => ({ idMensagem: 'x' }) };
  const txt = await capturarLog(() => enviarManual({ maischat, store, config: cfg({ dryRun: true }), idAgendamento: 1 }));
  assert.match(txt, /\[envio-manual\].*(DRY_RUN|simulado)/i);
});
