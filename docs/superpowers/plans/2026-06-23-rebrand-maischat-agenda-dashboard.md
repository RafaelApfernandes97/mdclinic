# Rebrand Mais Chat + Agenda completa no dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrandar o dashboard/login do projeto `mdclinic` com a identidade Mais Chat (tema claro) e exibir a agenda completa de cada médico (incluindo não-elegíveis) com status de envio por linha, com atualização sob demanda.

**Architecture:** Snapshot híbrido — uma nova tabela `agenda_itens` no SQLite guarda toda a agenda do dia; o job de envio grava esse snapshot antes de enviar (sem alterar o envio), e um endpoint protegido re-puxa o MedX ao vivo sob demanda. O dashboard lê só do banco (`agenda_itens LEFT JOIN envios`) e renderiza seções por médico com chips de status. As views migram para tema claro com os tokens da marca.

**Tech Stack:** Node.js ESM (>=24), `node:sqlite` nativo, Express 4, cookie-session, Chart.js (CDN), `node:test`.

## Global Constraints

- ESM puro (`"type": "module"`), Node **>=24**. (verbatim de `package.json`)
- Persistência via **`node:sqlite`** nativo (`DatabaseSync`) — **não** usar `better-sqlite3`.
- Testes com `node:test` + `node:assert/strict`; rodar com `npm test` (`node --test`).
- **Não** alterar a lógica de envio/ACK (`maischat.js`, envio em `job.js`, `ackUpdater.js`, `scheduler.js`) nem o contrato Mais Chat/MedX.
- Marca (de `marca/Cores e Variáveis de Estilo…md`): base **cinza** (70–80%), **laranja `#FF710A` só acento ≤10%** (logo, data/seção ativa, chip "enviado"), azul ações secundárias, ação primária `gray-800 #354557`. Fonte **Inter**. Tema **claro** (fundo `gray-50 #F5F7FA`).
- HTML vindo da API sempre escapado no cliente (`esc(...)`).
- Sem novas dependências npm (Chart.js continua via CDN).

---

## File Structure

- `src/store.js` (modify) — adiciona tabela `agenda_itens` e métodos `upsertAgendaItem`, `agendaCompleta`, `resumoAgenda`, `porMedicoAgenda`. Métodos antigos permanecem.
- `src/agendaSnapshot.js` (create) — `mapaMedicos`, `classificarItem`, `gravarSnapshot`, `snapshotAgenda`.
- `src/job.js` (modify) — importa `mapaMedicos`/`gravarSnapshot`; grava snapshot antes de enviar.
- `src/dashboard.js` (modify) — `/api/dados` com nova forma + `POST /api/atualizar-agenda`; recebe `medx`.
- `src/server.js` (modify) — passa `medx` ao dashboard e serve `public/` estático.
- `src/index.js` (modify) — passa `medx` ao `criarServidor`.
- `public/` (create) — `favicon.svg`, `favicon-96x96.png`, `icon-192.png`, `icon-512.png` (assets da marca).
- `views/dashboard.html` (rewrite) — rebrand tema claro + seção por médico + botão atualizar.
- `views/login.html` (rewrite) — rebrand tema claro.
- `test/agendaSnapshot.test.js` (create), `test/store.test.js` (modify), `test/job.test.js` (modify), `test/dashboard.test.js` (create).

---

### Task 1: Tabela e consultas de `agenda_itens` no store

**Files:**
- Modify: `src/store.js`
- Test: `test/store.test.js`

**Interfaces:**
- Consumes: `criarStore(caminho)` existente.
- Produces:
  - `store.upsertAgendaItem({ id_agendamento, data_lote, id_usuario, nome_medico, id_paciente, nome_paciente, telefone, inicio, elegivel, motivo, descricao, capturado_em })` — `elegivel` é `1`/`0`; `motivo` é `null` ou string.
  - `store.agendaCompleta(dataLote)` → array de `{ nome_medico, inicio, nome_paciente, telefone, elegivel, motivo, status_envio, ack, data_envio, ack_atualizado_em }` ordenado por `nome_medico, inicio`.
  - `store.resumoAgenda(dataLote)` → `{ total, elegiveis, pulados, enviado, entregue, lido, falha }`.
  - `store.porMedicoAgenda(dataLote)` → array de `{ nome_medico, total }` ordenado por `total` desc.

- [ ] **Step 1: Write the failing test**

Adicionar ao fim de `test/store.test.js`:

