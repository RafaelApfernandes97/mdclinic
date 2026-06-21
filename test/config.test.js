import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carregarConfig } from '../src/config.js';

const minimo = {
  MEDX_BASE_URL: 'http://medx', MEDX_TOKEN_INTEGRACAO: 't',
  MAISCHAT_BASE_URL: 'http://mc', MAISCHAT_TOKEN: 'k',
  MAISCHAT_TEMPLATE_NOME: 'tpl', DASHBOARD_PASSWORD: 'p',
  SESSION_SECRET: 's', RUN_TOKEN: 'r',
};

test('carrega defaults', () => {
  const c = carregarConfig(minimo);
  assert.equal(c.cronHorario, '0 8 * * *');
  assert.equal(c.ackPasse1Min, 5);
  assert.equal(c.ackPasse2Min, 60);
  assert.deepEqual(c.templateVariaveis, ['nome', 'medico', 'data', 'hora']);
  assert.equal(c.port, 3000);
});

test('lança erro se faltar obrigatória', () => {
  const { MEDX_TOKEN_INTEGRACAO, ...semToken } = minimo;
  assert.throws(() => carregarConfig(semToken), /MEDX_TOKEN_INTEGRACAO/);
});
