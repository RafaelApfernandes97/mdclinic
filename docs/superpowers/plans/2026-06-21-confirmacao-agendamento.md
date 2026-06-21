# Automação de Confirmação de Agendamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir um serviço Node.js que, todo dia às 08:00 (America/Sao_Paulo), envia template de confirmação de WhatsApp (Meta, via API Mais Chat) para os agendamentos do dia seguinte do MedX, atualiza o ACK das mensagens (+5min do fim da campanha e +1h do envio) e oferece um dashboard web (só leitura, com login) para acompanhar os envios.

**Architecture:** Processo Node persistente em container Docker no EasyPanel. Um scheduler interno (`node-cron`) dispara o job de envio; passes de ACK são persistidos e reagendados; um servidor Express serve dashboard + `/health` + `/run-now`. Persistência em SQLite num volume.

**Tech Stack:** Node.js (>=20, ESM), `better-sqlite3`, `node-cron`, `express`, `cookie-session`, `node:test` + `node --test` para testes, `dotenv`. Frontend: HTML servido pelo Node + Chart.js via CDN. Docker.

## Global Constraints

- Runtime: Node.js >= 20, módulos **ESM** (`"type": "module"` no `package.json`).
- Fuso: todo cálculo de data/"amanhã"/formatação usa **America/Sao_Paulo**.
- Toda credencial/URL vem do `.env` — **nunca** hardcode token/URL.
- Idempotência: nunca reenviar para um `id_agendamento` já com `status_envio = 'enviado'`.
- Em passes de ACK, **não** reconsultar mensagens já com `ack = 'lido'`.
- Filtros de bloqueio (case-insensitive): `Descricao` contendo `FECHADA`, `BLOQUEADO` ou `SEQUENCIAL`, ou `Id_Paciente` ausente/0, ou `SMS` vazio → pular.
- Telefone normalizado para WhatsApp BR: `55` + DDD + número (sem símbolos).
- Testes: `node --test`. Cada task termina com testes passando e um commit.
- Persistência: SQLite em `SQLITE_PATH` (default `./data/envios.db`); em testes usar `:memory:`.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `package.json`, `.env.example`, `.gitignore` | Setup do projeto. |
| `src/config.js` | Lê/valida `.env`, exporta objeto `config`. |
| `src/datas.js` | Helpers de data/fuso: `amanhaISO`, `formatarDataBR`, `formatarHoraBR`, `agoraISO`. |
| `src/agendamentos.js` | `extrairNomePaciente`, `normalizarTelefone`, `ehBloqueio`, `ehElegivel`, `montarEnvio`. |
| `src/store.js` | SQLite: schema + envios + lotes + agregações do dashboard. |
| `src/medx.js` | Cliente MedX: `getAuthToken`, `getAgenda`, `getUsuarios`. |
| `src/maischat.js` | Cliente Mais Chat: `sendTemplate`, `getStatusMensagem`, `mapearAck`. |
| `src/job.js` | `executarJobEnvio(deps)` — orquestra envio + cria lote. |
| `src/ackUpdater.js` | `executarPasse(deps, dataLote, numeroPasse)`. |
| `src/scheduler.js` | `iniciarScheduler(deps)` — cron 08:00 + reagenda passes pendentes. |
| `src/dashboard.js` | Rotas Express do dashboard + auth de sessão. |
| `src/server.js` | `criarServidor(deps)` — monta dashboard, `/health`, `/run-now`. |
| `src/index.js` | Entrypoint: instancia deps, inicia store/scheduler/servidor. |
| `views/login.html`, `views/dashboard.html` | Páginas. |
| `Dockerfile`, `README.md` | Build e deploy. |

---

## Task 1: Setup do projeto

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`, `src/.gitkeep`

**Interfaces:**
- Produces: scripts npm `test` (`node --test`) e `start` (`node src/index.js`); deps instaladas.

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "mdclinic-confirmacao",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "cookie-session": "^2.1.0",
    "dotenv": "^16.4.0",
    "express": "^4.19.0",
    "node-cron": "^3.0.3"
  }
}
```

- [ ] **Step 2: Criar `.gitignore`**

```
node_modules/
.env
data/
*.db
```

- [ ] **Step 3: Criar `.env.example`** (com todas as chaves do spec, sem valores reais)

```
MEDX_BASE_URL=https://medx65-v65teste.azurewebsites.net
MEDX_TOKEN_INTEGRACAO=
MAISCHAT_BASE_URL=
MAISCHAT_TOKEN=
MAISCHAT_TEMPLATE_NOME=
MAISCHAT_TEMPLATE_VARIAVEIS=nome,medico,data,hora
MAISCHAT_TEMPLATE_IDIOMA=pt_BR
CRON_HORARIO=0 8 * * *
ACK_PASSE1_MIN=5
ACK_PASSE2_MIN=60
TZ=America/Sao_Paulo
RUN_TOKEN=
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=
SESSION_SECRET=
PORT=3000
SQLITE_PATH=./data/envios.db
```

- [ ] **Step 4: Instalar deps**

Run: `npm install`
Expected: cria `node_modules/` e `package-lock.json` sem erro.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example
git commit -m "chore: setup do projeto Node (ESM, deps, env example)"
```

---

## Task 2: Helpers de data/fuso (`src/datas.js`)

**Files:**
- Create: `src/datas.js`, `test/datas.test.js`

**Interfaces:**
- Produces:
  - `amanhaISO(agora = new Date()) -> 'YYYY-MM-DD'` — data de amanhã no fuso America/Sao_Paulo.
  - `formatarDataBR(iso) -> 'DD/MM/YYYY'` — recebe `'YYYY-MM-DDTHH:mm:ss'`.
  - `formatarHoraBR(iso) -> 'HH:mm'`.
  - `agoraISO() -> string ISO` (timestamp atual).

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/datas.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amanhaISO, formatarDataBR, formatarHoraBR } from '../src/datas.js';

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

test('formatarDataBR e formatarHoraBR', () => {
  assert.equal(formatarDataBR('2026-06-30T18:20:00'), '30/06/2026');
  assert.equal(formatarHoraBR('2026-06-30T18:20:00'), '18:20');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/datas.test.js`
Expected: FAIL (módulo/funções inexistentes).

- [ ] **Step 3: Implementar `src/datas.js`**

```js
const TZ = 'America/Sao_Paulo';

// Retorna 'YYYY-MM-DD' do dia (no fuso BR) correspondente a `data`.
function dataLocalISO(data) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(data); // en-CA => YYYY-MM-DD
}

export function amanhaISO(agora = new Date()) {
  const hojeBR = dataLocalISO(agora);
  // soma 1 dia de forma segura usando UTC a partir da data BR
  const [y, m, d] = hojeBR.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().slice(0, 10);
}

export function formatarDataBR(iso) {
  const [data] = iso.split('T');
  const [y, m, d] = data.split('-');
  return `${d}/${m}/${y}`;
}

export function formatarHoraBR(iso) {
  const hora = iso.split('T')[1] ?? '00:00:00';
  return hora.slice(0, 5);
}

export function agoraISO() {
  return new Date().toISOString();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/datas.test.js`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/datas.js test/datas.test.js