```js
test('agenda_itens: upsert, agendaCompleta e resumoAgenda', () => {
  const s = novaStore();
  const baseAg = {
    data_lote: '2026-06-24', id_usuario: 7, nome_medico: 'Dra. Marina',
    id_paciente: 9, nome_paciente: 'Joao', telefone: '5534999998888',
    inicio: '2026-06-24T10:00:00', elegivel: 1, motivo: null,
    descricao: 'JOAO', capturado_em: '2026-06-23T08:00:00Z',
  };
  // elegível e enviado (lido)
  s.upsertAgendaItem({ ...baseAg, id_agendamento: 1 });
  s.registrarEnvio({
    id_agendamento: 1, id_paciente: 9, nome_paciente: 'Joao', telefone: '5534999998888',
    id_usuario: 7, nome_medico: 'Dra. Marina', inicio: '2026-06-24T10:00:00',
    id_mensagem: 'm1', status_envio: 'enviado', ack: 'lido',
    data_envio: '2026-06-23T08:00:00Z', data_lote: '2026-06-24', erro: null,
  });
  // não elegível (bloqueio), sem envio
  s.upsertAgendaItem({
    ...baseAg, id_agendamento: 2, id_paciente: null, nome_paciente: 'FECHADA',
    telefone: null, inicio: '2026-06-24T11:00:00', elegivel: 0, motivo: 'bloqueio',
    descricao: 'FECHADA',
  });

  const ag = s.agendaCompleta('2026-06-24');
  assert.equal(ag.length, 2);
  assert.equal(ag[0].nome_paciente, 'Joao');
  assert.equal(ag[0].ack, 'lido');
  assert.equal(ag[1].elegivel, 0);
  assert.equal(ag[1].motivo, 'bloqueio');
  assert.equal(ag[1].ack, null); // sem envio

  const r = s.resumoAgenda('2026-06-24');
  assert.equal(r.total, 2);
  assert.equal(r.elegiveis, 1);
  assert.equal(r.pulados, 1);
  assert.equal(r.lido, 1);

  const pm = s.porMedicoAgenda('2026-06-24');
  assert.equal(pm.length, 1);
  assert.equal(pm[0].total, 2);
  s.fechar();
});

test('agenda_itens: upsert é idempotente (atualiza, não duplica)', () => {
  const s = novaStore();
  const item = {
    id_agendamento: 1, data_lote: '2026-06-24', id_usuario: 7, nome_medico: 'Dra. Marina',
    id_paciente: 9, nome_paciente: 'Joao', telefone: '5534999998888',
    inicio: '2026-06-24T10:00:00', elegivel: 1, motivo: null, descricao: 'JOAO',
    capturado_em: '2026-06-23T08:00:00Z',
  };
  s.upsertAgendaItem(item);
  s.upsertAgendaItem({ ...item, nome_paciente: 'Joao Silva' });
  const ag = s.agendaCompleta('2026-06-24');
  assert.equal(ag.length, 1);
  assert.equal(ag[0].nome_paciente, 'Joao Silva');
  s.fechar();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `s.upsertAgendaItem is not a function`.

- [ ] **Step 3: Implement in `src/store.js`**

Acrescentar a tabela ao `SCHEMA` (antes da crase final do template):

```js
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
```

Depois do `upsertEnvio = db.prepare(...)` existente, adicionar:

```js
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
```

Adicionar ao objeto retornado (junto dos demais métodos):

```js
    upsertAgendaItem(item) {
      upsertAgenda.run(item);
    },
    agendaCompleta(dataLote) {
      return db.prepare(`
        SELECT a.nome_medico, a.inicio, a.nome_paciente, a.telefone, a.elegivel, a.motivo,
               e.status_envio, e.ack, e.data_envio, e.ack_atualizado_em
        FROM agenda_itens a
        LEFT JOIN envios e ON e.id_agendamento = a.id_agendamento
        WHERE a.data_lote = ?
        ORDER BY a.nome_medico, a.inicio`).all(dataLote);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (todos os testes, incluindo os 35 anteriores).

- [ ] **Step 5: Commit**

```bash
git add src/store.js test/store.test.js
git commit -m "feat(store): tabela agenda_itens e consultas da agenda completa"
```

---

### Task 2: Módulo `agendaSnapshot.js`

**Files:**
- Create: `src/agendaSnapshot.js`
- Test: `test/agendaSnapshot.test.js`

**Interfaces:**
- Consumes: `ehBloqueio`, `normalizarTelefone`, `extrairNomePaciente` de `src/agendamentos.js`; `store.upsertAgendaItem` (Task 1); `medx.getAgenda`, `medx.getUsuarios`.
- Produces:
  - `mapaMedicos(usuarios, campoNome='Nome')` → `Map<Id_Usuario, nome>`.
  - `classificarItem(item)` → `{ elegivel: 1|0, motivo: null|'bloqueio'|'sem_paciente'|'sem_telefone' }`.
  - `gravarSnapshot({ store, agenda, mapa, dataLote, agora=new Date() })` → `{ dataLote, total, elegiveis }` (não chama MedX, não envia).
  - `snapshotAgenda({ medx, store, config, dataLote, agora=new Date() })` → idem, buscando MedX ao vivo.

- [ ] **Step 1: Write the failing test**

Criar `test/agendaSnapshot.test.js`:

```js
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
  assert.equal(store.agendaCompleta('2026-06-24')[0].nome_medico, 'Dra. Marina');
  store.fechar();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/agendaSnapshot.js'`.

- [ ] **Step 3: Create `src/agendaSnapshot.js`**

```js
import { ehBloqueio, normalizarTelefone, extrairNomePaciente } from './agendamentos.js';

export function mapaMedicos(usuarios, campoNome = 'Nome') {
  const m = new Map();
  for (const u of usuarios) m.set(u.Id_Usuario, u[campoNome] ?? u.Nome ?? 'Desconhecido');
  return m;
}

export function classificarItem(item) {
  if (ehBloqueio(item.Descricao)) return { elegivel: 0, motivo: 'bloqueio' };
  if (!item.Id_Paciente) return { elegivel: 0, motivo: 'sem_paciente' };
  if (!normalizarTelefone(item.SMS)) return { elegivel: 0, motivo: 'sem_telefone' };
  return { elegivel: 1, motivo: null };
}

export function gravarSnapshot({ store, agenda, mapa, dataLote, agora = new Date() }) {
  const capturadoEm = agora.toISOString();
  let total = 0, elegiveis = 0;
  for (const item of agenda) {
    const { elegivel, motivo } = classificarItem(item);
    store.upsertAgendaItem({
      id_agendamento: item.Id_Agendamento,
      data_lote: dataLote,
      id_usuario: item.Id_Usuario,
      nome_medico: mapa.get(item.Id_Usuario) ?? 'Desconhecido',
      id_paciente: item.Id_Paciente ?? null,
      nome_paciente: extrairNomePaciente(item.Descricao),
      telefone: normalizarTelefone(item.SMS),
      inicio: item.Inicio,
      elegivel,
      motivo,
      descricao: item.Descricao ?? '',
      capturado_em: capturadoEm,
    });
    total++;
    if (elegivel) elegiveis++;
  }
  return { dataLote, total, elegiveis };
}

export async function snapshotAgenda({ medx, store, config, dataLote, agora = new Date() }) {
  const [agenda, usuarios] = await Promise.all([
    medx.getAgenda(dataLote, dataLote), medx.getUsuarios(),
  ]);
  const mapa = mapaMedicos(usuarios, config.medicoCampoNome);
  return gravarSnapshot({ store, agenda, mapa, dataLote, agora });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agendaSnapshot.js test/agendaSnapshot.test.js
git commit -m "feat: modulo agendaSnapshot (classifica e grava snapshot da agenda)"
```

---

### Task 3: Job grava o snapshot antes de enviar

**Files:**
- Modify: `src/job.js`
- Test: `test/job.test.js`

**Interfaces:**
- Consumes: `mapaMedicos`, `gravarSnapshot` de `src/agendaSnapshot.js` (Task 2); `store.agendaCompleta` (Task 1).
- Produces: nenhuma assinatura nova; `executarJobEnvio` mantém retorno `{ enviados, pulados, erros, dataLote }` e passa a popular `agenda_itens`.

- [ ] **Step 1: Write the failing test**

Adicionar ao fim de `test/job.test.js`:

```js
test('grava snapshot completo da agenda (elegíveis + pulados)', async () => {
  const d = deps();
  await executarJobEnvio({ ...d, agora: new Date('2026-06-21T11:00:00Z') });
  // deps() usa GetAgenda com data_lote = amanhã de 2026-06-21 = 2026-06-22
  const ag = d.store.agendaCompleta('2026-06-22');
  assert.equal(ag.length, 2); // 1 elegível + 1 bloqueio
  const bloqueio = ag.find((x) => x.motivo === 'bloqueio');
  assert.ok(bloqueio);
  assert.equal(bloqueio.elegivel, 0);
  const enviado = ag.find((x) => x.elegivel === 1);
  assert.equal(enviado.ack, 'enviado'); // veio do join com envios
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `agendaCompleta('2026-06-22')` retorna `[]` (job ainda não grava snapshot).

- [ ] **Step 3: Modify `src/job.js`**

Trocar a função local `mapaMedicos` por import. No topo, ajustar imports:

```js
import { amanhaISO, agoraISO } from './datas.js';
import { ehElegivel, montarEnvio } from './agendamentos.js';
import { mapaMedicos, gravarSnapshot } from './agendaSnapshot.js';
```

Remover a função local `function mapaMedicos(...) { ... }` (agora importada).

Logo após `const mapa = mapaMedicos(usuarios, config.medicoCampoNome);`, inserir:

```js
  try {
    gravarSnapshot({ store, agenda, mapa, dataLote, agora });
  } catch (e) {
    console.error('[job] falha ao gravar snapshot da agenda:', e.message);
  }
```

(O laço de envio que vem depois permanece inalterado.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (incluindo os testes de envio já existentes do `job.test.js`).

- [ ] **Step 5: Commit**

```bash
git add src/job.js test/job.test.js
git commit -m "feat(job): grava snapshot da agenda antes de enviar (envio inalterado)"
```

---

### Task 4: API do dashboard (nova forma + atualizar agenda) e wiring do servidor

**Files:**
- Modify: `src/dashboard.js`, `src/server.js`, `src/index.js`
- Test: `test/dashboard.test.js`

**Interfaces:**
- Consumes: `store.resumoAgenda`, `store.porMedicoAgenda`, `store.agendaCompleta` (Task 1); `snapshotAgenda` (Task 2); `medx` (de `index.js`).
- Produces:
  - `GET /api/dados?data=YYYY-MM-DD` → `{ data, resumo, porMedico, agenda }` (sessão obrigatória).
  - `POST /api/atualizar-agenda?data=YYYY-MM-DD` → mesmo payload após snapshot ao vivo; `502` em erro do MedX (sessão obrigatória).
  - `montarDashboard({ store, config, medx })` e `criarServidor({ store, config, executarEnvio, medx })` passam a aceitar `medx`.
  - `express.static('public')` servido na raiz.

- [ ] **Step 1: Write the failing test**

Criar `test/dashboard.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarServidor } from '../src/server.js';
import { criarStore } from '../src/store.js';

