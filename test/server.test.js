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
  // Inicio bem no futuro => sempre "próximo" independente do relógio do teste.
  const medx = {
    getAgenda: async () => [{
      Id_Agendamento: -19659252, Status: 1, SMS: '11911761633',
      TipoAgendamento: 'Consulta', Descricao: 'Rafael', Inicio: '2999-01-01T10:00:00',
    }],
    getTiposAgendamento: async () => [{ Id_do_TipoConsulta: -2, TipoConsulta: 'Consulta' }],
    atualizarStatus: async () => 'Success',
  };
  return criarServidor({ store, config, medx, executarEnvio: async () => ({ enviados: 0 }), ...overrides });
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

const jsonHeaders = (extra = {}) => ({ 'content-type': 'application/json', ...extra });

test('/api/confirmacao confirma pelo telefone (sem token)', async () => {
  const r = await req(appDeTeste(), 'POST', '/api/confirmacao', {
    headers: jsonHeaders(),
    body: JSON.stringify({ telefone: '11911761633' }),
  });
  assert.equal(r.status, 200);
  const body = JSON.parse(r.texto);
  assert.equal(body.success, true);
  assert.equal(body.statusAplicado, 'CONFIRMADO');
  assert.equal(body.idAgendamento, -19659252);
});

test('/api/confirmacao exige telefone', async () => {
  const r = await req(appDeTeste(), 'POST', '/api/confirmacao', {
    headers: jsonHeaders(), body: JSON.stringify({}),
  });
  assert.equal(r.status, 400);
  assert.equal(JSON.parse(r.texto).success, false);
});

test('/api/confirmacao 404 quando telefone não tem agendamento na janela', async () => {
  const r = await req(appDeTeste(), 'POST', '/api/confirmacao', {
    headers: jsonHeaders(),
    body: JSON.stringify({ telefone: '34999990000' }),
  });
  assert.equal(r.status, 404);
  assert.equal(JSON.parse(r.texto).success, false);
});

// Amanhã às 23:00 (dentro da janela de confirmação e ainda no futuro).
const AMANHA = `${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}T23:00:00`;

function envioVacina(store, { telefone = '5534999998888', inicio = AMANHA, data_envio = '2026-11-12T11:00:00Z' } = {}) {
  store.registrarEnvioNetVacinas({
    chave: 'appointment:483855:1', id_externo: '483855', id_paciente: '1', nome_paciente: 'Maria',
    telefone, vacina: 'Influenza', inicio, id_mensagem: 'w', status_envio: 'enviado', ack: 'enviado',
    data_envio, data_lote: inicio.slice(0, 10), erro: null,
  });
}

test('/api/confirmacao confirma na NetVacinas quando a última mensagem foi de vacina', async () => {
  const store = criarStore(':memory:');
  envioVacina(store, { telefone: '5534999998888' });
  const confirmados = [];
  const netvacinasRest = { confirmarAgendamento: async (id) => { confirmados.push(id); return { id, status: 'confirmed' }; } };
  // wa_id sem o 9º dígito também precisa casar.
  const r = await req(appDeTeste({ store, netvacinasRest }), 'POST', '/api/confirmacao', {
    headers: jsonHeaders(), body: JSON.stringify({ telefone: '553499998888' }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(confirmados, ['483855']);
  assert.equal(JSON.parse(r.texto).origem, 'netvacinas');
});

test('/api/confirmacao segue pelo MedX quando a mensagem mais recente foi da MedX', async () => {
  const store = criarStore(':memory:');
  envioVacina(store, { telefone: '5511911761633', data_envio: '2026-11-12T10:00:00Z' });
  store.registrarEnvio({
    id_agendamento: -19659252, id_paciente: 1, nome_paciente: 'Rafael', telefone: '5511911761633', id_usuario: 1,
    nome_medico: 'Dra. Marina', inicio: AMANHA, id_mensagem: 'm', status_envio: 'enviado',
    ack: 'enviado', data_envio: '2026-11-12T11:00:00Z', data_lote: '2999-01-01', erro: null,
  });
  const confirmados = [];
  const netvacinasRest = { confirmarAgendamento: async (id) => { confirmados.push(id); } };
  const r = await req(appDeTeste({ store, netvacinasRest }), 'POST', '/api/confirmacao', {
    headers: jsonHeaders(), body: JSON.stringify({ telefone: '11911761633' }),
  });
  assert.equal(r.status, 200);
  assert.equal(confirmados.length, 0);
  assert.equal(JSON.parse(r.texto).idAgendamento, -19659252);
});

test('/api/confirmacao 502 quando a NetVacinas recusa', async () => {
  const store = criarStore(':memory:');
  envioVacina(store);
  const netvacinasRest = { confirmarAgendamento: async () => { throw new Error('HTTP 404'); } };
  const r = await req(appDeTeste({ store, netvacinasRest }), 'POST', '/api/confirmacao', {
    headers: jsonHeaders(), body: JSON.stringify({ telefone: '34999998888' }),
  });
  assert.equal(r.status, 502);
});
