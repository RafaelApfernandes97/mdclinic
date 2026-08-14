import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarEnvioMassa } from '../src/envioMassa.js';
import { criarStore } from '../src/store.js';

const cfg = (over = {}) => ({
  templateNome: 'confirmacao_agendamento',
  templateVariaveis: ['nome', 'medico', 'data', 'hora'],
  medicoCampoNome: 'Nome',
  ackPasse1Min: 5, ackPasse2Min: 60,
  dryRun: false, ...over,
});

// Agenda MedX com: 2 pendentes da Marina (dias diferentes), 1 desmarcado,
// 1 de outro médico e 1 da Marina já enviado (registrado antes do job).
function medxFake() {
  return {
    getAgenda: async () => ([
      { Id_Agendamento: 1, Id_Paciente: 11, Id_Usuario: 7, SMS: '34999990001', Descricao: 'ANA', Inicio: '2026-07-01T09:00:00', Status: 1 },
      { Id_Agendamento: 2, Id_Paciente: 12, Id_Usuario: 7, SMS: '34999990002', Descricao: 'BIA', Inicio: '2026-07-02T10:00:00', Status: 1 },
      { Id_Agendamento: 3, Id_Paciente: 13, Id_Usuario: 7, SMS: '34999990003', Descricao: 'CLARA', Inicio: '2026-07-01T11:00:00', Status: 0 },
      { Id_Agendamento: 4, Id_Paciente: 14, Id_Usuario: 8, SMS: '34999990004', Descricao: 'DAVI', Inicio: '2026-07-01T12:00:00', Status: 1 },
      { Id_Agendamento: 5, Id_Paciente: 15, Id_Usuario: 7, SMS: '34999990005', Descricao: 'EVA', Inicio: '2026-07-01T13:00:00', Status: 1 },
    ]),
    getUsuarios: async () => ([
      { Id_Usuario: 7, Nome: 'Dra. Marina' },
      { Id_Usuario: 8, Nome: 'Dr. Carlos' },
    ]),
  };
}

function registrarEnvioPrevio(store, id, extra = {}) {
  store.registrarEnvio({
    id_agendamento: id, id_paciente: 15, nome_paciente: 'EVA', telefone: '5534999990005',
    id_usuario: 7, nome_medico: 'Dra Marina', inicio: '2026-07-01T13:00:00',
    id_mensagem: 'w-old', status_envio: 'enviado', ack: 'lido',
    data_envio: '2026-06-30T08:00:00Z', data_lote: '2026-07-01', erro: null, ...extra,
  });
}

test('envio em massa: envia só os pendentes da agenda e atualiza o status de todos os dias', async () => {
  const store = criarStore(':memory:');
  registrarEnvioPrevio(store, 5); // EVA já enviada -> não é pendente
  const enviados = [];
  const maischat = { sendTemplate: async (p) => { enviados.push(p); return { idMensagem: 'w' + enviados.length }; } };
  const em = criarEnvioMassa({ medx: medxFake(), maischat, store, config: cfg() });

  const r = await em.iniciar({ nomeMedico: 'Dra Marina', inicio: '2026-07-01', fim: '2026-07-02', agora: new Date('2026-06-30T12:00:00Z') });
  assert.equal(r.ok, true);
  assert.equal(r.job.total, 2); // ANA e BIA (CLARA desmarcada, DAVI de outro médico, EVA já enviada)
  assert.equal(r.job.resumo.ja_enviados, 1);
  assert.equal(r.job.resumo.inelegiveis, 1);
  await em.aguardar(r.job.id);

  const job = em.obter(r.job.id);
  assert.equal(job.estado, 'concluido');
  assert.equal(job.enviados, 2);
  assert.equal(job.erros, 0);
  assert.deepEqual(job.itens.map((i) => i.status), ['enviado', 'enviado']);
  assert.equal(enviados.length, 2);
  // envios registrados -> o painel mostra "Enviado" em cada dia enviado do período
  assert.equal(store.jaEnviado(1), true);
  assert.equal(store.jaEnviado(2), true);
  const agenda = store.agendaCompleta('2026-07-01', '2026-07-02');
  const acks = Object.fromEntries(agenda.map((a) => [a.id_agendamento, a.ack]));
  assert.equal(acks[1], 'enviado');
  assert.equal(acks[2], 'enviado');
  assert.equal(acks[3], null); // desmarcada segue sem envio
  // um lote de ACK por dia enviado
  const passes = store.passesPendentes('2099-01-01T00:00:00Z');
  assert.deepEqual(passes.map((p) => p.data_lote).sort(), ['2026-07-01', '2026-07-01', '2026-07-02', '2026-07-02']);
  store.fechar();
});

