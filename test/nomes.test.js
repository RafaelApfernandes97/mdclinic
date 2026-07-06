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
