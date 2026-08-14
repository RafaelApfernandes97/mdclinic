import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carregarConfig } from '../src/config.js';

const minimo = {
  MEDX_BASE_URL: 'http://medx', MEDX_TOKEN_INTEGRACAO: 't',
  MAISCHAT_BASE_URL: 'http://mc',
  MAISCHAT_APP_ID: 'app', MAISCHAT_SOURCE: '5511', MAISCHAT_META_TOKEN: 'meta',
  MAISCHAT_TEMPLATE_NOME: 'tpl', DASHBOARD_PASSWORD: 'p',
  SESSION_SECRET: 's', RUN_TOKEN: 'r',
};

test('carrega defaults', () => {
  const c = carregarConfig(minimo);
  assert.equal(c.cronHorario, '0 8 * * *');
  assert.equal(c.ackPasse1Min, 5);
  assert.equal(c.ackPasse2Min, 60);
  assert.equal(c.janelaConfirmacaoDias, 4);
  assert.deepEqual(c.templateVariaveis, ['nome', 'medico', 'data', 'hora']);
  assert.equal(c.port, 5300);
  assert.equal(c.maischatBroker, 'wppCloudAPI');
  assert.equal(c.maischatApiKey, null);
});

test('dryRun: padrão false, true só quando DRY_RUN==="true"', () => {
  assert.equal(carregarConfig(minimo).dryRun, false);
  assert.equal(carregarConfig({ ...minimo, DRY_RUN: 'true' }).dryRun, true);
  assert.equal(carregarConfig({ ...minimo, DRY_RUN: 'false' }).dryRun, false);
  assert.equal(carregarConfig({ ...minimo, DRY_RUN: '1' }).dryRun, false);
});

test('lança erro se faltar credencial do Mais Chat', () => {
  const { MAISCHAT_META_TOKEN, ...semMeta } = minimo;
  assert.throws(() => carregarConfig(semMeta), /MAISCHAT_META_TOKEN/);
});

test('lança erro se faltar obrigatória', () => {
  const { MEDX_TOKEN_INTEGRACAO, ...semToken } = minimo;
  assert.throws(() => carregarConfig(semToken), /MEDX_TOKEN_INTEGRACAO/);
});
