import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amanhaISO, somaDiasISO, ehFimDeSemanaBR, proximoDiaUtilISO,
  formatarDataBR, formatarHoraBR, formatarDiaTemplate, formatarHoraTemplate,
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

test('somaDiasISO soma dias (aritmética de calendário)', () => {
  assert.equal(somaDiasISO('2026-07-13', 14), '2026-07-27');
  assert.equal(somaDiasISO('2026-07-13', 0), '2026-07-13');
  assert.equal(somaDiasISO('2026-07-31', 1), '2026-08-01');
});

test('ehFimDeSemanaBR: sábado/domingo true, dias úteis false', () => {
  assert.equal(ehFimDeSemanaBR(new Date('2026-07-11T12:00:00Z')), true);  // sábado
  assert.equal(ehFimDeSemanaBR(new Date('2026-07-12T12:00:00Z')), true);  // domingo
  assert.equal(ehFimDeSemanaBR(new Date('2026-07-10T12:00:00Z')), false); // sexta
  assert.equal(ehFimDeSemanaBR(new Date('2026-07-13T12:00:00Z')), false); // segunda
  // 02:00Z de sábado ainda é sexta 23:00 no fuso BR => dia útil
  assert.equal(ehFimDeSemanaBR(new Date('2026-07-11T02:00:00Z')), false);
});

test('proximoDiaUtilISO: pula fim de semana (sexta -> segunda)', () => {
  assert.equal(proximoDiaUtilISO(new Date('2026-07-10T12:00:00Z')), '2026-07-13'); // sexta -> seg
  assert.equal(proximoDiaUtilISO(new Date('2026-07-11T12:00:00Z')), '2026-07-13'); // sáb -> seg
  assert.equal(proximoDiaUtilISO(new Date('2026-07-12T12:00:00Z')), '2026-07-13'); // dom -> seg
  assert.equal(proximoDiaUtilISO(new Date('2026-07-13T12:00:00Z')), '2026-07-14'); // seg -> ter
  assert.equal(proximoDiaUtilISO(new Date('2026-07-09T12:00:00Z')), '2026-07-10'); // qui -> sex
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
