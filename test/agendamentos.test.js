import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extrairNomePaciente, normalizarTelefone, ehBloqueio, ehDesmarcado, ehElegivel, montarEnvio,
} from '../src/agendamentos.js';

test('extrairNomePaciente pega o trecho antes da primeira vírgula', () => {
  assert.equal(extrairNomePaciente('JOAO DA SILVA, obs, fone'), 'JOAO DA SILVA');
  assert.equal(extrairNomePaciente('MARIA'), 'MARIA');
});

test('normalizarTelefone formata número BR', () => {
  assert.equal(normalizarTelefone('34999998888'), '5534999998888');
  assert.equal(normalizarTelefone('(34) 99999-8888'), '5534999998888');
  assert.equal(normalizarTelefone('5534999998888'), '5534999998888');
  assert.equal(normalizarTelefone(''), null);
  assert.equal(normalizarTelefone('123'), null);
});

test('ehBloqueio detecta palavras-chave (case-insensitive)', () => {
  assert.equal(ehBloqueio('FECHADA (SEQUENCIAL)'), true);
  assert.equal(ehBloqueio('horario bloqueado'), true);
  assert.equal(ehBloqueio('Joao da Silva, consulta'), false);
});

test('ehDesmarcado detecta Status 0 (DESMARCADO) e ignora demais', () => {
  assert.equal(ehDesmarcado({ Status: 0 }), true);
  assert.equal(ehDesmarcado({ Status: 8 }), false); // CONFIRMADO
  assert.equal(ehDesmarcado({ Status: 1 }), false); // PRIMEIRA CONSULTA
  assert.equal(ehDesmarcado({}), false);            // sem Status => não desmarcado
});

test('ehElegivel exige SMS, paciente, não-bloqueio e não-desmarcado', () => {
  assert.equal(ehElegivel({ SMS: '34999998888', Id_Paciente: 10, Descricao: 'Joao' }), true);
  assert.equal(ehElegivel({ SMS: '', Id_Paciente: 10, Descricao: 'Joao' }), false);
  assert.equal(ehElegivel({ SMS: '34999998888', Id_Paciente: 0, Descricao: 'Joao' }), false);
  assert.equal(ehElegivel({ SMS: '34999998888', Id_Paciente: 10, Descricao: 'FECHADA' }), false);
  // desmarcado no MedX não recebe confirmação, mesmo com paciente + telefone válidos
  assert.equal(ehElegivel({ SMS: '34999998888', Id_Paciente: 10, Descricao: 'Joao', Status: 0 }), false);
  assert.equal(ehElegivel({ SMS: '34999998888', Id_Paciente: 10, Descricao: 'Joao', Status: 8 }), true);
});

test('montarEnvio normaliza e resolve médico', () => {
  const mapa = new Map([[-1212054111, 'Dra. Marina']]);
  const item = {
    Id_Agendamento: 1, Id_Paciente: 99, Id_Usuario: -1212054111,
    SMS: '(34) 99999-8888', Descricao: 'JOAO, obs', Inicio: '2026-06-30T18:20:00',
  };
  const e = montarEnvio(item, mapa);
  assert.equal(e.nome_paciente, 'JOAO');
  assert.equal(e.telefone, '5534999998888');
  assert.equal(e.nome_medico, 'Dra. Marina');
  assert.equal(e.data_br, '30/06/2026');
  assert.equal(e.hora_br, '18:20');
});