test('envio em massa: falha do Mais Chat marca o item como erro e registra a falha', async () => {
  const store = criarStore(':memory:');
  const maischat = {
    sendTemplate: async ({ telefone }) => {
      if (telefone === '5534999990001') throw new Error('numero invalido');
      return { idMensagem: 'w-ok' };
    },
  };
  const em = criarEnvioMassa({ medx: medxFake(), maischat, store, config: cfg() });
  const r = await em.iniciar({ nomeMedico: 'Dra Marina', inicio: '2026-07-01', fim: '2026-07-02' });
  await em.aguardar(r.job.id);
  const job = em.obter(r.job.id);
  assert.equal(job.enviados, 2); // BIA e EVA
  assert.equal(job.erros, 1);
  const comErro = job.itens.find((i) => i.status === 'erro');
  assert.equal(comErro.id_agendamento, 1);
  assert.match(comErro.erro, /numero invalido/);
  assert.equal(store.jaEnviado(1), false); // falha não conta como enviado
  store.fechar();
});

test('envio em massa: DRY_RUN simula sem chamar o Mais Chat nem registrar', async () => {
  const store = criarStore(':memory:');
  let chamou = false;
  const maischat = { sendTemplate: async () => { chamou = true; return { idMensagem: 'x' }; } };
  const em = criarEnvioMassa({ medx: medxFake(), maischat, store, config: cfg({ dryRun: true }) });
  const r = await em.iniciar({ nomeMedico: 'Dra Marina', inicio: '2026-07-01', fim: '2026-07-02' });
  await em.aguardar(r.job.id);
  const job = em.obter(r.job.id);
  assert.equal(job.estado, 'concluido');
  assert.equal(job.simulados, 3);
  assert.equal(job.enviados, 0);
  assert.equal(chamou, false);
  assert.equal(store.jaEnviado(1), false);
  store.fechar();
});

test('envio em massa: sem pendentes conclui direto sem enviar nada', async () => {
  const store = criarStore(':memory:');
  let chamou = false;
  const maischat = { sendTemplate: async () => { chamou = true; return { idMensagem: 'x' }; } };
  const em = criarEnvioMassa({ medx: medxFake(), maischat, store, config: cfg() });
  const r1 = await em.iniciar({ nomeMedico: 'Dra Marina', inicio: '2026-07-01', fim: '2026-07-02' });
  await em.aguardar(r1.job.id);
  chamou = false;
  // segunda rodada: todos já enviados -> nada pendente
  const r2 = await em.iniciar({ nomeMedico: 'Dra Marina', inicio: '2026-07-01', fim: '2026-07-02' });
  assert.equal(r2.ok, true);
  assert.equal(r2.job.total, 0);
  assert.equal(r2.job.estado, 'concluido');
  assert.equal(r2.job.resumo.ja_enviados, 3);
  assert.equal(chamou, false);
  store.fechar();
});

test('envio em massa: recusa um segundo job enquanto houver um em andamento (409)', async () => {
  const store = criarStore(':memory:');
  let liberar;
  const trava = new Promise((res) => { liberar = res; });
  const maischat = { sendTemplate: async () => { await trava; return { idMensagem: 'w' }; } };
  const em = criarEnvioMassa({ medx: medxFake(), maischat, store, config: cfg() });
  const r1 = await em.iniciar({ nomeMedico: 'Dra Marina', inicio: '2026-07-01', fim: '2026-07-02' });
  assert.equal(r1.ok, true);
  const r2 = await em.iniciar({ nomeMedico: 'Dra Marina', inicio: '2026-07-01', fim: '2026-07-02' });
  assert.equal(r2.ok, false);
  assert.equal(r2.status, 409);
  liberar();
  await em.aguardar(r1.job.id);
  assert.equal(em.obter(r1.job.id).estado, 'concluido');
  store.fechar();
});
