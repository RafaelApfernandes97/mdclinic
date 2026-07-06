import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarMaisChat, mapearAck, montarComponents } from '../src/maischat.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });

function mc(fetch, extra = {}) {
  return criarMaisChat({
    baseUrl: 'http://mc/v3', broker: 'wppCloudAPI', appId: 'APP1', source: '558000708000',
    metaToken: 'META', templateNome: 'confirma', templateIdioma: 'pt_BR', fetch, ...extra,
  });
}

test('mapearAck traduz códigos (string ou número)', () => {
  assert.equal(mapearAck('-1'), 'falha');
  assert.equal(mapearAck('1'), 'enviado');
  assert.equal(mapearAck('2'), 'entregue');
  assert.equal(mapearAck('3'), 'lido');
  assert.equal(mapearAck(0), 'enviado');
});

test('montarComponents monta body com parâmetros posicionais', () => {
  assert.deepEqual(montarComponents(['Joao', 'Dra']), [
    { type: 'body', parameters: [{ type: 'text', text: 'Joao' }, { type: 'text', text: 'Dra' }] },
  ]);
  assert.deepEqual(montarComponents([]), []);
});

test('sendTemplate posta no contrato Mais Chat e retorna o wamid (resposta embrulhada)', async () => {
  let url, corpo;
  const fetch = async (u, opts) => {
    url = u; corpo = JSON.parse(opts.body);
    // A API real embrulha a resposta da Meta em { status, data: {...} }.
    return ok({ status: true, data: {
      messaging_product: 'whatsapp',
      contacts: [{ input: '5534999998888', wa_id: '5534999998888' }],
      messages: [{ id: 'wamid.ABC', message_status: 'accepted' }],
      msgId: 'mc-internal-1',
    } });
  };
  const r = await mc(fetch).sendTemplate({ telefone: '5534999998888', variaveis: ['Joao', 'Dra', '30/06', '18:20'] });
  assert.equal(r.idMensagem, 'wamid.ABC');
  assert.equal(url, 'http://mc/v3/template/send/wppCloudAPI');
  assert.equal(corpo.type, 'apiTemplate');
  assert.equal(corpo.broker, 'wppCloudAPI');
  assert.equal(corpo.appId, 'APP1');
  assert.equal(corpo.source, '558000708000');
  assert.equal(corpo.destination, '5534999998888');
  assert.equal(corpo.token, 'META');
  assert.equal(corpo.template.name, 'confirma');
  assert.equal(corpo.template.language, 'pt_BR');
  assert.deepEqual(corpo.template.components[0].parameters.map((p) => p.text), ['Joao', 'Dra', '30/06', '18:20']);
});

test('sendTemplate aceita template por envio (override do padrão)', async () => {
  let corpo;
  const fetch = async (u, opts) => { corpo = JSON.parse(opts.body); return ok({ status: true, data: { messages: [{ id: 'wamid.OVR' }] } }); };
  await mc(fetch).sendTemplate({ telefone: '55', variaveis: ['a'], template: 'confirmar_dralivia' });
  assert.equal(corpo.template.name, 'confirmar_dralivia');
});

test('sendTemplate lança quando a Meta retorna falha', async () => {
  const fetch = async () => ok({ status: false, message: 'Falha ao enviar mensagem!', error: { error: { code: 131009 } } });
  await assert.rejects(() => mc(fetch).sendTemplate({ telefone: '55', variaveis: [] }), /Falha ao enviar/);
});

test('sendTemplate envia Authorization quando apiKey definido', async () => {
  let headers;
  const fetch = async (u, opts) => { headers = opts.headers; return ok({ messages: [{ id: 'x' }] }); };
  await mc(fetch, { apiKey: 'KEY' }).sendTemplate({ telefone: '55', variaveis: [] });
  assert.equal(headers.Authorization, 'Bearer KEY');
});

test('sendTemplate loga debug quando debug=true (sem vazar o token)', async () => {
  const fetch = async () => ok({ status: true, data: { messages: [{ id: 'wamid.LOG' }] } });
  const linhas = []; const orig = console.log; console.log = (...a) => linhas.push(a.join(' '));
  try { await mc(fetch, { debug: true }).sendTemplate({ telefone: '5511999', variaveis: ['a'] }); }
  finally { console.log = orig; }
  const txt = linhas.join('\n');
  assert.match(txt, /\[maischat\].*sendTemplate/);
  assert.match(txt, /wamid\.LOG/);
  assert.doesNotMatch(txt, /META/); // não loga o metaToken
});

test('sendTemplate não loga debug por padrão (debug=false)', async () => {
  const fetch = async () => ok({ status: true, data: { messages: [{ id: 'x' }] } });
  const linhas = []; const orig = console.log; console.log = (...a) => linhas.push(a.join(' '));
  try { await mc(fetch).sendTemplate({ telefone: '55', variaveis: [] }); }
  finally { console.log = orig; }
  assert.doesNotMatch(linhas.join('\n'), /\[maischat\] sendTemplate/);
});

test('getStatusMensagem busca por destino e casa pelo wppMsgId', async () => {
  let url;
  const fetch = async (u) => {
    url = u;
    return ok({ status: true, data: [
      { wppMsgId: 'wamid.OTHER', ack: '1' },
      { wppMsgId: 'wamid.ABC', ack: '3' },
    ] });
  };
  const r = await mc(fetch).getStatusMensagem('wamid.ABC', '5534999998888');
  assert.equal(r.ack, 'lido');
  assert.match(url, /\/messages\/destination\/5534999998888/);
});

test('getStatusMensagem retorna ack null quando não encontra a mensagem', async () => {
  const fetch = async () => ok({ status: true, data: [] });
  const r = await mc(fetch).getStatusMensagem('wamid.X', '55');
  assert.equal(r.ack, null);
});