const config = {
  dashboardUser: 'admin', dashboardPassword: 'pw', sessionSecret: 's',
  runToken: 'rt', port: 0, medicoCampoNome: 'Nome',
};

function storeComAgenda() {
  const s = criarStore(':memory:');
  s.upsertAgendaItem({
    id_agendamento: 1, data_lote: '2026-06-24', id_usuario: 7, nome_medico: 'Dra. Marina',
    id_paciente: 9, nome_paciente: 'Joao', telefone: '5534999998888',
    inicio: '2026-06-24T10:00:00', elegivel: 1, motivo: null, descricao: 'JOAO',
    capturado_em: '2026-06-23T08:00:00Z',
  });
  s.upsertAgendaItem({
    id_agendamento: 2, data_lote: '2026-06-24', id_usuario: 7, nome_medico: 'Dra. Marina',
    id_paciente: null, nome_paciente: 'FECHADA', telefone: null,
    inicio: '2026-06-24T11:00:00', elegivel: 0, motivo: 'bloqueio', descricao: 'FECHADA',
    capturado_em: '2026-06-23T08:00:00Z',
  });
  return s;
}

async function comServidor(app, fn) {
  const server = app.listen(0);
  const port = server.address().port;
  try { return await fn(port); } finally { server.close(); }
}

