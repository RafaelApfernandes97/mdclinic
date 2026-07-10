import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmarPorTelefone, confirmarAgendamento, selecionarMaisProximo,
  resolverIdTipoConsulta, STATUS_CONFIRMADO,
} from '../src/confirmacao.js';

const TIPOS = [
  { Id_do_TipoConsulta: -2, TipoConsulta: 'Consulta' },
  { Id_do_TipoConsulta: -3, TipoConsulta: 'Retorno' },
];

// 2026-07-09 09:00 BRT (=12:00 UTC): "hoje" = 2026-07-09, "amanhã" = 2026-07-10.
const AGORA = new Date('2026-07-09T12:00:00Z');

function medxFake({ agenda, onUpdate } = {}) {
  const chamadas = [];
  return {
    _chamadas: chamadas,
    getAgenda: async (inicio, fim) => { chamadas.push({ inicio, fim }); return agenda ?? []; },
    getTiposAgendamento: async () => TIPOS,
    atualizarStatus: async (item, status, opts) => {
      onUpdate?.({ item, status, opts });
      return 'Success';
    },
  };
}

test('resolverIdTipoConsulta: mapeia nome->id, tolera nulo/desconhecido', () => {
  assert.equal(resolverIdTipoConsulta(TIPOS, 'Consulta'), -2);
  assert.equal(resolverIdTipoConsulta(TIPOS, 'consulta'), -2);
  assert.equal(resolverIdTipoConsulta(TIPOS, 'Retorno'), -3);
  assert.equal(resolverIdTipoConsulta(TIPOS, null), null);
  assert.equal(resolverIdTipoConsulta(TIPOS, ''), null);
  assert.equal(resolverIdTipoConsulta(TIPOS, 'Inexistente'), null);
});

test('selecionarMaisProximo: pega o menor Inicio ainda não passado do telefone', () => {
  const agenda = [
    { Id_Agendamento: 1, SMS: '11911761633', Inicio: '2026-07-09T08:00:00' }, // passou
    { Id_Agendamento: 2, SMS: '11911761633', Inicio: '2026-07-09T18:00:00' }, // próximo
    { Id_Agendamento: 3, SMS: '11911761633', Inicio: '2026-07-10T09:00:00' }, // amanhã
    { Id_Agendamento: 4, SMS: '34999990000', Inicio: '2026-07-09T10:00:00' }, // outro telefone
  ];
  const item = selecionarMaisProximo(agenda, '11911761633', '2026-07-09T09:00:00');
  assert.equal(item.Id_Agendamento, 2);
});

test('selecionarMaisProximo: null quando telefone inválido ou sem match', () => {
  assert.equal(selecionarMaisProximo([], '', '2026-07-09T09:00:00'), null);
  assert.equal(selecionarMaisProximo([{ SMS: '34999990000', Inicio: '2026-07-09T18:00:00' }],
    '11911761633', '2026-07-09T09:00:00'), null);
});

test('confirmarPorTelefone aplica CONFIRMADO com tipo resolvido, busca hoje..hoje+15', async () => {
  let chamada = null;
  const agenda = [
    { Id_Agendamento: -19659252, Status: 1, SMS: '11911761633', TipoAgendamento: 'Consulta', Inicio: '2026-07-09T18:00:00' },
  ];
  const medx = medxFake({ agenda, onUpdate: (c) => { chamada = c; } });
  const r = await confirmarPorTelefone({ medx, telefone: '11911761633', agora: AGORA });
  assert.equal(r.success, true);
  assert.equal(r.idAgendamento, -19659252);
  assert.equal(r.statusAplicado, 'CONFIRMADO');
  assert.equal(r.jaConfirmado, false);
  assert.equal(chamada.status, STATUS_CONFIRMADO);
  assert.equal(chamada.opts.confirmar, true);
  assert.equal(chamada.opts.idTipoConsulta, -2);
  // janela: hoje até hoje+15 (JANELA_CONFIRMACAO_DIAS default)
  assert.deepEqual(medx._chamadas[0], { inicio: '2026-07-09', fim: '2026-07-24' });
});

test('confirmarPorTelefone respeita janelaDias customizada', async () => {
  const agenda = [{ Id_Agendamento: 5, Status: 1, SMS: '11911761633', TipoAgendamento: 'Consulta', Inicio: '2026-07-11T09:00:00' }];
  const medx = medxFake({ agenda });
  const r = await confirmarPorTelefone({ medx, telefone: '11911761633', agora: AGORA, janelaDias: 3 });
  assert.equal(r.success, true);
  assert.deepEqual(medx._chamadas[0], { inicio: '2026-07-09', fim: '2026-07-12' });
});

