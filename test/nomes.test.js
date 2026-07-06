import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarNomeMedico } from '../src/nomes.js';

test('normalizarNomeMedico: logins conhecidos do MedX', () => {
  assert.equal(normalizarNomeMedico('draliviaaraujo'), 'Dra Livia Araujo');
  assert.equal(normalizarNomeMedico('dramarinadedeus'), 'Dra Marina de Deus');
  assert.equal(normalizarNomeMedico('drvitorganem'), 'Dr Vitor Ganem');
  // case-insensitive
  assert.equal(normalizarNomeMedico('DrVitorGanem'), 'Dr Vitor Ganem');
});

test('normalizarNomeMedico: heurística para logins colados desconhecidos', () => {
  assert.equal(normalizarNomeMedico('dramarina'), 'Dra Marina');
  assert.equal(normalizarNomeMedico('drcarlos'), 'Dr Carlos');
});

test('normalizarNomeMedico: nomes com separadores', () => {
  assert.equal(normalizarNomeMedico('Dra. Marina'), 'Dra Marina');
  assert.equal(normalizarNomeMedico('dra marina de deus'), 'Dra Marina de Deus');
  assert.equal(normalizarNomeMedico('marina.de.deus'), 'Marina de Deus');
});

test('normalizarNomeMedico: entradas vazias ou sem padrão', () => {
  assert.equal(normalizarNomeMedico(''), 'Desconhecido');
  assert.equal(normalizarNomeMedico(null), 'Desconhecido');
  assert.equal(normalizarNomeMedico('recepcao'), 'Recepcao');
});

test('nomeSemTitulo: remove Dr/Dra do início (só p/ variável do template)', async () => {
  const { nomeSemTitulo } = await import('../src/nomes.js');
  assert.equal(nomeSemTitulo('Dra Livia Araujo'), 'Livia Araujo');
  assert.equal(nomeSemTitulo('Dra Marina de Deus'), 'Marina de Deus');
  assert.equal(nomeSemTitulo('Dr Vitor Ganem'), 'Vitor Ganem');
  assert.equal(nomeSemTitulo('Dra. Marina'), 'Marina');
  // não mexe em nomes sem título nem em "Dr" no meio
  assert.equal(nomeSemTitulo('Marina de Deus'), 'Marina de Deus');
  assert.equal(nomeSemTitulo('Adriana Drumond'), 'Adriana Drumond');
  assert.equal(nomeSemTitulo(null), '');
});
