import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amanhaISO, formatarDataBR, formatarHoraBR, formatarDiaTemplate, formatarHoraTemplate,
  formatarDataCurta, formatarHoraH, saudacaoBR,
} from '../src/datas.js';

test('amanhaISO retorna o dia seguinte no fuso BR', () => {
  // 2026-06-21T23:00:00Z = 20:00 BRT do dia 21 → amanhã = 22
  const agora = new Date('2026-06-21T23:00:00Z');
  assert.equal(amanhaISO(agora), '2026-06-22');
});

test('amanhaISO trata virada de dia em UTC que ainda é o mesmo dia no BR', () => {
  // 2026-06-22T02:00:00Z = 23:00 BRT do dia 21 → amanhã = 22
  const agora = new Date('2026-06-22T02:00:00Z');
  assert.equal(amanhaISO(agora), '2026-06-22');
});

test('formatarDataBR e formatarHoraBR', () => {
  assert.equal(formatarDataBR('2026-06-30T18:20:00'), '30/06/2026');
  assert.equal(formatarHoraBR('2026-06-30T18:20:00'), '18:20');
});

test('formatarDiaTemplate retorna dia da semana capitalizado com dd/mm', () => {
  assert.equal(formatarDiaTemplate('2026-07-14T14:00:00'), 'Terça-feira 14/07');
  assert.equal(formatarDiaTemplate('2026-07-12T08:00:00'), 'Domingo 12/07');
  assert.equal(formatarDiaTemplate('2026-07-18T10:30:00'), 'Sábado 18/07');
});

test('formatarHoraTemplate omite minutos quando são 00', () => {
  assert.equal(formatarHoraTemplate('2026-07-14T14:00:00'), '14');
  assert.equal(formatarHoraTemplate('2026-07-14T14:30:00'), '14:30');
  assert.equal(formatarHoraTemplate('2026-07-14T08:00:00'), '8');
});

test('formatarDataCurta retorna dd/mm', () => {
  assert.equal(formatarDataCurta('2026-07-14T14:00:00'), '14/07');
  assert.equal(formatarDataCurta('2026-06-07T08:00:00'), '07/06');
});

test('formatarHoraH usa o formato 14h / 14h30', () => {
  assert.equal(formatarHoraH('2026-07-14T14:00:00'), '14h');
  assert.equal(formatarHoraH('2026-07-14T14:30:00'), '14h30');
  assert.equal(formatarHoraH('2026-07-14T08:00:00'), '8h');
});

test('saudacaoBR conforme a hora no fuso BR', () => {
  assert.equal(saudacaoBR(new Date('2026-07-06T11:00:00Z')), 'Bom dia');   // 08:00 BRT
  assert.equal(saudacaoBR(new Date('2026-07-06T14:59:00Z')), 'Bom dia');   // 11:59 BRT
  assert.equal(saudacaoBR(new Date('2026-07-06T15:00:00Z')), 'Boa tarde'); // 12:00 BRT
  assert.equal(saudacaoBR(new Date('2026-07-06T20:59:00Z')), 'Boa tarde'); // 17:59 BRT
  assert.equal(saudacaoBR(new Date('2026-07-06T21:00:00Z')), 'Boa noite'); // 18:00 BRT
  assert.equal(saudacaoBR(new Date('2026-07-07T02:00:00Z')), 'Boa noite'); // 23:00 BRT
});
