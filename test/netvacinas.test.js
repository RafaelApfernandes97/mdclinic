import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarNetVacinas } from '../src/netvacinas.js';
import { gravarSnapshotNetVacinas } from '../src/netvacinasSnapshot.js';
import { enviarManualNetVacinas } from '../src/envioManual.js';
import { criarStore } from '../src/store.js';
import { criarServidor } from '../src/server.js';

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}

test('NetVacinas consulta os dois tipos de agenda e pagina appointments', async () => {
  const chamadas = [];
  const fetch = async (url, opcoes) => {
    const corpo = JSON.parse(opcoes.body);
    chamadas.push({ url, opcoes, corpo });
    const appointment = corpo.query.includes('appointments(');
    if (appointment && corpo.variables.page == null) {
      return ok({ data: { myClinic: { appointments: {
        pagination: { hasNextPage: true, nextPage: 'cursor-2' }, records: [{ internalId: 'a1' }],
      } } } });
    }
    if (appointment) {
      return ok({ data: { myClinic: { appointments: {
        pagination: { hasNextPage: false, nextPage: null }, records: [{ internalId: 'a2' }],
      } } } });
    }
    return ok({ data: { myClinic: { scheduledShots: {
      pagination: { hasNextPage: false, nextPage: null }, records: [{ internalId: 's1' }],
    } } } });
  };
  const netvacinas = criarNetVacinas({ url: 'https://netvacinas.test/graphql', token: 'token', fetch });

  const agenda = await netvacinas.getAgenda('2026-01-03', '2026-01-08');

  assert.deepEqual(agenda.appointments.map((a) => a.internalId), ['a1', 'a2']);
  assert.deepEqual(agenda.scheduledShots.map((a) => a.internalId), ['s1']);
  assert.equal(chamadas.length, 3);
  assert.ok(chamadas.every((c) => c.opcoes.headers.Authorization === 'Bearer token'));
  assert.ok(chamadas.every((c) => c.corpo.variables.startDate === '2026-01-03T03:00:00.000Z'));
  assert.ok(chamadas.every((c) => c.corpo.variables.endDate === '2026-01-08T03:00:00.000Z'));
});

test('snapshot NetVacinas grava horários, vacinas e itens sem horário em tabela própria', () => {
  const store = criarStore(':memory:');
  const resultado = gravarSnapshotNetVacinas({
    store,
    agenda: {
      appointments: [{
        internalId: 'consulta-1', date: '2026-01-03', startTime: '09:30:00', endTime: '10:00:00',
        patients: [{ internalId: 'p1', name: 'Ana', whatsappPhoneNumber: '34999998888' }],
        shots: [{
          internalId: 'dose-1', vaccine: { internalId: 'v1', name: 'Influenza' },
          patient: { internalId: 'p1', name: 'Ana', whatsappPhoneNumber: '34999998888' },
        }],
      }],
      scheduledShots: [{
        internalId: 'agendada-1', date: '2026-01-04',
        patient: { internalId: 'p2', name: 'Bia', whatsappPhoneNumber: '34999997777' },
        vaccine: { internalId: 'v2', name: 'HPV' },
      }],
    },
    agora: new Date('2026-01-01T10:00:00Z'),
  });

  assert.deepEqual(resultado, { total: 2, elegiveis: 2 });
  const itens = store.agendaNetVacinasCompleta('2026-01-03', '2026-01-04');
  assert.equal(itens.length, 2);
  assert.deepEqual(itens.map((i) => i.chave), ['appointment:consulta-1:dose-1', 'scheduled-shot:agendada-1']);
  assert.equal(itens[0].inicio, '2026-01-03T09:30:00');
  assert.equal(itens[0].vacina, 'Influenza');
  assert.equal(itens[1].tem_horario, 0);
  assert.equal(itens[1].vacina, 'HPV');
  store.fechar();
});

