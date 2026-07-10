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

test('/api/dados inclui a lista de médicos (para o seletor)', async () => {
  const store = storeComAgenda();
  store.upsertMedico({ id_usuario: 8, nome: 'Dr. Carlos Mendes' });
  store.upsertMedico({ id_usuario: 7, nome: 'Dra. Marina Souza' });
  const app = criarServidor({ store, config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/dados?data=2026-06-24`, { headers: { cookie } });
    const d = await res.json();
    assert.equal(Array.isArray(d.medicos), true);
    assert.deepEqual(d.medicos.map((m) => m.nome), ['Dr. Carlos Mendes', 'Dra. Marina Souza']);
  });
});

test('POST /api/enviar dispara o envio manual (respeita DRY_RUN)', async () => {
  const cfgEnvio = { ...config, templateVariaveis: ['nome', 'medico', 'data', 'hora'], dryRun: true };
  const maischat = { sendTemplate: async () => ({ idMensagem: 'x' }) };
  const app = criarServidor({ store: storeComAgenda(), config: cfgEnvio, executarEnvio: async () => ({}), medx: {}, maischat });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/enviar?id=1`, { method: 'POST', headers: { cookie } });
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.dryRun, true);
  });
});

test('POST /api/medico-15dias ativa a agenda e retorna a lista atualizada', async () => {
  const store = criarStore(':memory:');
  store.upsertMedico({ id_usuario: 7, nome: 'Dra. Marina' });
  const app = criarServidor({ store, config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/medico-15dias`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ idUsuario: 7, ativo: true }),
    });
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.ok, true);
    assert.equal(d.medicos.find((m) => m.id_usuario === 7).envio_15dias, 1);
    assert.deepEqual(store.medicosEnvio15Dias(), [7]);
  });
});

test('POST /api/medico-15dias 404 para agenda inexistente', async () => {
  const app = criarServidor({ store: criarStore(':memory:'), config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/medico-15dias`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ idUsuario: 999, ativo: true }),
    });
    assert.equal(res.status, 404);
  });
});

test('POST /api/medico-15dias exige sessão', async () => {
  const app = criarServidor({ store: criarStore(':memory:'), config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/medico-15dias`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idUsuario: 7, ativo: true }),
    });
    assert.equal(res.status, 302);
  });
});

test('POST /api/disparar-envio chama executarEnvio e devolve o resultado', async () => {
  let chamou = false;
  const app = criarServidor({ store: criarStore(':memory:'), config,
    executarEnvio: async () => { chamou = true; return { enviados: 3, pulados: 1, erros: 0 }; }, medx: {} });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/disparar-envio`, { method: 'POST', headers: { cookie } });
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(chamou, true);
    assert.equal(d.resultado.enviados, 3);
  });
});

test('POST /api/disparar-envio exige sessão', async () => {
  const app = criarServidor({ store: criarStore(':memory:'), config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/disparar-envio`, { method: 'POST', redirect: 'manual' });
    assert.equal(res.status, 302);
  });
});

test('POST /api/atualizar-ack consulta o Mais Chat e atualiza os status', async () => {
  const store = criarStore(':memory:');
  store.upsertAgendaItem({
    id_agendamento: 1, data_lote: '2026-06-24', id_usuario: 7, nome_medico: 'Dra. Marina',
    id_paciente: 9, nome_paciente: 'Joao', telefone: '5534999998888',
    inicio: '2026-06-24T10:00:00', elegivel: 1, motivo: null, descricao: 'Joao', capturado_em: 'x',
  });
  store.registrarEnvio({
    id_agendamento: 1, id_paciente: 9, nome_paciente: 'Joao', telefone: '5534999998888',
    id_usuario: 7, nome_medico: 'Dra. Marina', inicio: '2026-06-24T10:00:00', id_mensagem: 'w1',
    status_envio: 'enviado', ack: 'enviado', data_envio: 'x', data_lote: '2026-06-24', erro: null,
  });
  const maischat = { getStatusMensagem: async () => ({ ack: 'lido' }) };
  const app = criarServidor({ store, config, executarEnvio: async () => ({}), medx: {}, maischat });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/atualizar-ack?data=2026-06-24`, { method: 'POST', headers: { cookie } });
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.ackAtualizados, 1);
    assert.equal(d.resumo.lido, 1);
    assert.equal(d.agenda[0].ack, 'lido');
  });
});

test('POST /api/atualizar-ack exige sessão', async () => {
  const app = criarServidor({ store: criarStore(':memory:'), config, executarEnvio: async () => ({}), medx: {}, maischat: {} });
  await comServidor(app, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/atualizar-ack?data=2026-06-24`, { method: 'POST', redirect: 'manual' });
    assert.equal(res.status, 302);
  });
});

test('POST /api/enviar exige sessão', async () => {
  const app = criarServidor({ store: storeComAgenda(), config, executarEnvio: async () => ({}), medx: {}, maischat: {} });
  await comServidor(app, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/enviar?id=1`, { method: 'POST', redirect: 'manual' });
    assert.equal(res.status, 302);
  });
});

test('/api/medicos busca a lista ao vivo do MedX (formato IddoUsuario/Usuario)', async () => {
  const medx = {
    getUsuarios: async () => ([
      { IddoUsuario: -1212054111, Usuario: 'dramarinadedeus' },
      { IddoUsuario: 578834368, Usuario: 'draliviaaraujo' },
    ]),
  };
  const app = criarServidor({ store: criarStore(':memory:'), config, executarEnvio: async () => ({}), medx });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/medicos`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.deepEqual(d.medicos.map((m) => m.nome), ['Dra Livia Araujo', 'Dra Marina de Deus']);
  });
});

test('/api/medicos cai no cache do banco quando o MedX falha', async () => {
  const store = criarStore(':memory:');
  store.upsertMedico({ id_usuario: 7, nome: 'Dra. Marina (cache)' });
  const medx = { getUsuarios: async () => { throw new Error('medx down'); } };
  const app = criarServidor({ store, config, executarEnvio: async () => ({}), medx });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/medicos`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.deepEqual(d.medicos.map((m) => m.nome), ['Dra. Marina (cache)']);
  });
});

test('/api/medicos sem sessão redireciona', async () => {
  const app = criarServidor({ store: criarStore(':memory:'), config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/medicos`, { redirect: 'manual' });
    assert.equal(res.status, 302);
  });
});

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

test('/api/hora retorna o epoch do servidor e o fuso de Brasília', async () => {
  const app = criarServidor({ store: criarStore(':memory:'), config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const antes = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/hora`, { headers: { cookie } });
    const depois = Date.now();
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.tz, 'America/Sao_Paulo');
    assert.ok(d.epoch >= antes && d.epoch <= depois);
  });
});

test('/api/hora sem sessão redireciona', async () => {
  const app = criarServidor({ store: criarStore(':memory:'), config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/hora`, { redirect: 'manual' });
    assert.equal(res.status, 302);
  });
});

test('serve o favicon da marca em /favicon.svg', async () => {
  const app = criarServidor({ store: criarStore(':memory:'), config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/favicon.svg`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /svg/);
  });
});

test('dashboard autenticado serve a página rebrandada', async () => {
  const app = criarServidor({ store: storeComAgenda(), config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Mais Chat/);
    assert.match(html, /Atualizar agenda/);
  });
});
