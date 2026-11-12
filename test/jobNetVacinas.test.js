import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executarJobNetVacinas } from '../src/jobNetVacinas.js';
import { criarStore } from '../src/store.js';

const pac = (id, nome, fone) => ({ internalId: id, name: nome, whatsappPhoneNumber: fone });

function deps({ dryRun = false, falhar = false } = {}) {
  const maria = pac(1, 'Maria', '(34) 99999-8888');
  const agenda = {
    appointments: [
      { internalId: 10, date: '2026-11-16T03:00:00.000Z', startTime: '09:30:00', endTime: '09:45:00',
        patients: [maria],
        shots: [
          { internalId: 100, vaccine: { name: 'Influenza' }, patient: maria },
          { internalId: 101, vaccine: { name: 'Hepatite B' }, patient: maria },
        ] },
      { internalId: 11, date: '2026-11-16T03:00:00.000Z', startTime: '10:00:00',
        patients: [pac(2, 'Sem Fone', null)],
        shots: [{ internalId: 102, vaccine: { name: 'BCG' }, patient: pac(2, 'Sem Fone', null) }] },
    ],
    // Duplicata dos shots do appointment, sem horário: não pode gerar envio.
    scheduledShots: [{ internalId: 100, date: '2026-11-16T03:00:00.000Z', patient: maria, vaccine: { name: 'Influenza' } }],
  };
  const enviados = [];
  const maischat = {
    sendTemplate: async (p) => {
      if (falhar) throw new Error('boom');
      enviados.push(p); return { idMensagem: 'wamid-' + enviados.length };
    },
  };
  const store = criarStore(':memory:');
  const config = { netvacinasNomeAgenda: 'NetVacinas', ackPasse1Min: 5, ackPasse2Min: 60, dryRun,
    templateNome: 'padrao', templateVariaveis: ['nome'] };
  const netvacinas = { getAgenda: async () => agenda };
  return { netvacinas, maischat, store, config, enviados };
}

const SEXTA = new Date('2026-11-13T11:00:00Z'); // base = segunda 16/11

test('uma mensagem por agendamento, vacinas juntas, só appointment', async () => {
  const d = deps();
  const r = await executarJobNetVacinas({ ...d, agora: SEXTA });
  assert.equal(r.dataLote, '2026-11-16');
  assert.equal(r.enviados, 1);
  assert.equal(d.enviados.length, 1);
  assert.equal(d.enviados[0].template, 'md_vacinas_kids_confirmacao_agendamento');
  assert.deepEqual(d.enviados[0].variaveis, ['Maria', '16/11/2026', '09:30', 'Influenza, Hepatite B']);
  assert.equal(d.store.jaEnviadoNetVacinas('appointment:10:100'), true);
  assert.equal(d.store.jaEnviadoNetVacinas('appointment:10:101'), true);
  assert.equal(d.store.passesPendentes('2099-01-01T00:00:00Z').length, 2);
});

test('não reenvia no segundo disparo', async () => {
  const d = deps();
  await executarJobNetVacinas({ ...d, agora: SEXTA });
  const r = await executarJobNetVacinas({ ...d, agora: SEXTA });
  assert.equal(r.enviados, 0);
  assert.equal(d.enviados.length, 1);
});

test('dry run não envia nem registra', async () => {
  const d = deps({ dryRun: true });
  const r = await executarJobNetVacinas({ ...d, agora: SEXTA });
  assert.equal(r.simulados, 1);
  assert.equal(d.enviados.length, 0);
  assert.equal(d.store.jaEnviadoNetVacinas('appointment:10:100'), false);
});

test('falha registra erro e permite reenvio', async () => {
  const d = deps({ falhar: true });
  const r = await executarJobNetVacinas({ ...d, agora: SEXTA });
  assert.equal(r.erros, 1);
  assert.equal(d.store.jaEnviadoNetVacinas('appointment:10:100'), false);
  assert.equal(d.store.agendaNetVacinasCompleta('2026-11-16').find((i) => i.chave === 'appointment:10:100').ack, 'falha');
});