async function login(port) {
  const res = await fetch(`http://127.0.0.1:${port}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'usuario=admin&senha=pw',
  });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

test('/api/dados sem sessão redireciona', async () => {
  const app = criarServidor({ store: storeComAgenda(), config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/dados?data=2026-06-24`, { redirect: 'manual' });
    assert.equal(res.status, 302);
  });
});

test('/api/dados autenticado retorna resumo + agenda', async () => {
  const app = criarServidor({ store: storeComAgenda(), config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/dados?data=2026-06-24`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.resumo.total, 2);
    assert.equal(d.resumo.elegiveis, 1);
    assert.equal(d.resumo.pulados, 1);
    assert.equal(d.agenda.length, 2);
    assert.equal(d.porMedico[0].total, 2);
  });
});

test('/api/atualizar-agenda chama snapshot ao vivo e retorna dados', async () => {
  const medx = {
    getAgenda: async () => [{ Id_Agendamento: 5, Id_Paciente: 1, Id_Usuario: 7, SMS: '34999990000', Descricao: 'MARIA', Inicio: '2026-06-24T09:00:00' }],
    getUsuarios: async () => [{ Id_Usuario: 7, Nome: 'Dra. Marina' }],
  };
  const app = criarServidor({ store: criarStore(':memory:'), config, executarEnvio: async () => ({}), medx });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/atualizar-agenda?data=2026-06-24`, { method: 'POST', headers: { cookie } });
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.agenda.length, 1);
    assert.equal(d.resumo.elegiveis, 1);
  });
});

