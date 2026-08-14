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
CREATE TABLE IF NOT EXISTS agenda_netvacinas_itens (
  chave           TEXT PRIMARY KEY,
  id_externo      TEXT,
  tipo            TEXT,
  data_lote       TEXT,
  inicio          TEXT,
  fim             TEXT,
  tem_horario     INTEGER,
  id_paciente     TEXT,
  nome_paciente   TEXT,
  telefone        TEXT,
  vacina          TEXT,
  elegivel        INTEGER,
  motivo          TEXT,
  capturado_em    TEXT
);
CREATE INDEX IF NOT EXISTS idx_agenda_netvacinas_lote ON agenda_netvacinas_itens(data_lote);
CREATE TABLE IF NOT EXISTS envios_netvacinas (
  chave              TEXT PRIMARY KEY,
  id_externo         TEXT,
  id_paciente        TEXT,
  nome_paciente      TEXT,
  telefone           TEXT,
  vacina             TEXT,
  inicio             TEXT,
  id_mensagem        TEXT,
  status_envio       TEXT,
  ack                TEXT,
  ack_atualizado_em  TEXT,
  data_envio         TEXT,
  data_lote          TEXT,
  erro               TEXT
);
CREATE INDEX IF NOT EXISTS idx_envios_netvacinas_lote ON envios_netvacinas(data_lote);
CREATE TABLE IF NOT EXISTS medicos (
  id_usuario   INTEGER PRIMARY KEY,
  nome         TEXT
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

  const upsertAgendaNetVacinas = db.prepare(`
    INSERT INTO agenda_netvacinas_itens (chave, id_externo, tipo, data_lote, inicio, fim,
      tem_horario, id_paciente, nome_paciente, telefone, vacina, elegivel, motivo, capturado_em)
    VALUES (@chave, @id_externo, @tipo, @data_lote, @inicio, @fim,
      @tem_horario, @id_paciente, @nome_paciente, @telefone, @vacina, @elegivel, @motivo, @capturado_em)
    ON CONFLICT(chave) DO UPDATE SET
      id_externo=excluded.id_externo, tipo=excluded.tipo, data_lote=excluded.data_lote,
      inicio=excluded.inicio, fim=excluded.fim, tem_horario=excluded.tem_horario,
      id_paciente=excluded.id_paciente, nome_paciente=excluded.nome_paciente,
      telefone=excluded.telefone, vacina=excluded.vacina, elegivel=excluded.elegivel,
      motivo=excluded.motivo, capturado_em=excluded.capturado_em
  `);

  const upsertEnvioNetVacinas = db.prepare(`
    INSERT INTO envios_netvacinas (chave, id_externo, id_paciente, nome_paciente, telefone,
      vacina, inicio, id_mensagem, status_envio, ack, ack_atualizado_em,
      data_envio, data_lote, erro)
    VALUES (@chave, @id_externo, @id_paciente, @nome_paciente, @telefone,
      @vacina, @inicio, @id_mensagem, @status_envio, @ack, @ack_atualizado_em,
      @data_envio, @data_lote, @erro)
    ON CONFLICT(chave) DO UPDATE SET
      id_mensagem=excluded.id_mensagem, status_envio=excluded.status_envio,
      ack=excluded.ack, data_envio=excluded.data_envio, erro=excluded.erro
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
    mensagensNaoLidas(dataInicio, dataFim = dataInicio) {
      return db.prepare(`
        SELECT id_agendamento, id_mensagem, telefone FROM envios
        WHERE data_lote>=? AND data_lote<=? AND status_envio='enviado' AND ack != 'lido'
          AND id_mensagem IS NOT NULL`).all(dataInicio, dataFim);
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
    agendaCompleta(dataInicio, dataFim = dataInicio) {
      return db.prepare(`
        SELECT a.id_agendamento, a.nome_medico, a.inicio, a.nome_paciente, a.telefone,
               a.elegivel, a.motivo,
               e.status_envio, e.ack, e.data_envio, e.ack_atualizado_em
        FROM agenda_itens a
        LEFT JOIN envios e ON e.id_agendamento = a.id_agendamento
        WHERE a.data_lote >= ? AND a.data_lote <= ?
        ORDER BY a.nome_medico, a.inicio`).all(dataInicio, dataFim);
    },
    agendaItem(id) {
      return db.prepare(`
        SELECT id_agendamento, data_lote, id_usuario, nome_medico, id_paciente,
               nome_paciente, telefone, inicio, elegivel, motivo
        FROM agenda_itens WHERE id_agendamento = ?`).get(id) ?? null;
    },
    resumoAgenda(dataInicio, dataFim = dataInicio) {
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
        WHERE a.data_lote >= ? AND a.data_lote <= ?`).get(dataInicio, dataFim);
      return {
        total: r.total ?? 0, elegiveis: r.elegiveis ?? 0, pulados: r.pulados ?? 0,
        enviado: r.enviado ?? 0, entregue: r.entregue ?? 0,
        lido: r.lido ?? 0, falha: r.falha ?? 0,
      };
    },
    // Agendamentos "Pendente" de uma agenda no período: elegíveis e SEM envio
    // registrado (nem sucesso nem falha). É o universo do envio em massa.
    agendaPendentes(dataInicio, dataFim, nomeMedico) {
      return db.prepare(`
        SELECT a.id_agendamento, a.data_lote, a.id_usuario, a.nome_medico, a.id_paciente,
               a.nome_paciente, a.telefone, a.inicio
        FROM agenda_itens a
        LEFT JOIN envios e ON e.id_agendamento = a.id_agendamento
        WHERE a.data_lote >= ? AND a.data_lote <= ? AND a.nome_medico = ?
          AND a.elegivel = 1 AND e.id_agendamento IS NULL
        ORDER BY a.inicio`).all(dataInicio, dataFim, nomeMedico);
    },
    // Recorte do período de uma agenda para o relatório do envio em massa:
    // quantos serão enviados (pendentes) e por que os demais são pulados.
    resumoEnvioMassa(dataInicio, dataFim, nomeMedico) {
      const r = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(a.elegivel=0) AS inelegiveis,
          SUM(a.elegivel=1 AND e.status_envio='enviado') AS ja_enviados,
          SUM(a.elegivel=1 AND e.status_envio='erro') AS falhas_anteriores,
          SUM(a.elegivel=1 AND e.id_agendamento IS NULL) AS pendentes
        FROM agenda_itens a
        LEFT JOIN envios e ON e.id_agendamento = a.id_agendamento
        WHERE a.data_lote >= ? AND a.data_lote <= ? AND a.nome_medico = ?`)
        .get(dataInicio, dataFim, nomeMedico);
      return {
        total: r.total ?? 0, inelegiveis: r.inelegiveis ?? 0,
        ja_enviados: r.ja_enviados ?? 0, falhas_anteriores: r.falhas_anteriores ?? 0,
        pendentes: r.pendentes ?? 0,
      };
    },
    porMedicoAgenda(dataInicio, dataFim = dataInicio) {
      return db.prepare(`
        SELECT nome_medico, COUNT(*) AS total FROM agenda_itens
        WHERE data_lote>=? AND data_lote<=? GROUP BY nome_medico ORDER BY total DESC`).all(dataInicio, dataFim);
    },
    upsertAgendaNetVacinasItem(item) {
      upsertAgendaNetVacinas.run(item);
    },
    agendaNetVacinasCompleta(dataInicio, dataFim = dataInicio) {
      return db.prepare(`
        SELECT a.chave, a.id_externo, a.tipo, a.data_lote, a.inicio, a.fim, a.tem_horario,
               a.nome_paciente, a.telefone, a.vacina, a.elegivel, a.motivo,
               e.status_envio, e.ack, e.data_envio, e.ack_atualizado_em
        FROM agenda_netvacinas_itens a
        LEFT JOIN envios_netvacinas e ON e.chave = a.chave
        WHERE a.data_lote >= ? AND a.data_lote <= ?
        ORDER BY a.data_lote, a.inicio, a.nome_paciente`).all(dataInicio, dataFim);
    },
    agendaNetVacinasItem(chave) {
      return db.prepare(`
        SELECT chave, id_externo, tipo, data_lote, inicio, fim, tem_horario, id_paciente,
               nome_paciente, telefone, vacina, elegivel, motivo
        FROM agenda_netvacinas_itens WHERE chave=?`).get(chave) ?? null;
    },
    jaEnviadoNetVacinas(chave) {
      const r = db.prepare(
        `SELECT 1 FROM envios_netvacinas WHERE chave=? AND status_envio='enviado'`).get(chave);
      return !!r;
    },
    registrarEnvioNetVacinas(reg) {
      upsertEnvioNetVacinas.run({ ack_atualizado_em: null, ...reg });
    },
    mensagensNetVacinasNaoLidas(dataInicio, dataFim = dataInicio) {
      return db.prepare(`
        SELECT chave, id_mensagem, telefone FROM envios_netvacinas
        WHERE data_lote>=? AND data_lote<=? AND status_envio='enviado' AND ack != 'lido'
          AND id_mensagem IS NOT NULL`).all(dataInicio, dataFim);
    },
    atualizarAckNetVacinas(chave, ack, ackEm) {
      db.prepare(`UPDATE envios_netvacinas SET ack=?, ack_atualizado_em=? WHERE chave=?`)
        .run(ack, ackEm, chave);
    },
    resumoAgendaNetVacinas(dataInicio, dataFim = dataInicio) {
      const r = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(a.elegivel=1) AS elegiveis,
          SUM(a.elegivel=0) AS pulados,
          SUM(e.ack='enviado') AS enviado,
          SUM(e.ack='entregue') AS entregue,
          SUM(e.ack='lido') AS lido,
          SUM(e.ack='falha') AS falha
        FROM agenda_netvacinas_itens a
        LEFT JOIN envios_netvacinas e ON e.chave = a.chave
        WHERE a.data_lote >= ? AND a.data_lote <= ?`).get(dataInicio, dataFim);
      return {
        total: r.total ?? 0, elegiveis: r.elegiveis ?? 0, pulados: r.pulados ?? 0,
        enviado: r.enviado ?? 0, entregue: r.entregue ?? 0,
        lido: r.lido ?? 0, falha: r.falha ?? 0,
      };
    },
    fechar() { db.close(); },
  };
}