test('envio manual NetVacinas usa o template de vacinas com horário e vacina', async () => {
  const store = criarStore(':memory:');
  store.upsertAgendaNetVacinasItem({
    chave: 'scheduled-shot:s0', id_externo: 's0', tipo: 'scheduled-shot', data_lote: '2026-01-04',
    inicio: '2026-01-04T00:00:00', fim: null, tem_horario: 0, id_paciente: 'p1',
    nome_paciente: 'Ana', telefone: '5534999998888', vacina: 'HPV', elegivel: 1, motivo: null,
    capturado_em: '2026-01-01T10:00:00Z',
  });
  store.upsertAgendaNetVacinasItem({
    chave: 'scheduled-shot:s1', id_externo: 's1', tipo: 'appointment', data_lote: '2026-01-04',
    inicio: '2026-01-04T09:30:00', fim: null, tem_horario: 1, id_paciente: 'p1',
    nome_paciente: 'Ana', telefone: '5534999998888', vacina: 'HPV', elegivel: 1, motivo: null,
    capturado_em: '2026-01-01T10:00:00Z',
  });
  const enviados = [];
  const maischat = { sendTemplate: async (envio) => { enviados.push(envio); return { idMensagem: 'wamid.1' }; } };
  const config = {
    templateNome: 'confirmacao', templateVariaveis: ['nome', 'medico', 'data', 'hora'],
    netvacinasNomeAgenda: 'NetVacinas', dryRun: false,
  };

  const semHorario = await enviarManualNetVacinas({
    maischat, store, config, chave: 'scheduled-shot:s0', agora: new Date('2026-01-01T12:00:00Z'),
  });
  assert.equal(semHorario.status, 400);

  const resultado = await enviarManualNetVacinas({
    maischat, store, config, chave: 'scheduled-shot:s1', agora: new Date('2026-01-01T12:00:00Z'),
  });

  assert.equal(resultado.ok, true);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].template, 'md_vacinas_kids_confirmacao_agendamento');
  assert.deepEqual(enviados[0].variaveis, ['Ana', '04/01/2026', '09:30', 'HPV']);
  assert.equal(store.jaEnviadoNetVacinas('scheduled-shot:s1'), true);
  store.fechar();
});

test('dashboard atualiza e expõe NetVacinas no mesmo período da MedX', async () => {
  const store = criarStore(':memory:');
  const config = {
    dashboardUser: 'admin', dashboardPassword: 'pw', sessionSecret: 's', runToken: 'rt',
    medicoCampoNome: 'Nome', templateNome: 'confirmacao', templateVariaveis: ['nome'],
    netvacinasNomeAgenda: 'NetVacinas', dryRun: true,
  };
  const medx = { getAgenda: async () => [], getUsuarios: async () => [] };
  const chamadas = [];
  const netvacinas = {
    getAgenda: async (inicio, fim) => {
      chamadas.push({ inicio, fim });
      return {
        appointments: [],
        scheduledShots: [{
          internalId: 's1', date: '2026-01-04',
          patient: { internalId: 'p1', name: 'Ana', whatsappPhoneNumber: '34999998888' },
          vaccine: { internalId: 'v1', name: 'HPV' },
        }],
      };
    },
  };
  const app = criarServidor({ store, config, medx, netvacinas, maischat: {}, executarEnvio: async () => ({}) });
  const server = app.listen(0);
  const porta = server.address().port;
  try {
    const login = await fetch(`http://127.0.0.1:${porta}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'usuario=admin&senha=pw',
    });
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const resposta = await fetch(
      `http://127.0.0.1:${porta}/api/atualizar-agenda?inicio=2026-01-03&fim=2026-01-04`,
      { method: 'POST', headers: { cookie } },
    );
    const dados = await resposta.json();
    assert.equal(resposta.status, 200);
    assert.deepEqual(chamadas, [{ inicio: '2026-01-03', fim: '2026-01-04' }]);
    assert.equal(dados.netvacinas.habilitado, true);
    assert.equal(dados.netvacinas.agenda[0].nome_paciente, 'Ana');
    assert.equal(dados.netvacinas.agenda[0].vacina, 'HPV');
  } finally {
    server.close();
    store.fechar();
  }
});

test('criarNetVacinasRest confirma pelo id com Bearer e propaga erro', async () => {
  const { criarNetVacinasRest } = await import('../src/netvacinas.js');
  const chamadas = [];
  const fetch = async (url, opts) => {
    chamadas.push({ url, opts });
    return url.endsWith('/999/confirm')
      ? { ok: false, status: 404, json: async () => ({ error: 'Não encontrado' }) }
      : { ok: true, status: 201, json: async () => ({ id: 483855, status: 'confirmed' }) };
  };
  const api = criarNetVacinasRest({ baseUrl: 'https://x/api/v1', token: 'tk', fetch });
  assert.deepEqual(await api.confirmarAgendamento('483855'), { id: 483855, status: 'confirmed' });
  assert.equal(chamadas[0].url, 'https://x/api/v1/appointments/483855/confirm');
  assert.equal(chamadas[0].opts.method, 'POST');
  assert.equal(chamadas[0].opts.headers.Authorization, 'Bearer tk');
  await assert.rejects(api.confirmarAgendamento('999'), /404: Não encontrado/);
});
