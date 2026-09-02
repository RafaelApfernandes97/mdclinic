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

test('/api/dados lista as agendas habilitadas para envio em massa', async () => {
  const store = storeComAgenda();
  store.upsertMedico({ id_usuario: 7, nome: 'Dra Marina' });
  store.upsertMedico({ id_usuario: 8, nome: 'Dr. Carlos' });
  const cfg = { ...config, envioMassaMedicos: ['dramarina'] };
  const app = criarServidor({ store, config: cfg, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/dados?data=2026-06-24`, { headers: { cookie } });
    const d = await res.json();
    assert.deepEqual(d.envioMassaMedicos, ['Dra Marina']);
  });
});

test('POST /api/envio-massa dispara o job e GET acompanha até concluir', async () => {
  const store = criarStore(':memory:');
  const medx = {
    getAgenda: async () => ([
      { Id_Agendamento: 1, Id_Paciente: 9, Id_Usuario: 7, SMS: '34999990001', Descricao: 'ANA', Inicio: '2026-07-01T09:00:00', Status: 1 },
      { Id_Agendamento: 2, Id_Paciente: 10, Id_Usuario: 7, SMS: '34999990002', Descricao: 'BIA', Inicio: '2026-07-01T10:00:00', Status: 0 },
    ]),
    getUsuarios: async () => [{ Id_Usuario: 7, Nome: 'Dra Marina' }],
  };
  const maischat = { sendTemplate: async () => ({ idMensagem: 'w1' }) };
  const cfg = {
    ...config, envioMassaMedicos: ['dramarina'], dryRun: false,
    templateNome: 't', templateVariaveis: ['nome', 'data', 'hora'], ackPasse1Min: 5, ackPasse2Min: 60,
  };
  const app = criarServidor({ store, config: cfg, executarEnvio: async () => ({}), medx, maischat });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(
      `http://127.0.0.1:${port}/api/envio-massa?inicio=2026-07-01&fim=2026-07-01&medico=${encodeURIComponent('Dra Marina')}`,
      { method: 'POST', headers: { cookie } });
    assert.equal(res.status, 200);
    let { job } = await res.json();
    assert.equal(job.total, 1); // só ANA é pendente (BIA está desmarcada)
    assert.equal(job.resumo.inelegiveis, 1);
    for (let i = 0; i < 100 && job.estado !== 'concluido'; i++) {
      await new Promise((r) => setTimeout(r, 10));
      const st = await fetch(`http://127.0.0.1:${port}/api/envio-massa/${job.id}`, { headers: { cookie } });
      assert.equal(st.status, 200);
      ({ job } = await st.json());
    }
    assert.equal(job.estado, 'concluido');
    assert.equal(job.enviados, 1);
    assert.equal(job.itens[0].status, 'enviado');
    // fire-and-forget: o massa NÃO altera o status "enviado" da agenda, para não
    // bloquear o lembrete de 1 dia antes (job diário).
    assert.equal(store.jaEnviado(1), false);
    const dados = await fetch(`http://127.0.0.1:${port}/api/dados?inicio=2026-07-01&fim=2026-07-01`, { headers: { cookie } });
    const d = await dados.json();
    assert.equal(d.agenda.find((a) => a.id_agendamento === 1).ack, null);
  });
});

test('POST /api/envio-massa recusa agenda não habilitada (403)', async () => {
  const cfg = { ...config, envioMassaMedicos: ['dramarina'] };
  const app = criarServidor({ store: criarStore(':memory:'), config: cfg, executarEnvio: async () => ({}), medx: {}, maischat: {} });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(
      `http://127.0.0.1:${port}/api/envio-massa?inicio=2026-07-01&fim=2026-07-01&medico=${encodeURIComponent('Dr. Carlos')}`,
      { method: 'POST', headers: { cookie } });
    assert.equal(res.status, 403);
  });
});

test('POST /api/envio-massa valida período e médico (400)', async () => {
  const cfg = { ...config, envioMassaMedicos: ['dramarina'] };
  const app = criarServidor({ store: criarStore(':memory:'), config: cfg, executarEnvio: async () => ({}), medx: {}, maischat: {} });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const semMedico = await fetch(`http://127.0.0.1:${port}/api/envio-massa?inicio=2026-07-01&fim=2026-07-01`, { method: 'POST', headers: { cookie } });
    assert.equal(semMedico.status, 400);
    const periodoRuim = await fetch(`http://127.0.0.1:${port}/api/envio-massa?inicio=2026-07-02&fim=2026-07-01&medico=x`, { method: 'POST', headers: { cookie } });
    assert.equal(periodoRuim.status, 400);
  });
});

test('POST /api/envio-massa exige sessão', async () => {
  const app = criarServidor({ store: criarStore(':memory:'), config, executarEnvio: async () => ({}), medx: {}, maischat: {} });
  await comServidor(app, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/envio-massa?inicio=2026-07-01&fim=2026-07-01&medico=x`, { method: 'POST', redirect: 'manual' });
    assert.equal(res.status, 302);
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
