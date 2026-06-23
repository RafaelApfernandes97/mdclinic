import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarServidor } from '../src/server.js';
import { criarStore } from '../src/store.js';

const config = {
  dashboardUser: 'admin', dashboardPassword: 'pw', sessionSecret: 's',
  runToken: 'rt', port: 0, medicoCampoNome: 'Nome',
};

function storeComAgenda() {
  const s = criarStore(':memory:');
  s.upsertAgendaItem({
    id_agendamento: 1, data_lote: '2026-06-24', id_usuario: 7, nome_medico: 'Dra. Marina',
    id_paciente: 9, nome_paciente: 'Joao', telefone: '5534999998888',
    inicio: '2026-06-24T10:00:00', elegivel: 1, motivo: null, descricao: 'JOAO',
    capturado_em: '2026-06-23T08:00:00Z',
  });
  s.upsertAgendaItem({
    id_agendamento: 2, data_lote: '2026-06-24', id_usuario: 7, nome_medico: 'Dra. Marina',
    id_paciente: null, nome_paciente: 'FECHADA', telefone: null,
    inicio: '2026-06-24T11:00:00', elegivel: 0, motivo: 'bloqueio', descricao: 'FECHADA',
    capturado_em: '2026-06-23T08:00:00Z',
  });
  return s;
}

async function comServidor(app, fn) {
  const server = app.listen(0);
  const port = server.address().port;
  try { return await fn(port); } finally { server.close(); }
}

async function login(port) {
  const res = await fetch(`http://127.0.0.1:${port}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'usuario=admin&senha=pw',
  });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

test('/api/dados sem sessão redireciona', async () => {
  const app = criarServidor({ store: storeComAgenda(), config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/dados?data=2026-06-24`, { redirect: 'manual' });
    assert.equal(res.status, 302);
  });
});

test('/api/dados autenticado retorna resumo + agenda', async () => {
  const app = criarServidor({ store: storeComAgenda(), config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/dados?data=2026-06-24`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.resumo.total, 2);
    assert.equal(d.resumo.elegiveis, 1);
    assert.equal(d.resumo.pulados, 1);
    assert.equal(d.agenda.length, 2);
    assert.equal(d.porMedico[0].total, 2);
  });
});

test('/api/atualizar-agenda chama snapshot ao vivo e retorna dados', async () => {
  const medx = {
    getAgenda: async () => [{ Id_Agendamento: 5, Id_Paciente: 1, Id_Usuario: 7, SMS: '34999990000', Descricao: 'MARIA', Inicio: '2026-06-24T09:00:00' }],
    getUsuarios: async () => [{ Id_Usuario: 7, Nome: 'Dra. Marina' }],
  };
  const app = criarServidor({ store: criarStore(':memory:'), config, executarEnvio: async () => ({}), medx });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/atualizar-agenda?data=2026-06-24`, { method: 'POST', headers: { cookie } });
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.agenda.length, 1);
    assert.equal(d.resumo.elegiveis, 1);
  });
});

test('/api/atualizar-agenda responde 502 quando MedX falha', async () => {
  const medx = { getAgenda: async () => { throw new Error('down'); }, getUsuarios: async () => [] };
  const app = criarServidor({ store: criarStore(':memory:'), config, executarEnvio: async () => ({}), medx });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/atualizar-agenda?data=2026-06-24`, { method: 'POST', headers: { cookie } });
    assert.equal(res.status, 502);
  });
});