git commit -m "feat: helpers de data/fuso BR"
```

---

## Task 3: Regras de agendamento (`src/agendamentos.js`)

**Files:**
- Create: `src/agendamentos.js`, `test/agendamentos.test.js`

**Interfaces:**
- Consumes: `formatarDataBR`, `formatarHoraBR` de `src/datas.js`.
- Produces:
  - `extrairNomePaciente(descricao) -> string` (parte antes da primeira vírgula, trim).
  - `normalizarTelefone(sms) -> string|null` (`55`+DDD+numero; `null` se inválido).
  - `ehBloqueio(descricao) -> boolean` (contém FECHADA/BLOQUEADO/SEQUENCIAL, case-insensitive).
  - `ehElegivel(item) -> boolean` (tem SMS normalizável, `Id_Paciente` truthy ≠ 0, não bloqueio).
  - `montarEnvio(item, mapaMedicos) -> { id_agendamento, id_paciente, nome_paciente, telefone, id_usuario, nome_medico, inicio, data_br, hora_br }` onde `mapaMedicos` é `Map<id_usuario, nome>`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/agendamentos.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extrairNomePaciente, normalizarTelefone, ehBloqueio, ehElegivel, montarEnvio,
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

test('ehElegivel exige SMS, paciente e não-bloqueio', () => {
  assert.equal(ehElegivel({ SMS: '34999998888', Id_Paciente: 10, Descricao: 'Joao' }), true);
  assert.equal(ehElegivel({ SMS: '', Id_Paciente: 10, Descricao: 'Joao' }), false);
  assert.equal(ehElegivel({ SMS: '34999998888', Id_Paciente: 0, Descricao: 'Joao' }), false);
  assert.equal(ehElegivel({ SMS: '34999998888', Id_Paciente: 10, Descricao: 'FECHADA' }), false);
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/agendamentos.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/agendamentos.js`**

```js
import { formatarDataBR, formatarHoraBR } from './datas.js';

export function extrairNomePaciente(descricao = '') {
  return String(descricao).split(',')[0].trim();
}

export function normalizarTelefone(sms) {
  const digitos = String(sms ?? '').replace(/\D/g, '');
  if (!digitos) return null;
  let num = digitos;
  if (!num.startsWith('55')) num = '55' + num;
  // 55 + DDD(2) + numero(8 ou 9) => 12 ou 13 dígitos
  if (num.length < 12 || num.length > 13) return null;
  return num;
}

const PALAVRAS_BLOQUEIO = ['FECHADA', 'BLOQUEADO', 'SEQUENCIAL'];

export function ehBloqueio(descricao = '') {
  const up = String(descricao).toUpperCase();
  return PALAVRAS_BLOQUEIO.some((p) => up.includes(p));
}

export function ehElegivel(item) {
  if (ehBloqueio(item.Descricao)) return false;
  if (!item.Id_Paciente) return false;
  if (!normalizarTelefone(item.SMS)) return false;
  return true;
}

export function montarEnvio(item, mapaMedicos) {
  return {
    id_agendamento: item.Id_Agendamento,
    id_paciente: item.Id_Paciente,
    nome_paciente: extrairNomePaciente(item.Descricao),
    telefone: normalizarTelefone(item.SMS),
    id_usuario: item.Id_Usuario,
    nome_medico: mapaMedicos.get(item.Id_Usuario) ?? 'Desconhecido',
    inicio: item.Inicio,
    data_br: formatarDataBR(item.Inicio),
    hora_br: formatarHoraBR(item.Inicio),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/agendamentos.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agendamentos.js test/agendamentos.test.js
git commit -m "feat: regras de elegibilidade, telefone e extração de paciente"
```

---

## Task 4: Camada de dados SQLite (`src/store.js`)

**Files:**
- Create: `src/store.js`, `test/store.test.js`

**Interfaces:**
- Produces (factory `criarStore(caminho)` retornando objeto com):
  - `jaEnviado(idAgendamento) -> boolean` (true só se `status_envio = 'enviado'`).
  - `registrarEnvio(reg)` onde `reg = { id_agendamento, id_paciente, nome_paciente, telefone, id_usuario, nome_medico, inicio, id_mensagem, status_envio, ack, data_envio, data_lote, erro }`. UPSERT por `id_agendamento`.
  - `atualizarAck(idAgendamento, ack, ackAtualizadoEm)`.
  - `mensagensNaoLidas(dataLote) -> [{ id_agendamento, id_mensagem }]` (status_envio='enviado', ack != 'lido', id_mensagem not null).
  - `criarLote({ data_lote, fim_campanha, passe1_em, passe2_em })` (UPSERT).
  - `passesPendentes(agoraIso) -> [{ data_lote, numero }]` (passes com `*_em <= agora` e `*_feito = 0`).
  - `marcarPasseFeito(dataLote, numero)`.
  - `resumoPorData(dataLote) -> { enviado, entregue, lido, falha, total }`.
  - `porMedico(dataLote) -> [{ nome_medico, total }]`.
  - `detalhado(dataLote) -> [linhas de envios]`.
  - `fechar()`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarStore } from '../src/store.js';

function novaStore() { return criarStore(':memory:'); }

const base = {
  id_agendamento: 1, id_paciente: 9, nome_paciente: 'Joao', telefone: '5534999998888',
  id_usuario: 7, nome_medico: 'Dra. Marina', inicio: '2026-06-30T18:20:00',
  id_mensagem: 'msg-1', status_envio: 'enviado', ack: 'enviado',
  data_envio: '2026-06-29T08:00:00Z', data_lote: '2026-06-29', erro: null,
};

test('registrarEnvio + jaEnviado', () => {
  const s = novaStore();
  assert.equal(s.jaEnviado(1), false);
  s.registrarEnvio(base);
  assert.equal(s.jaEnviado(1), true);
  s.fechar();
});

test('erro não conta como enviado', () => {
  const s = novaStore();
  s.registrarEnvio({ ...base, status_envio: 'erro', ack: 'falha', erro: 'x' });
  assert.equal(s.jaEnviado(1), false);
  s.fechar();
});

test('atualizarAck e mensagensNaoLidas', () => {
  const s = novaStore();
  s.registrarEnvio(base);
  s.registrarEnvio({ ...base, id_agendamento: 2, id_mensagem: 'msg-2' });
  let pend = s.mensagensNaoLidas('2026-06-29');
  assert.equal(pend.length, 2);
  s.atualizarAck(1, 'lido', '2026-06-29T08:10:00Z');
  pend = s.mensagensNaoLidas('2026-06-29');
  assert.deepEqual(pend.map((p) => p.id_agendamento), [2]);
  s.fechar();
});