test('/api/atualizar-agenda responde 502 quando MedX falha', async () => {
  const medx = { getAgenda: async () => { throw new Error('down'); }, getUsuarios: async () => [] };
  const app = criarServidor({ store: criarStore(':memory:'), config, executarEnvio: async () => ({}), medx });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/atualizar-agenda?data=2026-06-24`, { method: 'POST', headers: { cookie } });
    assert.equal(res.status, 502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `/api/dados` autenticado retorna a forma antiga (sem `agenda`/`resumo.elegiveis`) e `/api/atualizar-agenda` retorna 404.

- [ ] **Step 3a: Modify `src/dashboard.js`**

Adicionar o import no topo:

```js
import { snapshotAgenda } from './agendaSnapshot.js';
```

Trocar a assinatura `export function montarDashboard({ store, config }) {` por:

```js
export function montarDashboard({ store, config, medx }) {
```

Substituir o handler `router.get('/api/dados', ...)` existente por:

```js
  router.get('/api/dados', exigirSessao, (req, res) => {
    const data = req.query.data || new Date().toISOString().slice(0, 10);
    res.json({
      data,
      resumo: store.resumoAgenda(data),
      porMedico: store.porMedicoAgenda(data),
      agenda: store.agendaCompleta(data),
    });
  });

  router.post('/api/atualizar-agenda', exigirSessao, async (req, res) => {
    const data = req.query.data || new Date().toISOString().slice(0, 10);
    try {
      await snapshotAgenda({ medx, store, config, dataLote: data });
    } catch (e) {
      console.error('[dashboard] falha ao atualizar agenda:', e.message);
      return res.status(502).json({ erro: 'Não foi possível atualizar a agenda no MedX.' });
    }
    res.json({
      data,
      resumo: store.resumoAgenda(data),
      porMedico: store.porMedicoAgenda(data),
      agenda: store.agendaCompleta(data),
    });
  });
```

- [ ] **Step 3b: Modify `src/server.js`**

Substituir o conteúdo por (acrescenta static + repassa `medx`):

```js
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { montarDashboard } from './dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');

export function criarServidor({ store, config, executarEnvio, medx }) {
  const app = express();
  app.set('trust proxy', 1); // EasyPanel termina TLS num proxy reverso

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

  app.use(express.static(PUBLIC));
  app.use('/', montarDashboard({ store, config, medx }));
  return app;
}
```

- [ ] **Step 3c: Modify `src/index.js`**

Trocar a linha `const app = criarServidor({ store, config, executarEnvio });` por:

```js
const app = criarServidor({ store, config, executarEnvio, medx });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (inclui `test/dashboard.test.js` e mantém `test/server.test.js`).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.js src/server.js src/index.js test/dashboard.test.js
git commit -m "feat(dashboard): API com agenda completa + endpoint atualizar-agenda; serve public/"
```

---

### Task 5: Assets da marca em `public/`

**Files:**
- Create: `public/favicon.svg`, `public/favicon-96x96.png`, `public/icon-192.png`, `public/icon-512.png`
- Test: `test/dashboard.test.js` (adicionar 1 teste)

**Interfaces:**
- Consumes: `express.static(PUBLIC)` (Task 4).
- Produces: arquivos estáticos servidos em `/favicon.svg`, `/favicon-96x96.png`, `/icon-192.png`, `/icon-512.png`.

- [ ] **Step 1: Copiar os assets da marca**

Run (bash, na raiz do projeto):

```bash
mkdir -p public
cp "marca/favicon/favicon-orange-no-background/favicon.svg" public/favicon.svg
cp "marca/favicon/favicon-orange-no-background/favicon-96x96.png" public/favicon-96x96.png
cp "marca/favicon/favicon-orange-no-background/web-app-manifest-192x192.png" public/icon-192.png
cp "marca/favicon/favicon-orange-no-background/web-app-manifest-512x512.png" public/icon-512.png
ls public/
```
Expected: lista os 4 arquivos.

- [ ] **Step 2: Write the failing test**

Adicionar ao fim de `test/dashboard.test.js`:

```js
test('serve o favicon da marca em /favicon.svg', async () => {
  const app = criarServidor({ store: criarStore(':memory:'), config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/favicon.svg`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /svg/);
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test`
Expected: PASS (os arquivos já foram copiados no Step 1).

- [ ] **Step 4: Commit**

```bash
git add public/ test/dashboard.test.js
git commit -m "chore(public): assets da marca Mais Chat (favicon/icones)"
```

---

### Task 6: Rebrand das views (tema claro + seção por médico)

**Files:**
- Rewrite: `views/dashboard.html`, `views/login.html`
- Test: `test/dashboard.test.js` (adicionar 1 teste de fumaça)

**Interfaces:**
- Consumes: `GET /api/dados`, `POST /api/atualizar-agenda` (Task 4); assets de `public/` (Task 5).
- Produces: páginas rebrandadas; nenhuma nova assinatura de servidor.

- [ ] **Step 1: Write the failing test**

Adicionar ao fim de `test/dashboard.test.js`:

```js
test('dashboard autenticado serve a página rebrandada', async () => {
  const app = criarServidor({ store: storeComAgenda(), config, executarEnvio: async () => ({}), medx: {} });
  await comServidor(app, async (port) => {
    const cookie = await login(port);
    const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Mais Chat/);
    assert.match(html, /Atualizar agenda/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — a `dashboard.html` atual não contém "Mais Chat" nem "Atualizar agenda".

- [ ] **Step 3a: Rewrite `views/dashboard.html`**

```html
<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Mais Chat — Agenda &amp; Confirmações</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">
<link rel="apple-touch-icon" href="/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  :root{
    --white:#FFFFFF; --gray-50:#F5F7FA; --gray-100:#EBEEF3; --gray-200:#D2DAE5;
    --gray-400:#7E98B2; --gray-600:#496280; --gray-800:#354557; --gray-900:#303C4A;
    --orange-500:#FF710A; --orange-50:#FFF7EC; --blue-500:#2F89FF; --blue-50:#EEF7FF;
    --green-500:#01C38D; --green-50:#EAFFF6; --red-700:#DB0000; --red-100:#FFDCDC;
    --yellow-500:#FFA500; --yellow-100:#FFF5C5;
    --radius-sm:10px; --radius-md:15px;
    --shadow-100:0 2px 4px -2px rgba(24,39,75,.12),0 4px 4px -2px rgba(24,39,75,.08);
    --shadow-200:0 4px 6px -4px rgba(24,39,75,.12),0 8px 8px -4px rgba(24,39,75,.08);
  }
  *{box-sizing:border-box}
  body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    background:var(--gray-50);color:var(--gray-900);margin:0;padding:1.5rem;line-height:1.5}
  header{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1.2rem}
  .brand{display:flex;align-items:center;gap:.6rem}
  .brand img{width:32px;height:32px}
  .brand h1{font-size:1.15rem;margin:0;font-weight:700}
  .brand span{color:var(--gray-600);font-weight:500;font-size:.95rem}
  .controls{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
  input[type=date]{font:inherit;padding:.45rem .6rem;border-radius:var(--radius-sm);
    border:1px solid var(--gray-200);background:var(--white);color:var(--gray-900)}
  button.primary{font:inherit;font-weight:600;cursor:pointer;border:0;border-radius:var(--radius-sm);
    background:var(--gray-800);color:var(--white);padding:.5rem .9rem}
  button.primary:disabled{opacity:.6;cursor:default}
  a.logout{color:var(--blue-500);font-size:.85rem;text-decoration:none}
  .toast{display:none;background:var(--red-100);color:var(--red-700);padding:.6rem .9rem;
    border-radius:var(--radius-sm);margin-bottom:1rem;font-size:.9rem}
  .cards{display:flex;gap:.8rem;flex-wrap:wrap;margin-bottom:1.2rem}
  .card{background:var(--white);border:1px solid var(--gray-100);border-radius:var(--radius-md);
    padding:.9rem 1.1rem;min-width:110px;box-shadow:var(--shadow-100)}
  .card .n{font-size:1.5rem;font-weight:700} .card .l{font-size:.78rem;color:var(--gray-600)}
  .box{background:var(--white);border:1px solid var(--gray-100);border-radius:var(--radius-md);
    padding:1rem;box-shadow:var(--shadow-100);margin-bottom:1.2rem}
  .medico-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem}
  .medico-hd h2{font-size:1rem;margin:0;font-weight:600}
  .medico-hd .badge{background:var(--orange-50);color:var(--orange-500);font-weight:600;
    font-size:.75rem;padding:.15rem .55rem;border-radius:9999px}
  table{width:100%;border-collapse:collapse;font-size:.86rem}
  th,td{text-align:left;padding:.45rem .5rem;border-bottom:1px solid var(--gray-100)}
  th{color:var(--gray-600);font-weight:600;font-size:.78rem;text-transform:uppercase;letter-spacing:.03em}
  tr.inelegivel{opacity:.6}
  .chip{display:inline-block;font-size:.74rem;font-weight:600;padding:.12rem .5rem;border-radius:9999px}
  .chip-success{background:var(--green-50);color:var(--green-500)}
  .chip-info{background:var(--blue-50);color:var(--blue-500)}
  .chip-accent{background:var(--orange-50);color:var(--orange-500)}
  .chip-error{background:var(--red-100);color:var(--red-700)}
  .chip-warn{background:var(--yellow-100);color:#8a6d00}
  .chip-gray{background:var(--gray-100);color:var(--gray-600)}
  .vazio{color:var(--gray-600);text-align:center;padding:2rem}
</style></head><body>
<header>
  <div class="brand">
    <img src="/favicon.svg" alt="Mais Chat">
    <h1>Mais Chat</h1><span>Agenda &amp; Confirmações</span>
  </div>
  <div class="controls">
    <input type="date" id="data">
    <button class="primary" id="atualizar">Atualizar agenda</button>
    <a class="logout" href="/logout">sair</a>
  </div>
</header>
<div class="toast" id="toast"></div>
<div class="cards" id="cards"></div>
<div class="box"><canvas id="grafico" height="90"></canvas></div>
<div id="agendas"></div>
<script>
const esc=(s)=>String(s??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hora=(iso)=> iso? String(iso).split('T')[1]?.slice(0,5) ?? '' : '';
let chart;

function statusInfo(r){
  if(r.elegivel===0){
    const m={bloqueio:['Bloqueio','chip-gray'],sem_telefone:['Sem telefone','chip-warn'],sem_paciente:['Sem paciente','chip-warn']};
    return m[r.motivo]||['Não elegível','chip-gray'];
  }
  if(r.ack==='lido')return['Lido','chip-success'];
  if(r.ack==='entregue')return['Entregue','chip-info'];
  if(r.ack==='falha'||r.status_envio==='erro')return['Falha','chip-error'];
  if(r.ack==='enviado')return['Enviado','chip-accent'];
  return['Pendente','chip-gray'];
}

function render(d){
  const c=d.resumo;
  document.getElementById('cards').innerHTML=[
    ['Total na agenda',c.total],['Elegíveis',c.elegiveis],['Enviados',c.enviado],
    ['Entregues',c.entregue],['Lidos',c.lido],['Falhas',c.falha],['Pulados',c.pulados]
  ].map(([l,n])=>`<div class="card"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`).join('');

  const grupos={};
  for(const r of d.agenda){ (grupos[r.nome_medico]??=[]).push(r); }
  const nomes=Object.keys(grupos);
  const cont=document.getElementById('agendas');
  if(!nomes.length){ cont.innerHTML='<div class="box vazio">Sem agenda para esta data.</div>'; }
  else {
    cont.innerHTML=nomes.map((med)=>{
      const linhas=grupos[med].map((r)=>{
        const [txt,cls]=statusInfo(r);
        return `<tr class="${r.elegivel===0?'inelegivel':''}">
          <td>${esc(hora(r.inicio))}</td><td>${esc(r.nome_paciente)}</td>
          <td>${esc(r.telefone)}</td><td><span class="chip ${cls}">${esc(txt)}</span></td></tr>`;
      }).join('');
      return `<div class="box"><div class="medico-hd"><h2>${esc(med)}</h2>
        <span class="badge">${grupos[med].length} agendamento(s)</span></div>
        <table><thead><tr><th>Hora</th><th>Paciente</th><th>Telefone</th><th>Status</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>`;
    }).join('');
  }

  const labels=d.porMedico.map((m)=>m.nome_medico), valores=d.porMedico.map((m)=>m.total);
  if(chart)chart.destroy();
  chart=new Chart(document.getElementById('grafico'),{type:'bar',
    data:{labels,datasets:[{label:'Agendamentos por médico',data:valores,backgroundColor:'#FF710A',borderRadius:6}]},
    options:{plugins:{legend:{display:false}},scales:{
      x:{ticks:{color:'#496280'},grid:{display:false}},
      y:{ticks:{color:'#496280'},grid:{color:'#EBEEF3'}}}}});
}

function mostrarErro(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.style.display='block';
  setTimeout(()=>{t.style.display='none';},4000);
}

async function carregar(){
  const data=document.getElementById('data').value;
  const r=await fetch('/api/dados?data='+data);
  if(!r.ok){ mostrarErro('Falha ao carregar os dados.'); return; }
  render(await r.json());
}

async function atualizar(){
  const btn=document.getElementById('atualizar');
  const data=document.getElementById('data').value;
  btn.disabled=true; btn.textContent='Atualizando…';
  try{
    const r=await fetch('/api/atualizar-agenda?data='+data,{method:'POST'});
    if(!r.ok){ mostrarErro('Não foi possível atualizar a agenda no MedX.'); return; }
    render(await r.json());
  } finally { btn.disabled=false; btn.textContent='Atualizar agenda'; }
}

const hoje=new Date().toISOString().slice(0,10);
document.getElementById('data').value=hoje;
document.getElementById('data').addEventListener('change',carregar);
document.getElementById('atualizar').addEventListener('click',atualizar);
carregar();
</script>
</body></html>
```

- [ ] **Step 3b: Rewrite `views/login.html`**

```html
<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Mais Chat — Entrar</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--white:#FFFFFF;--gray-50:#F5F7FA;--gray-100:#EBEEF3;--gray-200:#D2DAE5;
    --gray-600:#496280;--gray-800:#354557;--gray-900:#303C4A;--red-700:#DB0000;
    --radius-sm:10px;--radius-md:15px;
    --shadow-200:0 4px 6px -4px rgba(24,39,75,.12),0 8px 8px -4px rgba(24,39,75,.08)}
  *{box-sizing:border-box}
  body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    background:var(--gray-50);color:var(--gray-900);display:grid;place-items:center;height:100vh;margin:0}
  form{background:var(--white);padding:2rem;border-radius:var(--radius-md);width:320px;
    box-shadow:var(--shadow-200);border:1px solid var(--gray-100)}
  .brand{display:flex;align-items:center;gap:.55rem;margin-bottom:1.3rem}
  .brand img{width:30px;height:30px}
  .brand strong{font-size:1.1rem}
  label{display:block;margin:.7rem 0 .25rem;font-size:.82rem;color:var(--gray-600)}
  input{width:100%;padding:.6rem;border-radius:var(--radius-sm);border:1px solid var(--gray-200);
    background:var(--white);color:var(--gray-900);font:inherit}
  button{margin-top:1.2rem;width:100%;padding:.65rem;border:0;border-radius:var(--radius-sm);
    background:var(--gray-800);color:var(--white);font-weight:600;cursor:pointer;font:inherit}
  .erro{color:var(--red-700);font-size:.82rem;margin-top:.6rem}
</style></head><body>
<form method="POST" action="/login">
  <div class="brand"><img src="/favicon.svg" alt="Mais Chat"><strong>Mais Chat</strong></div>
  <label>Usuário</label><input name="usuario" autofocus>
  <label>Senha</label><input name="senha" type="password">
  <button type="submit">Entrar</button>
  <div class="erro" id="erro"></div>
</form>
<script>if(location.search.includes('erro'))document.getElementById('erro').textContent='Usuário ou senha inválidos';</script>
</body></html>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (todos os testes).

- [ ] **Step 5: Commit**

```bash
git add views/dashboard.html views/login.html test/dashboard.test.js
git commit -m "feat(ui): rebrand Mais Chat (tema claro) e agenda por medico no dashboard"
```

---

## Self-Review

**Spec coverage:**
- Rebrand tema claro + tokens da marca → Task 6 (views) + Task 5 (assets). ✅
- Laranja só acento, ação primária cinza-800, chips semânticos → Task 6 (CSS). ✅
- Tabela `agenda_itens` + classificação de motivo → Task 1 + Task 2. ✅
- `gravarSnapshot`/`snapshotAgenda`/`mapaMedicos` compartilhado → Task 2; job usa → Task 3. ✅
- `/api/dados` nova forma + `/api/atualizar-agenda` (502 em erro) + static `public/` → Task 4. ✅
- Seção por médico + botão atualizar → Task 6. ✅
- Envio/ACK inalterados → Task 3 só adiciona snapshot antes do laço; testes de envio mantidos. ✅
- Testes novos somando aos 35 → Tasks 1,2,3,4,5,6. ✅

**Placeholder scan:** sem TBD/TODO; todo passo tem código/comando concretos. ✅

**Type consistency:** `upsertAgendaItem`, `agendaCompleta`, `resumoAgenda`, `porMedicoAgenda`, `mapaMedicos`, `classificarItem`, `gravarSnapshot`, `snapshotAgenda` usados com a mesma assinatura em todas as tasks; payload `{ data, resumo, porMedico, agenda }` idêntico entre API (Task 4) e UI (Task 6); `resumo` com campos `total/elegiveis/pulados/enviado/entregue/lido/falha` consistente entre Task 1 e Task 6. ✅
