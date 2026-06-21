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