test('lotes: criar, listar pendentes e marcar feito', () => {
  const s = novaStore();
  s.criarLote({
    data_lote: '2026-06-29', fim_campanha: '2026-06-29T08:05:00Z',
    passe1_em: '2026-06-29T08:10:00Z', passe2_em: '2026-06-29T09:00:00Z',
  });
  let p = s.passesPendentes('2026-06-29T08:30:00Z');
  assert.deepEqual(p, [{ data_lote: '2026-06-29', numero: 1 }]);
  s.marcarPasseFeito('2026-06-29', 1);
  p = s.passesPendentes('2026-06-29T09:30:00Z');
  assert.deepEqual(p, [{ data_lote: '2026-06-29', numero: 2 }]);
  s.fechar();
});

test('agregações do dashboard', () => {
  const s = novaStore();
  s.registrarEnvio({ ...base, id_agendamento: 1, ack: 'lido' });
  s.registrarEnvio({ ...base, id_agendamento: 2, ack: 'entregue', nome_medico: 'Dr. Ana' });
  const r = s.resumoPorData('2026-06-29');
  assert.equal(r.total, 2);
  assert.equal(r.lido, 1);
  assert.equal(r.entregue, 1);
  const pm = s.porMedico('2026-06-29');
  assert.equal(pm.length, 2);
  assert.equal(s.detalhado('2026-06-29').length, 2);
  s.fechar();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/store.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/store.js`**

```js
import Database from 'better-sqlite3';
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
`;

export function criarStore(caminho) {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new Database(caminho);
  db.pragma('journal_mode = WAL');
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

  return {
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
        SELECT id_agendamento, id_mensagem FROM envios
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
    fechar() { db.close(); },
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/store.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store.js test/store.test.js
git commit -m "feat: camada SQLite (envios, lotes, agregações)"
```

---

## Task 5: Config (`src/config.js`)

**Files:**
- Create: `src/config.js`, `test/config.test.js`

**Interfaces:**
- Produces: `carregarConfig(env = process.env) -> config` com todas as chaves; lança erro se faltar obrigatória. Default export `config` (lazy via função para testes).
- Obrigatórias: `MEDX_BASE_URL`, `MEDX_TOKEN_INTEGRACAO`, `MAISCHAT_BASE_URL`, `MAISCHAT_TOKEN`, `MAISCHAT_TEMPLATE_NOME`, `DASHBOARD_PASSWORD`, `SESSION_SECRET`, `RUN_TOKEN`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/config.test.js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/config.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/config.js`**

```js
const OBRIGATORIAS = [
  'MEDX_BASE_URL', 'MEDX_TOKEN_INTEGRACAO', 'MAISCHAT_BASE_URL', 'MAISCHAT_TOKEN',
  'MAISCHAT_TEMPLATE_NOME', 'DASHBOARD_PASSWORD', 'SESSION_SECRET', 'RUN_TOKEN',
];

export function carregarConfig(env = process.env) {
  for (const chave of OBRIGATORIAS) {
    if (!env[chave]) throw new Error(`Variável de ambiente obrigatória ausente: ${chave}`);
  }
  return {
    medxBaseUrl: env.MEDX_BASE_URL,
    medxToken: env.MEDX_TOKEN_INTEGRACAO,
    maischatBaseUrl: env.MAISCHAT_BASE_URL,
    maischatToken: env.MAISCHAT_TOKEN,
    templateNome: env.MAISCHAT_TEMPLATE_NOME,
    templateVariaveis: (env.MAISCHAT_TEMPLATE_VARIAVEIS ?? 'nome,medico,data,hora')
      .split(',').map((v) => v.trim()).filter(Boolean),
    templateIdioma: env.MAISCHAT_TEMPLATE_IDIOMA ?? 'pt_BR',
    cronHorario: env.CRON_HORARIO ?? '0 8 * * *',
    ackPasse1Min: Number(env.ACK_PASSE1_MIN ?? 5),
    ackPasse2Min: Number(env.ACK_PASSE2_MIN ?? 60),
    runToken: env.RUN_TOKEN,
    dashboardUser: env.DASHBOARD_USER ?? 'admin',
    dashboardPassword: env.DASHBOARD_PASSWORD,
    sessionSecret: env.SESSION_SECRET,
    port: Number(env.PORT ?? 3000),
    sqlitePath: env.SQLITE_PATH ?? './data/envios.db',
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/config.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat: carregamento e validação de config (.env)"
```

---

## Task 6: Cliente MedX (`src/medx.js`)

**Files:**
- Create: `src/medx.js`, `test/medx.test.js`

**Interfaces:**
- Produces: `criarMedx({ baseUrl, token, fetch })` retornando:
  - `getAuthToken() -> Promise<string>` (GET GetAuthorizedToken; guarda em cache interno).
  - `getAgenda(inicio, fim) -> Promise<array>` (GET GetAgenda com Bearer; re-auth 1x em 401).
  - `getUsuarios() -> Promise<array>` (GET GetUsuariosAgenda com Bearer).
- `fetch` é injetável (default `globalThis.fetch`) para teste.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/medx.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarMedx } from '../src/medx.js';

function fakeFetch(rotas) {
  return async (url, opts) => {
    const handler = rotas.find((r) => url.includes(r.match));
    if (!handler) throw new Error('rota não mockada: ' + url);
    return handler.resp(url, opts);
  };
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

test('getAuthToken chama GetAuthorizedToken e cacheia', async () => {
  let chamadas = 0;
  const fetch = fakeFetch([
    { match: 'GetAuthorizedToken', resp: async () => { chamadas++; return ok('TOKEN123'); } },
  ]);
  const medx = criarMedx({ baseUrl: 'http://medx', token: 'int', fetch });
  assert.equal(await medx.getAuthToken(), 'TOKEN123');
  await medx.getAuthToken();
  assert.equal(chamadas, 1);
});

test('getAgenda envia Bearer e retorna lista', async () => {
  let authHeader;
  const fetch = fakeFetch([
    { match: 'GetAuthorizedToken', resp: async () => ok('TKN') },
    { match: 'GetAgenda', resp: async (url, opts) => {
        authHeader = opts.headers.Authorization; return ok([{ Id_Agendamento: 1 }]); } },
  ]);
  const medx = criarMedx({ baseUrl: 'http://medx', token: 'int', fetch });
  const ag = await medx.getAgenda('2026-06-22', '2026-06-22');
  assert.equal(authHeader, 'Bearer TKN');
  assert.equal(ag[0].Id_Agendamento, 1);
});

test('re-autentica uma vez em 401', async () => {
  let agendaCalls = 0, authCalls = 0;
  const fetch = fakeFetch([
    { match: 'GetAuthorizedToken', resp: async () => { authCalls++; return ok('T' + authCalls); } },
    { match: 'GetAgenda', resp: async () => {
        agendaCalls++;
        if (agendaCalls === 1) return { ok: false, status: 401, text: async () => 'no' };
        return ok([{ Id_Agendamento: 9 }]);
      } },
  ]);
  const medx = criarMedx({ baseUrl: 'http://medx', token: 'int', fetch });
  const ag = await medx.getAgenda('2026-06-22', '2026-06-22');
  assert.equal(ag[0].Id_Agendamento, 9);
  assert.equal(authCalls, 2);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/medx.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/medx.js`**

```js
export function criarMedx({ baseUrl, token, fetch = globalThis.fetch }) {
  let authToken = null;

  async function autenticar() {
    const url = `${baseUrl}/api/integration/GetAuthorizedToken?token=${encodeURIComponent(token)}`;
    const r = await fetch(url, { method: 'GET' });
    if (!r.ok) throw new Error(`Falha ao autenticar no MedX: ${r.status}`);
    const txt = (await r.text()).trim();
    authToken = txt.replace(/^"|"$/g, ''); // remove aspas se vier como JSON string
    return authToken;
  }

  async function getAuthToken() {
    if (!authToken) await autenticar();
    return authToken;
  }

  async function comAuth(fazerReq) {
    await getAuthToken();
    let r = await fazerReq(authToken);
    if (r.status === 401) { await autenticar(); r = await fazerReq(authToken); }
    if (!r.ok) throw new Error(`Erro MedX: ${r.status} ${await r.text()}`);
    return r.json();
  }

  function getAgenda(inicio, fim) {
    const url = `${baseUrl}/api/integration/GetAgenda?inicio=${inicio}&fim=${fim}`;
    return comAuth((tk) => fetch(url, { headers: { Authorization: `Bearer ${tk}` } }));
  }

  function getUsuarios() {
    const url = `${baseUrl}/api/integration/GetUsuariosAgenda`;
    return comAuth((tk) => fetch(url, { headers: { Authorization: `Bearer ${tk}` } }));
  }

  return { getAuthToken, getAgenda, getUsuarios };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/medx.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/medx.js test/medx.test.js
git commit -m "feat: cliente MedX com auth, re-auth e endpoints de agenda"
```

---

## Task 7: Cliente Mais Chat (`src/maischat.js`)

**Files:**
- Create: `src/maischat.js`, `test/maischat.test.js`

**Interfaces:**
- Produces: `criarMaisChat({ baseUrl, token, templateNome, templateIdioma, fetch })`:
  - `sendTemplate({ telefone, variaveis }) -> Promise<{ idMensagem }>` (POST; `variaveis` é array de strings na ordem do template).
  - `getStatusMensagem(idMensagem) -> Promise<{ ack }>` onde `ack ∈ {enviado,entregue,lido,falha}`.
  - `mapearAck(codigo) -> string` exportado também como função pura para teste.

> **NOTA ao implementador:** o formato exato do request/response do Mais Chat será confirmado pelo usuário depois. Implemente o contrato abaixo (campos `to`, `template`, `language`, `params` no envio; `messageId` na resposta; `ack`/`status` numérico na consulta) e **mantenha tudo isolado neste arquivo**. Os testes fixam o contrato assumido.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/maischat.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarMaisChat, mapearAck } from '../src/maischat.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });

test('mapearAck traduz códigos numéricos', () => {
  assert.equal(mapearAck(0), 'enviado');
  assert.equal(mapearAck(1), 'enviado');
  assert.equal(mapearAck(2), 'entregue');
  assert.equal(mapearAck(3), 'lido');
  assert.equal(mapearAck(-1), 'falha');
});

test('sendTemplate posta payload e retorna idMensagem', async () => {
  let corpo;
  const fetch = async (url, opts) => { corpo = JSON.parse(opts.body); return ok({ messageId: 'm-1' }); };
  const mc = criarMaisChat({
    baseUrl: 'http://mc', token: 'k', templateNome: 'tpl', templateIdioma: 'pt_BR', fetch });
  const r = await mc.sendTemplate({ telefone: '5534999998888', variaveis: ['Joao', 'Dra', '30/06', '18:20'] });
  assert.equal(r.idMensagem, 'm-1');
  assert.equal(corpo.to, '5534999998888');
  assert.equal(corpo.template, 'tpl');
  assert.deepEqual(corpo.params, ['Joao', 'Dra', '30/06', '18:20']);
});

test('getStatusMensagem retorna ack mapeado', async () => {
  const fetch = async () => ok({ ack: 3 });
  const mc = criarMaisChat({ baseUrl: 'http://mc', token: 'k', templateNome: 't', templateIdioma: 'pt_BR', fetch });
  const r = await mc.getStatusMensagem('m-1');
  assert.equal(r.ack, 'lido');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/maischat.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/maischat.js`**

```js
export function mapearAck(codigo) {
  const n = Number(codigo);
  if (n < 0) return 'falha';
  if (n >= 3) return 'lido';
  if (n === 2) return 'entregue';
  return 'enviado'; // 0 ou 1
}

export function criarMaisChat({ baseUrl, token, templateNome, templateIdioma, fetch = globalThis.fetch }) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  async function sendTemplate({ telefone, variaveis }) {
    const url = `${baseUrl}/api/messages/template`;
    const body = JSON.stringify({
      to: telefone, template: templateNome, language: templateIdioma, params: variaveis,
    });
    const r = await fetch(url, { method: 'POST', headers, body });
    if (!r.ok) throw new Error(`Falha sendTemplate: ${r.status} ${await r.text()}`);
    const data = await r.json();
    return { idMensagem: data.messageId ?? data.id ?? null };
  }

  async function getStatusMensagem(idMensagem) {
    const url = `${baseUrl}/api/messages/${encodeURIComponent(idMensagem)}`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`Falha getStatusMensagem: ${r.status}`);
    const data = await r.json();
    const codigo = data.ack ?? data.status;
    return { ack: mapearAck(codigo) };
  }

  return { sendTemplate, getStatusMensagem, mapearAck };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/maischat.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/maischat.js test/maischat.test.js
git commit -m "feat: cliente Mais Chat (sendTemplate, status/ACK)"
```

---

## Task 8: Job de envio (`src/job.js`)

**Files:**
- Create: `src/job.js`, `test/job.test.js`

**Interfaces:**
- Consumes: `medx`, `maischat`, `store`, `config`, e helpers de `agendamentos.js`/`datas.js`.
- Produces: `executarJobEnvio({ medx, maischat, store, config, agora = new Date() }) -> Promise<{ enviados, pulados, erros, dataLote }>`.
- Comportamento: calcula amanhã; busca agenda+usuários; para cada item elegível e não-enviado, monta variáveis na ordem `config.templateVariaveis` (mapa nome→valor: `nome,medico,data,hora`), envia, registra; ao final cria o lote com `passe1_em = fim_campanha + ackPasse1Min` e `passe2_em = primeiro_envio + ackPasse2Min`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/job.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executarJobEnvio } from '../src/job.js';
import { criarStore } from '../src/store.js';

function deps(overrides = {}) {
  const agenda = [
    { Id_Agendamento: 1, Id_Paciente: 9, Id_Usuario: 7, SMS: '34999998888',
      Descricao: 'JOAO, obs', Inicio: '2026-06-22T10:00:00' },
    { Id_Agendamento: 2, Id_Paciente: 0, Id_Usuario: 7, SMS: '', // inelegível
      Descricao: 'FECHADA', Inicio: '2026-06-22T11:00:00' },
  ];
  const enviados = [];
  const medx = {
    getAgenda: async () => agenda,
    getUsuarios: async () => [{ Id_Usuario: 7, Nome: 'Dra. Marina' }],
  };
  const maischat = {
    sendTemplate: async (p) => { enviados.push(p); return { idMensagem: 'm-' + enviados.length }; },
  };
  const store = criarStore(':memory:');
  const config = {
    templateVariaveis: ['nome', 'medico', 'data', 'hora'],
    ackPasse1Min: 5, ackPasse2Min: 60,
    medicoCampoNome: 'Nome',
  };
  return { medx, maischat, store, config, enviados, ...overrides };
}

test('envia só elegíveis e registra', async () => {
  const d = deps();
  const r = await executarJobEnvio({ ...d, agora: new Date('2026-06-21T11:00:00Z') });
  assert.equal(r.enviados, 1);
  assert.equal(d.enviados.length, 1);
  assert.deepEqual(d.enviados[0].variaveis, ['JOAO', 'Dra. Marina', '22/06/2026', '10:00']);
  assert.equal(d.store.jaEnviado(1), true);
});

test('não reenvia já enviado', async () => {
  const d = deps();
  const agora = new Date('2026-06-21T11:00:00Z');
  await executarJobEnvio({ ...d, agora });
  const r2 = await executarJobEnvio({ ...d, agora });
  assert.equal(r2.enviados, 0);
});

test('erro em um envio não derruba o lote', async () => {
  const d = deps({
    maischat: { sendTemplate: async () => { throw new Error('falhou'); } },
  });
  const r = await executarJobEnvio({ ...d, agora: new Date('2026-06-21T11:00:00Z') });
  assert.equal(r.erros, 1);
  assert.equal(r.enviados, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/job.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/job.js`**

```js
import { amanhaISO, agoraISO } from './datas.js';
import { ehElegivel, montarEnvio } from './agendamentos.js';

function mapaMedicos(usuarios, campoNome = 'Nome') {
  const m = new Map();
  for (const u of usuarios) m.set(u.Id_Usuario, u[campoNome] ?? u.Nome ?? 'Desconhecido');
  return m;
}

function montarVariaveis(envio, ordem) {
  const valores = {
    nome: envio.nome_paciente, medico: envio.nome_medico,
    data: envio.data_br, hora: envio.hora_br,
  };
  return ordem.map((chave) => valores[chave] ?? '');
}

export async function executarJobEnvio({ medx, maischat, store, config, agora = new Date() }) {
  const dataLote = amanhaISO(agora);
  console.log(`[job] iniciando envio para o lote ${dataLote}`);
  const [agenda, usuarios] = await Promise.all([
    medx.getAgenda(dataLote, dataLote), medx.getUsuarios(),
  ]);
  const mapa = mapaMedicos(usuarios, config.medicoCampoNome);

  let enviados = 0, pulados = 0, erros = 0;
  let primeiroEnvioIso = null, ultimoEnvioIso = null;

  for (const item of agenda) {
    if (!ehElegivel(item)) { pulados++; continue; }
    if (store.jaEnviado(item.Id_Agendamento)) { pulados++; continue; }
    const envio = montarEnvio(item, mapa);
    const variaveis = montarVariaveis(envio, config.templateVariaveis);
    const ts = agoraISO();
    try {
      const { idMensagem } = await maischat.sendTemplate({ telefone: envio.telefone, variaveis });
      store.registrarEnvio({
        ...envio, id_mensagem: idMensagem, status_envio: 'enviado', ack: 'enviado',
        data_envio: ts, data_lote: dataLote, erro: null,
      });
      enviados++;
      primeiroEnvioIso ??= ts;
      ultimoEnvioIso = ts;
    } catch (e) {
      store.registrarEnvio({
        ...envio, id_mensagem: null, status_envio: 'erro', ack: 'falha',
        data_envio: ts, data_lote: dataLote, erro: String(e.message ?? e),
      });
      erros++;
      console.error(`[job] erro ao enviar agendamento ${item.Id_Agendamento}:`, e.message);
    }
  }

  if (enviados > 0) {
    const p1 = new Date(new Date(ultimoEnvioIso).getTime() + config.ackPasse1Min * 60000).toISOString();
    const p2 = new Date(new Date(primeiroEnvioIso).getTime() + config.ackPasse2Min * 60000).toISOString();
    store.criarLote({ data_lote: dataLote, fim_campanha: ultimoEnvioIso, passe1_em: p1, passe2_em: p2 });
  }

  console.log(`[job] concluído: ${enviados} enviados, ${pulados} pulados, ${erros} erros`);
  return { enviados, pulados, erros, dataLote };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/job.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/job.js test/job.test.js
git commit -m "feat: job de envio diário com criação de lote"
```

---

## Task 9: Atualizador de ACK (`src/ackUpdater.js`)

**Files:**
- Create: `src/ackUpdater.js`, `test/ackUpdater.test.js`

**Interfaces:**
- Produces: `executarPasse({ maischat, store, dataLote, numero }) -> Promise<{ atualizados, erros }>`.
- Comportamento: pega `store.mensagensNaoLidas(dataLote)`; para cada uma, consulta `maischat.getStatusMensagem`, chama `store.atualizarAck`; ao final `store.marcarPasseFeito(dataLote, numero)`. Erro numa mensagem não interrompe as demais.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/ackUpdater.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executarPasse } from '../src/ackUpdater.js';
import { criarStore } from '../src/store.js';

const base = {
  id_paciente: 1, nome_paciente: 'x', telefone: '55', id_usuario: 1, nome_medico: 'Dr',
  inicio: '2026-06-22T10:00:00', status_envio: 'enviado', ack: 'enviado',
  data_envio: '2026-06-21T08:00:00Z', data_lote: '2026-06-22', erro: null,
};

test('atualiza só não-lidas e marca passe feito', async () => {
  const store = criarStore(':memory:');
  store.registrarEnvio({ ...base, id_agendamento: 1, id_mensagem: 'a' });
  store.registrarEnvio({ ...base, id_agendamento: 2, id_mensagem: 'b', ack: 'lido' });
  store.criarLote({ data_lote: '2026-06-22', fim_campanha: 'x',
    passe1_em: '2026-06-21T08:05:00Z', passe2_em: '2026-06-21T09:00:00Z' });

  const consultadas = [];
  const maischat = { getStatusMensagem: async (id) => { consultadas.push(id); return { ack: 'entregue' }; } };
  const r = await executarPasse({ maischat, store, dataLote: '2026-06-22', numero: 1 });

  assert.deepEqual(consultadas, ['a']); // 'b' já estava lido
  assert.equal(r.atualizados, 1);
  assert.deepEqual(store.passesPendentes('2026-06-21T10:00:00Z').map((p) => p.numero), [2]);
  store.fechar();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/ackUpdater.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/ackUpdater.js`**

```js
import { agoraISO } from './datas.js';

export async function executarPasse({ maischat, store, dataLote, numero }) {
  const pendentes = store.mensagensNaoLidas(dataLote);
  console.log(`[ack] passe ${numero} lote ${dataLote}: ${pendentes.length} mensagens`);
  let atualizados = 0, erros = 0;
  for (const { id_agendamento, id_mensagem } of pendentes) {
    try {
      const { ack } = await maischat.getStatusMensagem(id_mensagem);
      store.atualizarAck(id_agendamento, ack, agoraISO());
      atualizados++;
    } catch (e) {
      erros++;
      console.error(`[ack] erro na msg ${id_mensagem}:`, e.message);
    }
  }
  store.marcarPasseFeito(dataLote, numero);
  console.log(`[ack] passe ${numero} concluído: ${atualizados} atualizados, ${erros} erros`);
  return { atualizados, erros };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/ackUpdater.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ackUpdater.js test/ackUpdater.test.js
git commit -m "feat: passe de atualização de ACK"
```

---

## Task 10: Scheduler (`src/scheduler.js`)

**Files:**
- Create: `src/scheduler.js`, `test/scheduler.test.js`

**Interfaces:**
- Produces:
  - `verificarPassesPendentes({ store, maischat, agoraIso }) -> Promise<number>` (executa todos os passes vencidos; retorna quantos rodou). Usa `executarPasse`.
  - `iniciarScheduler({ cron, config, executarEnvio, verificarPasses })` — registra cron 08:00 (job) e um cron de minuto-a-minuto que chama `verificarPasses`. `cron` (node-cron) é injetável.
- Consumes: `executarPasse` de `ackUpdater.js`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/scheduler.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verificarPassesPendentes, iniciarScheduler } from '../src/scheduler.js';
import { criarStore } from '../src/store.js';

const base = {
  id_paciente: 1, nome_paciente: 'x', telefone: '55', id_usuario: 1, nome_medico: 'Dr',
  inicio: '2026-06-22T10:00:00', status_envio: 'enviado', ack: 'enviado',
  data_envio: '2026-06-21T08:00:00Z', data_lote: '2026-06-22', erro: null,
};

test('verificarPassesPendentes roda passes vencidos', async () => {
  const store = criarStore(':memory:');
  store.registrarEnvio({ ...base, id_agendamento: 1, id_mensagem: 'a' });
  store.criarLote({ data_lote: '2026-06-22', fim_campanha: 'x',
    passe1_em: '2026-06-21T08:05:00Z', passe2_em: '2026-06-21T09:00:00Z' });
  const maischat = { getStatusMensagem: async () => ({ ack: 'lido' }) };
  const n = await verificarPassesPendentes({ store, maischat, agoraIso: '2026-06-21T08:06:00Z' });
  assert.equal(n, 1); // só passe1 venceu
  store.fechar();
});

test('iniciarScheduler registra dois crons', () => {
  const agendados = [];
  const cron = { schedule: (expr, fn, opts) => { agendados.push({ expr, opts }); return { start() {} }; } };
  iniciarScheduler({
    cron, config: { cronHorario: '0 8 * * *' },
    executarEnvio: async () => {}, verificarPasses: async () => {},
  });
  assert.equal(agendados.length, 2);
  assert.equal(agendados[0].expr, '0 8 * * *');
  assert.equal(agendados[0].opts.timezone, 'America/Sao_Paulo');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/scheduler.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/scheduler.js`**

```js
import { executarPasse } from './ackUpdater.js';
import { agoraISO } from './datas.js';

export async function verificarPassesPendentes({ store, maischat, agoraIso = agoraISO() }) {
  const pendentes = store.passesPendentes(agoraIso);
  for (const { data_lote, numero } of pendentes) {
    await executarPasse({ maischat, store, dataLote: data_lote, numero });
  }
  return pendentes.length;
}

export function iniciarScheduler({ cron, config, executarEnvio, verificarPasses }) {
  const tz = 'America/Sao_Paulo';
  cron.schedule(config.cronHorario, () => {
    executarEnvio().catch((e) => console.error('[scheduler] erro no job de envio:', e));
  }, { timezone: tz });
  cron.schedule('* * * * *', () => {
    verificarPasses().catch((e) => console.error('[scheduler] erro nos passes de ACK:', e));
  }, { timezone: tz });
  console.log(`[scheduler] cron de envio em "${config.cronHorario}" (${tz}) e verificação de ACK por minuto`);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/scheduler.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.js test/scheduler.test.js
git commit -m "feat: scheduler (cron de envio + verificação de passes de ACK)"
```

---

## Task 11: Dashboard + servidor (`src/dashboard.js`, `src/server.js`, `views/`)

**Files:**
- Create: `src/dashboard.js`, `src/server.js`, `views/login.html`, `views/dashboard.html`, `test/server.test.js`

**Interfaces:**
- Produces:
  - `montarDashboard({ store, config }) -> Router` (Express Router) com:
    - `GET /login` (form), `POST /login` (valida user/senha → seta sessão), `GET /logout`.
    - `GET /` (protegida) → serve `dashboard.html`.
    - `GET /api/dados?data=YYYY-MM-DD` (protegida) → `{ resumo, porMedico, detalhado, data }`.
  - `criarServidor({ store, config }) -> app` (Express) montando dashboard + `GET /health` + `POST /run-now` (header `x-run-token` == `config.runToken`).
- `criarServidor` aceita `executarEnvio` opcional para o `/run-now` (injetável p/ teste).

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/server.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarServidor } from '../src/server.js';
import { criarStore } from '../src/store.js';

function appDeTeste(overrides = {}) {
  const store = criarStore(':memory:');
  store.registrarEnvio({
    id_agendamento: 1, id_paciente: 1, nome_paciente: 'Joao', telefone: '55', id_usuario: 1,
    nome_medico: 'Dra. Marina', inicio: '2026-06-22T10:00:00', id_mensagem: 'a',
    status_envio: 'enviado', ack: 'lido', data_envio: '2026-06-21T08:00:00Z',
    data_lote: '2026-06-22', erro: null,
  });
  const config = {
    dashboardUser: 'admin', dashboardPassword: 'pw', sessionSecret: 's',
    runToken: 'rt', port: 0,
  };
  return criarServidor({ store, config, executarEnvio: async () => ({ enviados: 0 }), ...overrides });
}

async function req(app, method, path, { headers = {}, body } = {}) {
  const { default: http } = await import('node:http');
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers, body, redirect: 'manual',
  });
  const texto = await res.text();
  server.close();
  return { status: res.status, texto, headers: res.headers };
}

test('GET / sem sessão redireciona para /login', async () => {
  const r = await req(appDeTeste(), 'GET', '/');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /\/login/);
});

test('GET /health responde ok', async () => {
  const r = await req(appDeTeste(), 'GET', '/health');
  assert.equal(r.status, 200);
});

test('/run-now exige token', async () => {
  const r = await req(appDeTeste(), 'POST', '/run-now');
  assert.equal(r.status, 401);
  const r2 = await req(appDeTeste(), 'POST', '/run-now', { headers: { 'x-run-token': 'rt' } });
  assert.equal(r2.status, 200);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/server.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/dashboard.js`**

```js
import express from 'express';
import cookieSession from 'cookie-session';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWS = join(__dirname, '..', 'views');

function exigirSessao(req, res, next) {
  if (req.session?.logado) return next();
  return res.redirect('/login');
}

export function montarDashboard({ store, config }) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));
  router.use(cookieSession({
    name: 'sess', secret: config.sessionSecret, maxAge: 8 * 3600 * 1000, httpOnly: true,
  }));

  router.get('/login', (req, res) => res.sendFile(join(VIEWS, 'login.html')));
  router.post('/login', (req, res) => {
    const { usuario, senha } = req.body;
    if (usuario === config.dashboardUser && senha === config.dashboardPassword) {
      req.session.logado = true;
      return res.redirect('/');
    }
    return res.redirect('/login?erro=1');
  });
  router.get('/logout', (req, res) => { req.session = null; res.redirect('/login'); });

  router.get('/', exigirSessao, (req, res) => res.sendFile(join(VIEWS, 'dashboard.html')));
  router.get('/api/dados', exigirSessao, (req, res) => {
    const data = req.query.data || new Date().toISOString().slice(0, 10);
    res.json({
      data,
      resumo: store.resumoPorData(data),
      porMedico: store.porMedico(data),
      detalhado: store.detalhado(data),
    });
  });
  return router;
}
```

- [ ] **Step 4: Implementar `src/server.js`**

```js
import express from 'express';
import { montarDashboard } from './dashboard.js';

export function criarServidor({ store, config, executarEnvio }) {
  const app = express();

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.post('/run-now', express.json(), async (req, res) => {
    if (req.get('x-run-token') !== config.runToken) return res.status(401).json({ erro: 'token inválido' });
    try {
      const r = executarEnvio ? await executarEnvio() : { ok: true };
      res.json({ ok: true, resultado: r });
    } catch (e) {
      res.status(500).json({ erro: String(e.message ?? e) });
    }
  });

  app.use('/', montarDashboard({ store, config }));
  return app;
}
```

- [ ] **Step 5: Implementar `views/login.html`**

```html
<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Login — Confirmação de Agendamento</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:system-ui,Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0}
  form{background:#1e293b;padding:2rem;border-radius:12px;width:300px;box-shadow:0 10px 30px #0006}
  h1{font-size:1.1rem;margin:0 0 1rem} label{display:block;margin:.6rem 0 .2rem;font-size:.85rem}
  input{width:100%;padding:.55rem;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;box-sizing:border-box}
  button{margin-top:1rem;width:100%;padding:.6rem;border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}
  .erro{color:#f87171;font-size:.8rem;margin-top:.5rem}
</style></head><body>
<form method="POST" action="/login">
  <h1>Confirmação de Agendamento</h1>
  <label>Usuário</label><input name="usuario" autofocus>
  <label>Senha</label><input name="senha" type="password">
  <button type="submit">Entrar</button>
  <div class="erro" id="erro"></div>
</form>
<script>if(location.search.includes('erro'))document.getElementById('erro').textContent='Usuário ou senha inválidos';</script>
</body></html>
```

- [ ] **Step 6: Implementar `views/dashboard.html`**

```html
<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Dashboard — Confirmação de Agendamento</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  body{font-family:system-ui,Arial,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:1.5rem}
  header{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap}
  h1{font-size:1.2rem;margin:0}
  a.logout{color:#94a3b8;font-size:.85rem}
  .cards{display:flex;gap:1rem;flex-wrap:wrap;margin:1rem 0}
  .card{background:#1e293b;border-radius:12px;padding:1rem 1.3rem;min-width:120px}
  .card .n{font-size:1.6rem;font-weight:700} .card .l{font-size:.8rem;color:#94a3b8}
  .grid{display:grid;grid-template-columns:1fr 2fr;gap:1rem}
  .box{background:#1e293b;border-radius:12px;padding:1rem}
  table{width:100%;border-collapse:collapse;font-size:.85rem}
  th,td{text-align:left;padding:.4rem .5rem;border-bottom:1px solid #334155}
  input[type=date]{padding:.4rem;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e2e8f0}
  @media(max-width:800px){.grid{grid-template-columns:1fr}}
</style></head><body>
<header>
  <h1>Confirmação de Agendamento</h1>
  <div><input type="date" id="data"> <a class="logout" href="/logout">sair</a></div>
</header>
<div class="cards" id="cards"></div>
<div class="grid">
  <div class="box"><canvas id="grafico"></canvas></div>
  <div class="box"><table id="tabela"><thead><tr>
    <th>Paciente</th><th>Telefone</th><th>Médico</th><th>Consulta</th><th>ACK</th><th>Enviado</th>
  </tr></thead><tbody></tbody></table></div>
</div>
<script>
let chart;
const fmt = (iso)=> iso? new Date(iso).toLocaleString('pt-BR'):'';
async function carregar(){
  const data=document.getElementById('data').value;
  const r=await fetch('/api/dados?data='+data); const d=await r.json();
  const c=d.resumo;
  document.getElementById('cards').innerHTML=[
    ['Total',c.total],['Enviado',c.enviado],['Entregue',c.entregue],['Lido',c.lido],['Falha',c.falha]
  ].map(([l,n])=>`<div class="card"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
  const tb=document.querySelector('#tabela tbody');
  tb.innerHTML=d.detalhado.map(e=>`<tr><td>${e.nome_paciente}</td><td>${e.telefone}</td>
    <td>${e.nome_medico}</td><td>${fmt(e.inicio)}</td><td>${e.ack}</td><td>${fmt(e.data_envio)}</td></tr>`).join('');
  const labels=d.porMedico.map(m=>m.nome_medico), valores=d.porMedico.map(m=>m.total);
  if(chart)chart.destroy();
  chart=new Chart(document.getElementById('grafico'),{type:'bar',
    data:{labels,datasets:[{label:'Envios por médico',data:valores,backgroundColor:'#2563eb'}]},
    options:{plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#94a3b8'}},y:{ticks:{color:'#94a3b8'}}}}});
}
const hoje=new Date().toISOString().slice(0,10);
document.getElementById('data').value=hoje;
document.getElementById('data').addEventListener('change',carregar);
carregar();
</script>
</body></html>
```

- [ ] **Step 7: Rodar e ver passar**

Run: `node --test test/server.test.js`
Expected: PASS (3 testes).

- [ ] **Step 8: Commit**

```bash
git add src/dashboard.js src/server.js views/ test/server.test.js
git commit -m "feat: dashboard web com login e servidor (health, run-now)"
```

---

## Task 12: Entrypoint, Dockerfile e README

**Files:**
- Create: `src/index.js`, `Dockerfile`, `.dockerignore`, `README.md`

**Interfaces:**
- Consumes: tudo. Monta `config`, `store`, clientes, scheduler e servidor.

- [ ] **Step 1: Implementar `src/index.js`**

```js
import 'dotenv/config';
import cron from 'node-cron';
import { carregarConfig } from './config.js';
import { criarStore } from './store.js';
import { criarMedx } from './medx.js';
import { criarMaisChat } from './maischat.js';
import { executarJobEnvio } from './job.js';
import { iniciarScheduler, verificarPassesPendentes } from './scheduler.js';
import { criarServidor } from './server.js';

const config = carregarConfig();
const store = criarStore(config.sqlitePath);
const medx = criarMedx({ baseUrl: config.medxBaseUrl, token: config.medxToken });
const maischat = criarMaisChat({
  baseUrl: config.maischatBaseUrl, token: config.maischatToken,
  templateNome: config.templateNome, templateIdioma: config.templateIdioma,
});

const executarEnvio = () => executarJobEnvio({ medx, maischat, store, config });
const verificarPasses = () => verificarPassesPendentes({ store, maischat });

iniciarScheduler({ cron, config, executarEnvio, verificarPasses });

const app = criarServidor({ store, config, executarEnvio });
app.listen(config.port, () => {
  console.log(`[server] ouvindo na porta ${config.port}`);
  verificarPasses().catch((e) => console.error('[init] erro ao verificar passes pendentes:', e));
});
```

- [ ] **Step 2: Implementar `Dockerfile`**

```dockerfile
FROM node:20-slim
WORKDIR /app
# better-sqlite3 precisa de toolchain para compilar
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
ENV SQLITE_PATH=/data/envios.db
EXPOSE 3000
CMD ["node", "src/index.js"]
```

- [ ] **Step 3: Implementar `.dockerignore`**

```
node_modules
.git
.env
data
docs
test
```

- [ ] **Step 4: Implementar `README.md`** (resumo de uso e deploy)

```markdown
# Confirmação de Agendamento (MedX → Mais Chat)

Serviço que envia, todo dia às 08:00 (America/Sao_Paulo), lembrete/confirmação de
WhatsApp (template Meta via Mais Chat) para os agendamentos do dia seguinte do MedX,
atualiza o ACK das mensagens e oferece um dashboard de acompanhamento.

## Configuração
Copie `.env.example` para `.env` e preencha. Variáveis obrigatórias:
`MEDX_TOKEN_INTEGRACAO`, `MAISCHAT_BASE_URL`, `MAISCHAT_TOKEN`, `MAISCHAT_TEMPLATE_NOME`,
`DASHBOARD_PASSWORD`, `SESSION_SECRET`, `RUN_TOKEN`.

## Rodar local
```
npm install
npm test
npm start
```
Dashboard em `http://localhost:3000` (login com `DASHBOARD_USER`/`DASHBOARD_PASSWORD`).

## Disparo manual (teste)
```
curl -X POST http://localhost:3000/run-now -H "x-run-token: SEU_RUN_TOKEN"
```

## Deploy no EasyPanel
1. Crie um app a partir deste repositório (build por Dockerfile).
2. Configure as variáveis de ambiente (mesmas do `.env`).
3. Monte um **volume persistente** em `/data` (onde fica o SQLite).
4. Exponha a porta `3000` e aponte o domínio; use `/health` como healthcheck.

## Notas
- Ajuste o formato real da API do Mais Chat em `src/maischat.js` quando disponível.
- ACK: passe +5min do fim da campanha e +1h do envio; mensagens já `lido` não são reconsultadas.
```

- [ ] **Step 5: Rodar a suíte completa**

Run: `npm test`
Expected: PASS em todos os arquivos de teste.

- [ ] **Step 6: Commit**

```bash
git add src/index.js Dockerfile .dockerignore README.md
git commit -m "feat: entrypoint, Dockerfile e README de deploy"
```

---

## Self-Review (preenchido)

**Spec coverage:**
- Job 08:00 + amanhã → Tasks 2, 8, 10. ✓
- Filtros/elegibilidade/telefone/nome → Task 3. ✓
- Envio template Mais Chat + idMensagem → Task 7, 8. ✓
- ACK +5min/+1h, pular `lido`, persistência/reagendamento → Tasks 4, 9, 10, 12. ✓
- Dashboard só leitura com login, por médico, contadores, tabela → Task 11. ✓
- SQLite em volume → Tasks 4, 12 (Dockerfile/volume). ✓
- `.env` / config → Task 5. ✓
- `/health` + `/run-now` → Task 11. ✓
- Tratamento de erros (re-auth, continua lote) → Tasks 6, 8, 9. ✓

**Placeholder scan:** sem TODOs; a única incerteza externa (formato real da API Mais Chat) está encapsulada em `src/maischat.js` com contrato explícito e nota — não é placeholder de plano.

**Type consistency:** nomes conferidos entre tasks: `criarStore`, `registrarEnvio`, `mensagensNaoLidas`, `criarLote`, `passesPendentes`, `marcarPasseFeito`, `executarJobEnvio`, `executarPasse`, `verificarPassesPendentes`, `criarServidor`, `montarDashboard`, `sendTemplate`, `getStatusMensagem`, `mapearAck`. ✓

> **Atenção de execução:** O contrato HTTP do Mais Chat (URLs `/api/messages/template` e `/api/messages/:id`, campos `to/template/language/params`, `messageId`, `ack`) é **suposição** a confirmar quando o usuário fornecer a doc/credenciais reais. Tudo fica isolado em `src/maischat.js` e coberto por testes que fixam esse contrato — ajustar lá não afeta o resto.
