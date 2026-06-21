import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarMedx } from '../src/medx.js';

function fakeFetch(rotas) {
  return async (url, opts) => {
    const handler = rotas.find((r) => url.includes(r.match));
    if (!handler) throw new Error('rota não mockada: ' + url);
    return handler.resp(url, opts);
  };
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

test('getAuthToken chama GetAuthorizedToken e cacheia', async () => {
  let chamadas = 0;
  const fetch = fakeFetch([
    { match: 'GetAuthorizedToken', resp: async () => { chamadas++; return ok('TOKEN123'); } },
  ]);
  const medx = criarMedx({ baseUrl: 'http://medx', token: 'int', fetch });
  assert.equal(await medx.getAuthToken(), 'TOKEN123');
  await medx.getAuthToken();
  assert.equal(chamadas, 1);
});

test('getAgenda envia Bearer e retorna lista', async () => {
  let authHeader;
  const fetch = fakeFetch([
    { match: 'GetAuthorizedToken', resp: async () => ok('TKN') },
    { match: 'GetAgenda', resp: async (url, opts) => {
        authHeader = opts.headers.Authorization; return ok([{ Id_Agendamento: 1 }]); } },
  ]);
  const medx = criarMedx({ baseUrl: 'http://medx', token: 'int', fetch });
  const ag = await medx.getAgenda('2026-06-22', '2026-06-22');
  assert.equal(authHeader, 'Bearer TKN');
  assert.equal(ag[0].Id_Agendamento, 1);
});

test('re-autentica uma vez em 401', async () => {
  let agendaCalls = 0, authCalls = 0;
  const fetch = fakeFetch([
    { match: 'GetAuthorizedToken', resp: async () => { authCalls++; return ok('T' + authCalls); } },
    { match: 'GetAgenda', resp: async () => {
        agendaCalls++;
        if (agendaCalls === 1) return { ok: false, status: 401, text: async () => 'no' };
        return ok([{ Id_Agendamento: 9 }]);
      } },
  ]);
  const medx = criarMedx({ baseUrl: 'http://medx', token: 'int', fetch });
  const ag = await medx.getAgenda('2026-06-22', '2026-06-22');
  assert.equal(ag[0].Id_Agendamento, 9);
  assert.equal(authCalls, 2);
});
