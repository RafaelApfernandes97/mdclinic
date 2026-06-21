import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarServidor } from '../src/server.js';
import { criarStore } from '../src/store.js';

function appDeTeste(overrides = {}) {
  const store = criarStore(':memory:');
  store.registrarEnvio({
    id_agendamento: 1, id_paciente: 1, nome_paciente: 'Joao', telefone: '55', id_usuario: 1,
    nome_medico: 'Dra. Marina', inicio: '2026-06-22T10:00:00', id_mensagem: 'a',
    status_envio: 'enviado', ack: 'lido', data_envio: '2026-06-21T08:00:00Z',
    data_lote: '2026-06-22', erro: null,
  });
  const config = {
    dashboardUser: 'admin', dashboardPassword: 'pw', sessionSecret: 's',
    runToken: 'rt', port: 0,
  };
  return criarServidor({ store, config, executarEnvio: async () => ({ enviados: 0 }), ...overrides });
}

async function req(app, method, path, { headers = {}, body } = {}) {
  const { default: http } = await import('node:http');
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers, body, redirect: 'manual',
  });
  const texto = await res.text();
  server.close();
  return { status: res.status, texto, headers: res.headers };
}

test('GET / sem sessão redireciona para /login', async () => {
  const r = await req(appDeTeste(), 'GET', '/');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /\/login/);
});

test('GET /health responde ok', async () => {
  const r = await req(appDeTeste(), 'GET', '/health');
  assert.equal(r.status, 200);
});

test('/run-now exige token', async () => {
  const r = await req(appDeTeste(), 'POST', '/run-now');
  assert.equal(r.status, 401);
  const r2 = await req(appDeTeste(), 'POST', '/run-now', { headers: { 'x-run-token': 'rt' } });
  assert.equal(r2.status, 200);
});
