import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executarPasse } from '../src/ackUpdater.js';
import { criarStore } from '../src/store.js';

const base = {
  id_paciente: 1, nome_paciente: 'x', telefone: '55', id_usuario: 1, nome_medico: 'Dr',
  inicio: '2026-06-22T10:00:00', status_envio: 'enviado', ack: 'enviado',
  data_envio: '2026-06-21T08:00:00Z', data_lote: '2026-06-22', erro: null,
};

test('atualiza só não-lidas e marca passe feito', async () => {
  const store = criarStore(':memory:');
  store.registrarEnvio({ ...base, id_agendamento: 1, id_mensagem: 'a' });
  store.registrarEnvio({ ...base, id_agendamento: 2, id_mensagem: 'b', ack: 'lido' });
  store.criarLote({ data_lote: '2026-06-22', fim_campanha: 'x',
    passe1_em: '2026-06-21T08:05:00Z', passe2_em: '2026-06-21T09:00:00Z' });

  const consultadas = [];
  const maischat = { getStatusMensagem: async (id) => { consultadas.push(id); return { ack: 'entregue' }; } };
  const r = await executarPasse({ maischat, store, dataLote: '2026-06-22', numero: 1 });

  assert.deepEqual(consultadas, ['a']); // 'b' já estava lido
  assert.equal(r.atualizados, 1);
  assert.deepEqual(store.passesPendentes('2026-06-21T10:00:00Z').map((p) => p.numero), [2]);
  store.fechar();
});
