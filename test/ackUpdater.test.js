import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executarPasse, atualizarAcks } from '../src/ackUpdater.js';
import { criarStore } from '../src/store.js';

const base = {
  id_paciente: 1, nome_paciente: 'x', telefone: '55', id_usuario: 1, nome_medico: 'Dr',
  inicio: '2026-06-22T10:00:00', status_envio: 'enviado', ack: 'enviado',
  data_envio: '2026-06-21T08:00:00Z', data_lote: '2026-06-22', erro: null,
};

test('atualizarAcks atualiza não-lidas via getStatusMensagem (sem mexer em lotes)', async () => {
  const store = criarStore(':memory:');
  store.registrarEnvio({ ...base, id_agendamento: 1, id_mensagem: 'a' });            // 'enviado'
  store.registrarEnvio({ ...base, id_agendamento: 2, id_mensagem: 'b', ack: 'lido' }); // já lido
  const maischat = { getStatusMensagem: async () => ({ ack: 'lido' }) };
  const r = await atualizarAcks({ maischat, store, dataLote: '2026-06-22' });
  assert.equal(r.pendentes, 1);
  assert.equal(r.atualizados, 1);
  assert.equal(store.mensagensNaoLidas('2026-06-22').length, 0); // item 1 virou 'lido'
  store.fechar();
});

test('atualizarAcks não conta quando ack volta null (ainda não aparece na listagem)', async () => {
  const store = criarStore(':memory:');
  store.registrarEnvio({ ...base, id_agendamento: 1, id_mensagem: 'a' });
  const maischat = { getStatusMensagem: async () => ({ ack: null }) };
  const r = await atualizarAcks({ maischat, store, dataLote: '2026-06-22' });
  assert.equal(r.atualizados, 0);
  store.fechar();
});

test('atualiza só não-lidas e marca passe feito', async () => {
  const store = criarStore(':memory:');
  store.registrarEnvio({ ...base, id_agendamento: 1, id_mensagem: 'a' });
  store.registrarEnvio({ ...base, id_agendamento: 2, id_mensagem: 'b', ack: 'lido' });
  store.criarLote({ data_lote: '2026-06-22', fim_campanha: 'x',
    passe1_em: '2026-06-21T08:05:00Z', passe2_em: '2026-06-21T09:00:00Z' });

  const consultadas = [];
  const maischat = {
    getStatusMensagem: async (id, telefone) => { consultadas.push({ id, telefone }); return { ack: 'entregue' }; },
  };
  const r = await executarPasse({ maischat, store, dataLote: '2026-06-22', numero: 1 });

  assert.deepEqual(consultadas, [{ id: 'a', telefone: '55' }]); // 'b' já estava lido, e consulta por destino
  assert.equal(r.atualizados, 1);
  assert.deepEqual(store.passesPendentes('2026-06-21T10:00:00Z').map((p) => p.numero), [2]);
  store.fechar();
});
