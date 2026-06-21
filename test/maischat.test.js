import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarMaisChat, mapearAck } from '../src/maischat.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });

test('mapearAck traduz códigos numéricos', () => {
  assert.equal(mapearAck(0), 'enviado');
  assert.equal(mapearAck(1), 'enviado');
  assert.equal(mapearAck(2), 'entregue');
  assert.equal(mapearAck(3), 'lido');
  assert.equal(mapearAck(-1), 'falha');
});

test('sendTemplate posta payload e retorna idMensagem', async () => {
  let corpo;
  const fetch = async (url, opts) => { corpo = JSON.parse(opts.body); return ok({ messageId: 'm-1' }); };
  const mc = criarMaisChat({
    baseUrl: 'http://mc', token: 'k', templateNome: 'tpl', templateIdioma: 'pt_BR', fetch });
  const r = await mc.sendTemplate({ telefone: '5534999998888', variaveis: ['Joao', 'Dra', '30/06', '18:20'] });
  assert.equal(r.idMensagem, 'm-1');
  assert.equal(corpo.to, '5534999998888');
  assert.equal(corpo.template, 'tpl');
  assert.deepEqual(corpo.params, ['Joao', 'Dra', '30/06', '18:20']);
});

test('getStatusMensagem retorna ack mapeado', async () => {
  const fetch = async () => ok({ ack: 3 });
  const mc = criarMaisChat({ baseUrl: 'http://mc', token: 'k', templateNome: 't', templateIdioma: 'pt_BR', fetch });
  const r = await mc.getStatusMensagem('m-1');
  assert.equal(r.ack, 'lido');
});
