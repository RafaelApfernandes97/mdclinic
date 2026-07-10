import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verificarPassesPendentes, iniciarScheduler, executarSeDiaUtil } from '../src/scheduler.js';
import { criarStore } from '../src/store.js';

const base = {
  id_paciente: 1, nome_paciente: 'x', telefone: '55', id_usuario: 1, nome_medico: 'Dr',
  inicio: '2026-06-22T10:00:00', status_envio: 'enviado', ack: 'enviado',
  data_envio: '2026-06-21T08:00:00Z', data_lote: '2026-06-22', erro: null,
};

test('verificarPassesPendentes roda passes vencidos', async () => {
  const store = criarStore(':memory:');
  store.registrarEnvio({ ...base, id_agendamento: 1, id_mensagem: 'a' });
  store.criarLote({ data_lote: '2026-06-22', fim_campanha: 'x',
    passe1_em: '2026-06-21T08:05:00Z', passe2_em: '2026-06-21T09:00:00Z' });
  const maischat = { getStatusMensagem: async () => ({ ack: 'lido' }) };
  const n = await verificarPassesPendentes({ store, maischat, agoraIso: '2026-06-21T08:06:00Z' });
  assert.equal(n, 1); // só passe1 venceu
  store.fechar();
});

test('executarSeDiaUtil não envia no fim de semana', async () => {
  let chamou = false;
  const executarEnvio = async () => { chamou = true; return { enviados: 1 }; };
  const r = await executarSeDiaUtil({ executarEnvio, agora: new Date('2026-07-11T12:00:00Z') }); // sábado
  assert.equal(chamou, false);
  assert.deepEqual(r, { ignorado: 'fim_de_semana' });
});

test('executarSeDiaUtil envia em dia útil', async () => {
  let chamou = false;
  const executarEnvio = async () => { chamou = true; return { enviados: 1 }; };
  const r = await executarSeDiaUtil({ executarEnvio, agora: new Date('2026-07-10T12:00:00Z') }); // sexta
  assert.equal(chamou, true);
  assert.deepEqual(r, { enviados: 1 });
});

test('iniciarScheduler registra dois crons', () => {
  const agendados = [];
  const cron = { schedule: (expr, fn, opts) => { agendados.push({ expr, opts }); return { start() {} }; } };
  iniciarScheduler({
    cron, config: { cronHorario: '0 8 * * *' },
    executarEnvio: async () => {}, verificarPasses: async () => {},
  });
  assert.equal(agendados.length, 2);
  assert.equal(agendados[0].expr, '0 8 * * *');
  assert.equal(agendados[0].opts.timezone, 'America/Sao_Paulo');
});
