import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS envios (
  id_agendamento INTEGER PRIMARY KEY,
  id_paciente INTEGER,
  nome_paciente TEXT,
  telefone TEXT,
  id_usuario INTEGER,
  nome_medico TEXT,
  inicio TEXT,
  id_mensagem TEXT,
  status_envio TEXT,
  ack TEXT,
  ack_atualizado_em TEXT,
  data_envio TEXT,
  data_lote TEXT,
  erro TEXT
);
CREATE INDEX IF NOT EXISTS idx_envios_lote ON envios(data_lote);
CREATE TABLE IF NOT EXISTS lotes (
  data_lote TEXT PRIMARY KEY,
  fim_campanha TEXT,
  passe1_em TEXT,
  passe1_feito INTEGER DEFAULT 0,
  passe2_em TEXT,
  passe2_feito INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS agenda_itens (
  id_agendamento INTEGER PRIMARY KEY,
  data_lote      TEXT,
  id_usuario     INTEGER,
  nome_medico    TEXT,
  id_paciente    INTEGER,
  nome_paciente  TEXT,
  telefone       TEXT,
  inicio         TEXT,
  elegivel       INTEGER,
  motivo         TEXT,
  descricao      TEXT,
  capturado_em   TEXT
);
CREATE INDEX IF NOT EXISTS idx_agenda_lote ON agenda_itens(data_lote);
CREATE TABLE IF NOT EXISTS medicos (
  id_usuario INTEGER PRIMARY KEY,
  nome       TEXT
);
`;

export function criarStore(caminho) {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);

  const upsertEnvio = db.prepare(`
    INSERT INTO envios (id_agendamento, id_paciente, nome_paciente, telefone, id_usuario,
      nome_medico, inicio, id_mensagem, status_envio, ack, ack_atualizado_em,
      data_envio, data_lote, erro)
    VALUES (@id_agendamento, @id_paciente, @nome_paciente, @telefone, @id_usuario,
      @nome_medico, @inicio, @id_mensagem, @status_envio, @ack, @ack_atualizado_em,
      @data_envio, @data_lote, @erro)
    ON CONFLICT(id_agendamento) DO UPDATE SET
      id_mensagem=excluded.id_mensagem, status_envio=excluded.status_envio,
      ack=excluded.ack, data_envio=excluded.data_envio, erro=excluded.erro
  `);

  const upsertAgenda = db.prepare(`
    INSERT INTO agenda_itens (id_agendamento, data_lote, id_usuario, nome_medico,
      id_paciente, nome_paciente, telefone, inicio, elegivel, motivo, descricao, capturado_em)
    VALUES (@id_agendamento, @data_lote, @id_usuario, @nome_medico,
      @id_paciente, @nome_paciente, @telefone, @inicio, @elegivel, @motivo, @descricao, @capturado_em)
    ON CONFLICT(id_agendamento) DO UPDATE SET
      data_lote=excluded.data_lote, id_usuario=excluded.id_usuario, nome_medico=excluded.nome_medico,
      id_paciente=excluded.id_paciente, nome_paciente=excluded.nome_paciente, telefone=excluded.telefone,
      inicio=excluded.inicio, elegivel=excluded.elegivel, motivo=excluded.motivo,
      descricao=excluded.descricao, capturado_em=excluded.capturado_em
  `);

  const upsertMedicoStmt = db.prepare(`
    INSERT INTO medicos (id_usuario, nome) VALUES (@id_usuario, @nome)
    ON CONFLICT(id_usuario) DO UPDATE SET nome=excluded.nome
  `);

  return {
    upsertMedico(m) {
      upsertMedicoStmt.run(m);
    },
    listarMedicos() {
      return db.prepare(`SELECT id_usuario, nome FROM medicos ORDER BY nome`).all();
    },
    jaEnviado(id) {
      const r = db.prepare(
        `SELECT 1 FROM envios WHERE id_agendamento=? AND status_envio='enviado'`).get(id);
      return !!r;
    },
    registrarEnvio(reg) {
      upsertEnvio.run({ ack_atualizado_em: null, ...reg });
    },
    atualizarAck(id, ack, ackEm) {
      db.prepare(`UPDATE envios SET ack=?, ack_atualizado_em=? WHERE id_agendamento=?`)
        .run(ack, ackEm, id);
    },
    mensagensNaoLidas(dataLote) {
      return db.prepare(`
        SELECT id_agendamento, id_mensagem, telefone FROM envios
        WHERE data_lote=? AND status_envio='enviado' AND ack != 'lido'
          AND id_mensagem IS NOT NULL`).all(dataLote);
    },
    criarLote(l) {
      db.prepare(`
        INSERT INTO lotes (data_lote, fim_campanha, passe1_em, passe2_em)
        VALUES (@data_lote, @fim_campanha, @passe1_em, @passe2_em)
        ON CONFLICT(data_lote) DO UPDATE SET
          fim_campanha=excluded.fim_campanha, passe1_em=excluded.passe1_em,
          passe2_em=excluded.passe2_em`).run(l);
    },
    passesPendentes(agora) {
      const rows = db.prepare(`SELECT * FROM lotes`).all();
      const out = [];
      for (const r of rows) {
        if (!r.passe1_feito && r.passe1_em && r.passe1_em <= agora)
          out.push({ data_lote: r.data_lote, numero: 1 });
        if (!r.passe2_feito && r.passe2_em && r.passe2_em <= agora)
          out.push({ data_lote: r.data_lote, numero: 2 });
      }
      return out;
    },
    marcarPasseFeito(dataLote, numero) {
      const col = numero === 1 ? 'passe1_feito' : 'passe2_feito';
      db.prepare(`UPDATE lotes SET ${col}=1 WHERE data_lote=?`).run(dataLote);
    },
    resumoPorData(dataLote) {
      const r = db.prepare(`
        SELECT
          SUM(ack='enviado') AS enviado, SUM(ack='entregue') AS entregue,
          SUM(ack='lido') AS lido, SUM(ack='falha') AS falha, COUNT(*) AS total
        FROM envios WHERE data_lote=? AND status_envio='enviado'`).get(dataLote);
      return {
        enviado: r.enviado ?? 0, entregue: r.entregue ?? 0,
        lido: r.lido ?? 0, falha: r.falha ?? 0, total: r.total ?? 0,
      };
    },
    porMedico(dataLote) {
      return db.prepare(`
        SELECT nome_medico, COUNT(*) AS total FROM envios
        WHERE data_lote=? AND status_envio='enviado'
        GROUP BY nome_medico ORDER BY total DESC`).all(dataLote);
    },
    detalhado(dataLote) {
      return db.prepare(`
        SELECT nome_paciente, telefone, nome_medico, inicio, ack,
               data_envio, ack_atualizado_em
        FROM envios WHERE data_lote=? ORDER BY inicio`).all(dataLote);
    },
    upsertAgendaItem(item) {
      upsertAgenda.run(item);
    },
    agendaCompleta(dataLote) {
      return db.prepare(`
        SELECT a.id_agendamento, a.nome_medico, a.inicio, a.nome_paciente, a.telefone,
               a.elegivel, a.motivo,
               e.status_envio, e.ack, e.data_envio, e.ack_atualizado_em
        FROM agenda_itens a
        LEFT JOIN envios e ON e.id_agendamento = a.id_agendamento
        WHERE a.data_lote = ?
        ORDER BY a.nome_medico, a.inicio`).all(dataLote);
    },
    agendaItem(id) {
      return db.prepare(`
        SELECT id_agendamento, data_lote, id_usuario, nome_medico, id_paciente,
               nome_paciente, telefone, inicio, elegivel, motivo
        FROM agenda_itens WHERE id_agendamento = ?`).get(id) ?? null;
    },
    resumoAgenda(dataLote) {
      const r = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(a.elegivel=1) AS elegiveis,
          SUM(a.elegivel=0) AS pulados,
          SUM(e.ack='enviado') AS enviado,
          SUM(e.ack='entregue') AS entregue,
          SUM(e.ack='lido') AS lido,
          SUM(e.ack='falha') AS falha
        FROM agenda_itens a
        LEFT JOIN envios e ON e.id_agendamento = a.id_agendamento
        WHERE a.data_lote = ?`).get(dataLote);
      return {
        total: r.total ?? 0, elegiveis: r.elegiveis ?? 0, pulados: r.pulados ?? 0,
        enviado: r.enviado ?? 0, entregue: r.entregue ?? 0,
        lido: r.lido ?? 0, falha: r.falha ?? 0,
      };
    },
    porMedicoAgenda(dataLote) {
      return db.prepare(`
        SELECT nome_medico, COUNT(*) AS total FROM agenda_itens
        WHERE data_lote=? GROUP BY nome_medico ORDER BY total DESC`).all(dataLote);
    },
    fechar() { db.close(); },
  };
}
