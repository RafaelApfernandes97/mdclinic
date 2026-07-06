import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executarJobEnvio } from '../src/job.js';
import { criarStore } from '../src/store.js';

function deps(overrides = {}) {
  const agenda = [
    { Id_Agendamento: 1, Id_Paciente: 9, Id_Usuario: 7, SMS: '34999998888',
      Descricao: 'JOAO, obs', Inicio: '2026-06-22T10:00:00' },
    { Id_Agendamento: 2, Id_Paciente: 0, Id_Usuario: 7, SMS: '', // inelegível
      Descricao: 'FECHADA', Inicio: '2026-06-22T11:00:00' },
  ];
  const enviados = [];
  const medx = {
    getAgenda: async () => agenda,
    getUsuarios: async () => [{ Id_Usuario: 7, Nome: 'Dra. Marina' }],
  };
  const maischat = {
    sendTemplate: async (p) => { enviados.push(p); return { idMensagem: 'm-' + enviados.length }; },
  };
  const store = criarStore(':memory:');
  const config = {
    templateNome: 'confirmacao_agendamento',
    templateVariaveis: ['nome', 'medico', 'data', 'hora'],
    ackPasse1Min: 5, ackPasse2Min: 60,
    medicoCampoNome: 'Nome',
  };
  return { medx, maischat, store, config, enviados, ...overrides };
}

test('envia só elegíveis e registra', async () => {
  const d = deps();
  const r = await executarJobEnvio({ ...d, agora: new Date('2026-06-21T11:00:00Z') });
  assert.equal(r.enviados, 1);
  assert.equal(d.enviados.length, 1);
  assert.deepEqual(d.enviados[0].variaveis, ['JOAO', 'Marina', '22/06/2026', '10:00']);
  assert.equal(d.store.jaEnviado(1), true);
});

test('suporta variáveis dia e hora_curta (template MD Infusion)', async () => {
  const d = deps();
  d.config.templateVariaveis = ['nome', 'dia', 'hora_curta'];
  await executarJobEnvio({ ...d, agora: new Date('2026-06-21T11:00:00Z') });
  // 2026-06-22 é segunda-feira; 10:00 => "10"
  assert.deepEqual(d.enviados[0].variaveis, ['JOAO', 'Segunda-feira 22/06', '10']);
  assert.equal(d.enviados[0].template, 'confirmacao_agendamento'); // fallback = template do .env
});

test('agenda com template próprio usa o template e as variáveis do médico', async () => {
  const d = deps();
  d.medx.getUsuarios = async () => [{ Id_Usuario: 7, Nome: 'dramarinadedeus' }];
  // 08:00 BRT => "Bom dia"
  await executarJobEnvio({ ...d, agora: new Date('2026-06-21T11:00:00Z') });
  assert.equal(d.enviados[0].template, 'confirmar_dramarina');
  assert.deepEqual(d.enviados[0].variaveis, ['Bom dia', 'JOAO', '22/06', '10h']);
});

test('não reenvia já enviado', async () => {
  const d = deps();
  const agora = new Date('2026-06-21T11:00:00Z');
  await executarJobEnvio({ ...d, agora });
  const r2 = await executarJobEnvio({ ...d, agora });
  assert.equal(r2.enviados, 0);
});

test('DRY_RUN: snapshot da agenda mas nenhum envio', async () => {
  const d = deps({ config: {
    templateVariaveis: ['nome', 'medico', 'data', 'hora'],
    ackPasse1Min: 5, ackPasse2Min: 60, medicoCampoNome: 'Nome', dryRun: true,
  } });
  const r = await executarJobEnvio({ ...d, agora: new Date('2026-06-21T11:00:00Z') });
  // nada enviado
  assert.equal(d.enviados.length, 0);
  assert.equal(r.enviados, 0);
  assert.equal(r.simulados, 1); // 1 elegível seria enviado
  assert.equal(r.dryRun, true);
  // mas a agenda completa foi capturada (snapshot) e o elegível NÃO ficou "enviado"
  const ag = d.store.agendaCompleta('2026-06-22');
  assert.equal(ag.length, 2);
  assert.equal(d.store.jaEnviado(1), false);
});

test('erro em um envio não derruba o lote', async () => {
  const d = deps({
    maischat: { sendTemplate: async () => { throw new Error('falhou'); } },
  });
  const r = await executarJobEnvio({ ...d, agora: new Date('2026-06-21T11:00:00Z') });
  assert.equal(r.erros, 1);
  assert.equal(r.enviados, 0);
});

test('grava snapshot completo da agenda (elegíveis + pulados)', async () => {
  const d = deps();
  await executarJobEnvio({ ...d, agora: new Date('2026-06-21T11:00:00Z') });
  // deps() usa GetAgenda com data_lote = amanhã de 2026-06-21 = 2026-06-22
  const ag = d.store.agendaCompleta('2026-06-22');
  assert.equal(ag.length, 2); // 1 elegível + 1 bloqueio
  const bloqueio = ag.find((x) => x.motivo === 'bloqueio');
  assert.ok(bloqueio);
  assert.equal(bloqueio.elegivel, 0);
  const enviado = ag.find((x) => x.elegivel === 1);
  assert.equal(enviado.ack, 'enviado'); // veio do join com envios
});
