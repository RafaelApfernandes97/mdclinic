import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarStore } from '../src/store.js';

function novaStore() { return criarStore(':memory:'); }

const base = {
  id_agendamento: 1, id_paciente: 9, nome_paciente: 'Joao', telefone: '5534999998888',
  id_usuario: 7, nome_medico: 'Dra. Marina', inicio: '2026-06-30T18:20:00',
  id_mensagem: 'msg-1', status_envio: 'enviado', ack: 'enviado',
  data_envio: '2026-06-29T08:00:00Z', data_lote: '2026-06-29', erro: null,
};

test('registrarEnvio + jaEnviado', () => {
  const s = novaStore();
  assert.equal(s.jaEnviado(1), false);
  s.registrarEnvio(base);
  assert.equal(s.jaEnviado(1), true);
  s.fechar();
});

test('erro não conta como enviado', () => {
  const s = novaStore();
  s.registrarEnvio({ ...base, status_envio: 'erro', ack: 'falha', erro: 'x' });
  assert.equal(s.jaEnviado(1), false);
  s.fechar();
});

test('atualizarAck e mensagensNaoLidas', () => {
  const s = novaStore();
  s.registrarEnvio(base);
  s.registrarEnvio({ ...base, id_agendamento: 2, id_mensagem: 'msg-2' });
  let pend = s.mensagensNaoLidas('2026-06-29');
  assert.equal(pend.length, 2);
  s.atualizarAck(1, 'lido', '2026-06-29T08:10:00Z');
  pend = s.mensagensNaoLidas('2026-06-29');
  assert.deepEqual(pend.map((p) => p.id_agendamento), [2]);
  s.fechar();
});

test('lotes: criar, listar pendentes e marcar feito', () => {
  const s = novaStore();
  s.criarLote({
    data_lote: '2026-06-29', fim_campanha: '2026-06-29T08:05:00Z',
    passe1_em: '2026-06-29T08:10:00Z', passe2_em: '2026-06-29T09:00:00Z',
  });
  let p = s.passesPendentes('2026-06-29T08:30:00Z');
  assert.deepEqual(p, [{ data_lote: '2026-06-29', numero: 1 }]);
  s.marcarPasseFeito('2026-06-29', 1);
  p = s.passesPendentes('2026-06-29T09:30:00Z');
  assert.deepEqual(p, [{ data_lote: '2026-06-29', numero: 2 }]);
  s.fechar();
});

test('agregações do dashboard', () => {
  const s = novaStore();
  s.registrarEnvio({ ...base, id_agendamento: 1, ack: 'lido' });
  s.registrarEnvio({ ...base, id_agendamento: 2, ack: 'entregue', nome_medico: 'Dr. Ana' });
  const r = s.resumoPorData('2026-06-29');
  assert.equal(r.total, 2);
  assert.equal(r.lido, 1);
  assert.equal(r.entregue, 1);
  const pm = s.porMedico('2026-06-29');
  assert.equal(pm.length, 2);
  assert.equal(s.detalhado('2026-06-29').length, 2);
  s.fechar();
});

test('agenda_itens: upsert, agendaCompleta e resumoAgenda', () => {
  const s = novaStore();
  const baseAg = {
    data_lote: '2026-06-24', id_usuario: 7, nome_medico: 'Dra. Marina',
    id_paciente: 9, nome_paciente: 'Joao', telefone: '5534999998888',
    inicio: '2026-06-24T10:00:00', elegivel: 1, motivo: null,
    descricao: 'JOAO', capturado_em: '2026-06-23T08:00:00Z',
  };
  // elegível e enviado (lido)
  s.upsertAgendaItem({ ...baseAg, id_agendamento: 1 });
  s.registrarEnvio({
    id_agendamento: 1, id_paciente: 9, nome_paciente: 'Joao', telefone: '5534999998888',
    id_usuario: 7, nome_medico: 'Dra. Marina', inicio: '2026-06-24T10:00:00',
    id_mensagem: 'm1', status_envio: 'enviado', ack: 'lido',
    data_envio: '2026-06-23T08:00:00Z', data_lote: '2026-06-24', erro: null,
  });
  // não elegível (bloqueio), sem envio
  s.upsertAgendaItem({
    ...baseAg, id_agendamento: 2, id_paciente: null, nome_paciente: 'FECHADA',
    telefone: null, inicio: '2026-06-24T11:00:00', elegivel: 0, motivo: 'bloqueio',
    descricao: 'FECHADA',
  });

  const ag = s.agendaCompleta('2026-06-24');
  assert.equal(ag.length, 2);
  assert.equal(ag[0].nome_paciente, 'Joao');
  assert.equal(ag[0].ack, 'lido');
  assert.equal(ag[1].elegivel, 0);
  assert.equal(ag[1].motivo, 'bloqueio');
  assert.equal(ag[1].ack, null); // sem envio

  const r = s.resumoAgenda('2026-06-24');
  assert.equal(r.total, 2);
  assert.equal(r.elegiveis, 1);
  assert.equal(r.pulados, 1);
  assert.equal(r.lido, 1);

  const pm = s.porMedicoAgenda('2026-06-24');
  assert.equal(pm.length, 1);
  assert.equal(pm[0].total, 2);
  s.fechar();
});

test('agendaItem retorna o item (ou null) e agendaCompleta inclui id_agendamento', () => {
  const s = novaStore();
  s.upsertAgendaItem({
    id_agendamento: 5, data_lote: '2026-06-24', id_usuario: 7, nome_medico: 'M',
    id_paciente: 9, nome_paciente: 'Joao', telefone: '5534999998888',
    inicio: '2026-06-24T10:00:00', elegivel: 1, motivo: null, descricao: 'Joao', capturado_em: 'x',
  });
  const it = s.agendaItem(5);
  assert.equal(it.id_agendamento, 5);
  assert.equal(it.elegivel, 1);
  assert.equal(it.telefone, '5534999998888');
  assert.equal(s.agendaItem(999), null);
  assert.equal(s.agendaCompleta('2026-06-24')[0].id_agendamento, 5);
  s.fechar();
});

test('medicos: upsert idempotente e listagem ordenada por nome', () => {
  const s = novaStore();
  s.upsertMedico({ id_usuario: 8, nome: 'Dr. Carlos' });
  s.upsertMedico({ id_usuario: 7, nome: 'Dra. Marina' });
  s.upsertMedico({ id_usuario: 7, nome: 'Dra. Marina Souza' }); // mesmo id -> atualiza
  const meds = s.listarMedicos();
  assert.equal(meds.length, 2);
  assert.deepEqual(meds.map((m) => m.nome), ['Dr. Carlos', 'Dra. Marina Souza']);
  s.fechar();
});

test('agenda_itens: upsert é idempotente (atualiza, não duplica)', () => {
  const s = novaStore();
  const item = {
    id_agendamento: 1, data_lote: '2026-06-24', id_usuario: 7, nome_medico: 'Dra. Marina',
    id_paciente: 9, nome_paciente: 'Joao', telefone: '5534999998888',
    inicio: '2026-06-24T10:00:00', elegivel: 1, motivo: null, descricao: 'JOAO',
    capturado_em: '2026-06-23T08:00:00Z',
  };
  s.upsertAgendaItem(item);
  s.upsertAgendaItem({ ...item, nome_paciente: 'Joao Silva' });
  const ag = s.agendaCompleta('2026-06-24');
  assert.equal(ag.length, 1);
  assert.equal(ag[0].nome_paciente, 'Joao Silva');
  s.fechar();
});
