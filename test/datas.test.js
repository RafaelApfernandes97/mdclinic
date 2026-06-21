import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amanhaISO, formatarDataBR, formatarHoraBR } from '../src/datas.js';

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
