import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugMedico, resolverTemplate, resolverTemplateEnvioMassa, montarVariaveisTemplate } from '../src/templates.js';

const config = { templateNome: 'confirmacao_agendamento', templateVariaveis: ['nome', 'dia', 'hora_curta'] };

test('slugMedico reduz o nome exibido ao formato do login MedX', () => {
  assert.equal(slugMedico('Dra Livia Araujo'), 'draliviaaraujo');
  assert.equal(slugMedico('Dra Marina de Deus'), 'dramarinadedeus');
  assert.equal(slugMedico('Dr Vitor Ganem'), 'drvitorganem');
  assert.equal(slugMedico('Dra. Lívia Araújo'), 'draliviaaraujo'); // pontuação e acentos
  assert.equal(slugMedico(null), '');
});

test('resolverTemplate: agendas com template próprio', () => {
  assert.deepEqual(resolverTemplate('Dra Livia Araujo', config), {
    templateNome: 'confirmar_dralivia', ordem: ['saudacao', 'data_curta', 'hora'],
  });
  assert.deepEqual(resolverTemplate('Dr Vitor Ganem', config), {
    templateNome: 'confimar_drvitor', ordem: ['nome', 'dia', 'hora'],
  });
  assert.deepEqual(resolverTemplate('Dra Marina de Deus', config), {
    templateNome: 'confirmar_dramarina', ordem: ['saudacao', 'nome', 'data_curta', 'hora_h'],
  });
});

test('resolverTemplate: MD Exames e MD Hair (logins do MedX normalizados)', async () => {
  const { normalizarNomeMedico } = await import('../src/nomes.js');
  assert.deepEqual(resolverTemplate(normalizarNomeMedico('MD EXAMES'), config), {
    templateNome: 'confirmar_mdexames', ordem: ['nome', 'dia', 'hora'],
  });
  assert.deepEqual(resolverTemplate(normalizarNomeMedico('mdhair'), config), {
    templateNome: 'confirmar_mdhair', ordem: ['nome', 'dia', 'hora'],
  });
  assert.deepEqual(
    montarVariaveisTemplate({ nomePaciente: 'Adriano', nomeMedico: 'Md Exames', inicio: '2026-10-21T08:10:00', ordem: ['nome', 'dia', 'hora'] }),
    ['Adriano', 'Quarta-feira 21/10', '08:10'],
  );
});

test('resolverTemplate: demais agendas caem no template padrão (MD Infusion)', () => {
  assert.deepEqual(resolverTemplate('Md Infusion', config), {
    templateNome: 'confirmacao_agendamento', ordem: ['nome', 'dia', 'hora_curta'],
  });
  assert.deepEqual(resolverTemplate('Desconhecido', config), {
    templateNome: 'confirmacao_agendamento', ordem: ['nome', 'dia', 'hora_curta'],
  });
});

test('resolverTemplateEnvioMassa: Dra Marina usa o template de campanha (data + hora)', () => {
  assert.deepEqual(resolverTemplateEnvioMassa('Dra Marina de Deus', config), {
    templateNome: 'confirmacao_dr_marina_7dias', ordem: ['data_curta', 'hora_h'],
  });
});

test('resolverTemplateEnvioMassa: demais agendas usam o mesmo template do envio manual', () => {
  assert.deepEqual(resolverTemplateEnvioMassa('Dra Livia Araujo', config), {
    templateNome: 'confirmar_dralivia', ordem: ['saudacao', 'data_curta', 'hora'],
  });
  assert.deepEqual(resolverTemplateEnvioMassa('Md Infusion', config), {
    templateNome: 'confirmacao_agendamento', ordem: ['nome', 'dia', 'hora_curta'],
  });
});

test('montarVariaveisTemplate preenche cada chave', () => {
  // 08:00 BRT => saudação "Bom dia"; 2026-06-24 é quarta-feira
  const agora = new Date('2026-06-23T11:00:00Z');
  const base = { nomePaciente: 'Joao', nomeMedico: 'Dra Marina de Deus', inicio: '2026-06-24T14:30:00', agora };
  assert.deepEqual(
    montarVariaveisTemplate({ ...base, ordem: ['saudacao', 'nome', 'data_curta', 'hora_h'] }),
    ['Bom dia', 'Joao', '24/06', '14h30'],
  );
  assert.deepEqual(
    montarVariaveisTemplate({ ...base, ordem: ['nome', 'dia', 'hora'] }),
    ['Joao', 'Quarta-feira 24/06', '14:30'],
  );
  assert.deepEqual(
    montarVariaveisTemplate({ ...base, ordem: ['nome', 'medico', 'data', 'hora_curta'] }),
    ['Joao', 'Marina de Deus', '24/06/2026', '14:30'],
  );
  assert.deepEqual(montarVariaveisTemplate({ ...base, ordem: ['inexistente'] }), ['']);
});
