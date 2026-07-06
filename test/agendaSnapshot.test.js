import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarItem, gravarSnapshot, snapshotAgenda, mapaMedicos } from '../src/agendaSnapshot.js';
import { criarStore } from '../src/store.js';

test('classificarItem: motivo por precedência', () => {
  assert.deepEqual(classificarItem({ Descricao: 'FECHADA', Id_Paciente: 5, SMS: '34999998888' }),
    { elegivel: 0, motivo: 'bloqueio' });
  assert.deepEqual(classificarItem({ Descricao: 'JOAO', Id_Paciente: 0, SMS: '34999998888' }),
    { elegivel: 0, motivo: 'sem_paciente' });
  assert.deepEqual(classificarItem({ Descricao: 'JOAO', Id_Paciente: 5, SMS: '' }),
    { elegivel: 0, motivo: 'sem_telefone' });
  assert.deepEqual(classificarItem({ Descricao: 'JOAO', Id_Paciente: 5, SMS: '34999998888' }),
    { elegivel: 1, motivo: null });
});

test('mapaMedicos: aceita formato real do MedX (IddoUsuario/Usuario)', () => {
  const m = mapaMedicos([
    { IddoUsuario: -1212054111, Usuario: 'dramarinadedeus' },
    { IddoUsuario: 578834368, Usuario: 'draliviaaraujo' },
  ], 'Usuario');
  assert.equal(m.get(-1212054111), 'Dra Marina de Deus');
  assert.equal(m.get(578834368), 'Dra Livia Araujo');
});

test('gravarSnapshot persiste todos os médicos do mapa (mesmo sem agenda)', () => {
  const store = criarStore(':memory:');
  const mapa = mapaMedicos([
    { IddoUsuario: 7, Usuario: 'dramarina' },
    { IddoUsuario: 8, Usuario: 'drcarlos' },
  ], 'Usuario');
  gravarSnapshot({ store, agenda: [], mapa, dataLote: '2026-06-24', agora: new Date('2026-06-23T08:00:00Z') });
  // listarMedicos já vem ordenado por nome ('Dr Carlos' < 'Dra Marina')
  assert.deepEqual(store.listarMedicos().map((m) => m.nome), ['Dr Carlos', 'Dra Marina']);
  store.fechar();
});

test('gravarSnapshot grava todos os itens (elegíveis + pulados) sem enviar', () => {
  const store = criarStore(':memory:');
  const agenda = [
    { Id_Agendamento: 1, Id_Paciente: 9, Id_Usuario: 7, SMS: '34999998888', Descricao: 'JOAO, obs', Inicio: '2026-06-24T10:00:00' },
    { Id_Agendamento: 2, Id_Paciente: 0, Id_Usuario: 7, SMS: '', Descricao: 'FECHADA', Inicio: '2026-06-24T11:00:00' },
  ];
  const mapa = mapaMedicos([{ Id_Usuario: 7, Nome: 'Dra. Marina' }], 'Nome');
  const r = gravarSnapshot({ store, agenda, mapa, dataLote: '2026-06-24', agora: new Date('2026-06-23T08:00:00Z') });
  assert.deepEqual(r, { dataLote: '2026-06-24', total: 2, elegiveis: 1 });
  const ag = store.agendaCompleta('2026-06-24');
  assert.equal(ag.length, 2);
  assert.equal(ag.find((x) => x.nome_paciente === 'JOAO').elegivel, 1);
  assert.equal(ag.find((x) => x.motivo === 'bloqueio').elegivel, 0);
  store.fechar();
});

test('snapshotAgenda busca MedX ao vivo e grava', async () => {
  const store = criarStore(':memory:');
  const medx = {
    getAgenda: async () => [{ Id_Agendamento: 5, Id_Paciente: 1, Id_Usuario: 7, SMS: '34999990000', Descricao: 'MARIA', Inicio: '2026-06-24T09:00:00' }],
    getUsuarios: async () => [{ Id_Usuario: 7, Nome: 'Dra. Marina' }],
  };
  const r = await snapshotAgenda({ medx, store, config: { medicoCampoNome: 'Nome' }, dataLote: '2026-06-24' });
  assert.equal(r.total, 1);
  assert.equal(store.agendaCompleta('2026-06-24')[0].nome_medico, 'Dra Marina');
  store.fechar();
});