test('confirmarPorTelefone: sexta confirma agendamento de segunda (próximo dia útil)', async () => {
  // 2026-07-10 é sexta; envio D+1 útil mira segunda 2026-07-13.
  const sexta = new Date('2026-07-10T12:00:00Z');
  const agenda = [{ Id_Agendamento: 9, Status: 1, SMS: '11911761633', TipoAgendamento: 'Consulta', Inicio: '2026-07-13T09:00:00' }];
  const medx = medxFake({ agenda });
  const r = await confirmarPorTelefone({ medx, telefone: '11911761633', agora: sexta });
  assert.equal(r.success, true);
  assert.equal(r.idAgendamento, 9);
});

test('confirmarPorTelefone: envio 15 dias — confirma agendamento distante, mas prioriza o mais próximo', async () => {
  const agenda = [
    { Id_Agendamento: 20, Status: 1, SMS: '11911761633', TipoAgendamento: 'Consulta', Inicio: '2026-07-23T10:00:00' }, // 15d à frente
    { Id_Agendamento: 21, Status: 1, SMS: '11911761633', TipoAgendamento: 'Consulta', Inicio: '2026-07-10T10:00:00' }, // amanhã
  ];
  const medx = medxFake({ agenda });
  const r = await confirmarPorTelefone({ medx, telefone: '11911761633', agora: AGORA });
  assert.equal(r.success, true);
  assert.equal(r.idAgendamento, 21); // mais próximo vence

  // sem o de amanhã, confirma o de 15 dias
  const medx2 = medxFake({ agenda: [agenda[0]] });
  const r2 = await confirmarPorTelefone({ medx: medx2, telefone: '11911761633', agora: AGORA });
  assert.equal(r2.success, true);
  assert.equal(r2.idAgendamento, 20);
});

test('confirmarPorTelefone normaliza telefone (aceita formatos diferentes)', async () => {
  const agenda = [{ Id_Agendamento: 7, Status: 1, SMS: '11911761633', TipoAgendamento: 'Consulta', Inicio: '2026-07-09T18:00:00' }];
  const medx = medxFake({ agenda });
  const r = await confirmarPorTelefone({ medx, telefone: '(11) 91176-1633', agora: AGORA });
  assert.equal(r.success, true);
  assert.equal(r.idAgendamento, 7);
  assert.equal(r.telefone, '5511911761633');
});

test('confirmarPorTelefone é idempotente (já CONFIRMADO não reescreve)', async () => {
  let escreveu = false;
  const agenda = [{ Id_Agendamento: 7, Status: STATUS_CONFIRMADO, SMS: '11911761633', Inicio: '2026-07-09T18:00:00' }];
  const medx = medxFake({ agenda, onUpdate: () => { escreveu = true; } });
  const r = await confirmarPorTelefone({ medx, telefone: '11911761633', agora: AGORA });
  assert.equal(r.success, true);
  assert.equal(r.jaConfirmado, true);
  assert.equal(escreveu, false);
});

test('confirmarPorTelefone 404 quando não há agendamento futuro do telefone', async () => {
  const agenda = [{ Id_Agendamento: 1, Status: 1, SMS: '11911761633', Inicio: '2026-07-09T08:00:00' }]; // passou
  const medx = medxFake({ agenda });
  const r = await confirmarPorTelefone({ medx, telefone: '11911761633', agora: AGORA });
  assert.equal(r.success, false);
  assert.equal(r.status, 404);
});

test('confirmarPorTelefone 400 telefone inválido', async () => {
  const medx = medxFake({ agenda: [] });
  const r = await confirmarPorTelefone({ medx, telefone: '123', agora: AGORA });
  assert.equal(r.success, false);
  assert.equal(r.status, 400);
});

test('confirmarAgendamento (por id) segue funcionando', async () => {
  const agenda = [{ Id_Agendamento: -19659252, Status: 1, TipoAgendamento: 'Consulta' }];
  const medx = medxFake({ agenda });
  const r = await confirmarAgendamento({ medx, idAgendamento: -19659252, data: '2026-07-09' });
  assert.equal(r.success, true);
  assert.equal(r.statusAplicado, 'CONFIRMADO');
});
