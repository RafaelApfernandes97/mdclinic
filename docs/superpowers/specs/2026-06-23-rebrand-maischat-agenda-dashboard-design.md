# Rebrand Mais Chat + Agenda completa no dashboard

**Data:** 2026-06-23
**Status:** Aprovado para planejamento
**Base:** projeto `mdclinic` (automação de confirmação de agendamento MedX → Mais Chat),
ver `docs/superpowers/specs/2026-06-21-confirmacao-agendamento-design.md`.

## Objetivo

Evoluir o **dashboard web** do projeto em dois eixos, sem alterar a lógica de envio/ACK já
validada:

1. **Rebrand** — aplicar a identidade visual da **Mais Chat** (cores, tipografia, logo,
   favicon) ao dashboard e à tela de login, migrando do tema escuro atual para **tema claro**
   conforme o guia da marca.
2. **Agenda completa** — exibir na página a **agenda completa de cada médico** para a data
   selecionada (todos os agendamentos, incluindo os **pulados/não-elegíveis**), com o status
   real de envio/confirmação por linha. A agenda é persistida como **snapshot** no banco e
   pode ser **atualizada sob demanda** (modelo híbrido) re-puxando o MedX ao vivo.

### Fora de escopo (YAGNI)

Inalterados: lógica de envio (`maischat.js`, `job.js` envio), ACK updater, scheduler,
cliente MedX, contrato Mais Chat. Sem webhook, sem captura de resposta do paciente, sem
`UpdateAgendamento` de volta.

## Contexto atual

- Dashboard (`views/dashboard.html` + `login.html`): tema escuro `#0f172a`, azul `#2563eb`,
  fonte `system-ui`. Lê só a tabela `envios` via `/api/dados` (`src/dashboard.js`), que
  filtra `status_envio='enviado'`. Cards (Total/Enviado/Entregue/Lido/Falha), gráfico de
  envios por médico (Chart.js) e tabela detalhada.
- O `job.js` (linha ~30) **descarta** itens não-elegíveis com `continue` — eles nunca chegam
  ao banco, então hoje é impossível exibi-los.
- Elegibilidade e extração de campos já existem em `src/agendamentos.js`
  (`ehElegivel`, `ehBloqueio`, `normalizarTelefone`, `montarEnvio`).
- Guia da marca em `marca/`: paleta SCSS (cinza base, laranja `#FF710A` como acento 5–10%,
  azul ações secundárias), fonte **Inter**, raios/sombras, logos (`Logos/logo-full/orange-logo`,
  `white-logo`) e favicons (`favicon/favicon-orange-no-background` etc. com `site.webmanifest`).
- Servidor Express em `src/server.js`; rotas do dashboard em `src/dashboard.js` (sessão por
  cookie, login por usuário/senha do `.env`).

## Eixo 1 — Identidade visual

Migração para **tema claro** seguindo a hierarquia cromática do guia (cinza 70–80%, azul
secundário, laranja só acento):

- **Tokens** (refletindo `_variables.scss`): fundo `gray-50 #F5F7FA`; cards `#FFFFFF`/`gray-100`;
  texto corpo `gray-900 #303C4A`, secundário `gray-600 #496280`; bordas `gray-200 #D2DAE5`;
  raios (`10/15/20px`), sombras (`$shadow-100..300`).
- **Tipografia**: Inter (Google Fonts), escala do guia.
- **Laranja `#FF710A`** restrito a: logo, data selecionada, médico/seção ativa, chip
  "aguardando/enviado-sem-ACK". **Nunca** em botões de ação funcional.
- **Azul** em links/elementos informativos; **ação primária** (botão "Atualizar agenda") em
  `gray-800 #354557`.
- **Chips de status** (semânticos):
  - `lido` → verde (`#01C38D`)
  - `entregue` → azul (`#2F89FF`)
  - `enviado` (sem ACK ainda) → laranja acento / cinza
  - `falha` → vermelho (`#DB0000`)
  - `pulado`/não-elegível → cinza claro (`bloqueio`) ou amarelo (`#FFA500`) para
    `sem_telefone`/`sem_paciente`
- **Assets servidos**: novo diretório `public/` servido via `express.static`. Copiar para lá
  o logo (de `marca/Logos/logo-full/orange-logo`) e o conjunto de favicon
  (`marca/favicon/favicon-orange-no-background`: `favicon.svg`, `.ico`, PNGs, `site.webmanifest`).
  Header do dashboard com logo Mais Chat; `<link rel="icon">` e manifest nas duas páginas.
- **Acessibilidade**: contraste WCAG AA (texto sobre cinza claro = `gray-900/800`; texto sobre
  cores escuras = branco), conforme "Regras de Contraste" do guia.

A tela de **login** recebe o mesmo tema (card branco sobre `gray-50`, logo no topo, botão
"Entrar" em `gray-800`).

## Eixo 2 — Agenda completa

### Modelo de dados

Nova tabela **`agenda_itens`** (snapshot da agenda), separada de `envios` (que permanece
intacta):

```sql
CREATE TABLE IF NOT EXISTS agenda_itens (
  id_agendamento INTEGER PRIMARY KEY,
  data_lote      TEXT,      -- 'YYYY-MM-DD' (dia do agendamento)
  id_usuario     INTEGER,
  nome_medico    TEXT,
  id_paciente    INTEGER,
  nome_paciente  TEXT,
  telefone       TEXT,      -- normalizado (ou NULL se inválido)
  inicio         TEXT,      -- ISO do MedX
  elegivel       INTEGER,   -- 1/0
  motivo         TEXT,      -- NULL se elegível; senão 'bloqueio' | 'sem_telefone' | 'sem_paciente'
  descricao      TEXT,      -- Descricao crua do MedX (útil para bloqueios)
  capturado_em   TEXT       -- ISO de quando o snapshot foi gravado
);
CREATE INDEX IF NOT EXISTS idx_agenda_lote ON agenda_itens(data_lote);
```

Classificação de `motivo` (ordem de precedência, reusando `agendamentos.js`):
`ehBloqueio(descricao)` → `bloqueio`; senão sem `Id_Paciente` → `sem_paciente`; senão
telefone inválido (`normalizarTelefone` retorna `null`) → `sem_telefone`; caso contrário
elegível (`motivo = NULL`).

### Captura (snapshot) — módulo novo `src/agendaSnapshot.js`

Para evitar buscar a agenda do MedX duas vezes (uma no job, outra no snapshot) e duplicar o
mapa de médicos, o módulo expõe **três peças**:

- `mapaMedicos(usuarios, campoNome)` — **movida** de `job.js` para cá; `job.js` passa a
  importá-la (sem duplicação).
- `gravarSnapshot({ store, agenda, mapa, dataLote, agora })` — sem chamadas ao MedX: para
  cada item da agenda classifica `elegivel`/`motivo` (reusando `agendamentos.js`), extrai
  nome/telefone e faz `store.upsertAgendaItem(...)`. **Não envia nada.** Retorna
  `{ dataLote, total, elegiveis }`.
- `snapshotAgenda({ medx, store, config, dataLote })` — busca ao vivo
  `Promise.all([medx.getAgenda(dataLote, dataLote), medx.getUsuarios()])`, monta o `mapa` e
  chama `gravarSnapshot(...)`. Usada pelo endpoint **"atualizar agora"**.

`job.js` continua buscando agenda+usuários **uma única vez** (como hoje), monta o `mapa` com
`mapaMedicos`, chama `gravarSnapshot(...)` com esses dados **antes** do laço de envio e então
envia os elegíveis ainda não enviados — comportamento de envio/ACK **inalterado**. Se
`gravarSnapshot` lançar, o job loga e segue para o envio (o snapshot é complementar, não pode
regredir o envio já validado).

### Métodos novos em `src/store.js`

- `upsertAgendaItem(item)` — INSERT … ON CONFLICT(id_agendamento) DO UPDATE de todos os campos
  do snapshot (refresh sobrescreve o snapshot, mas **não toca** em `envios`).
- `agendaCompleta(dataLote)` — `agenda_itens LEFT JOIN envios USING(id_agendamento)`,
  retornando por linha: `nome_medico, inicio, nome_paciente, telefone, elegivel, motivo,
  status_envio, ack, data_envio, ack_atualizado_em`; ordenado por `nome_medico, inicio`.
- `resumoAgenda(dataLote)` — contadores: `total` (itens na agenda), `elegiveis`, `enviado`,
  `entregue`, `lido`, `falha`, `pulados` (não-elegíveis).
- `porMedicoAgenda(dataLote)` — `nome_medico, COUNT(*)` agrupado, ordenado desc (para o gráfico).

As queries antigas (`resumoPorData`, `porMedico`, `detalhado`) permanecem para não quebrar os
testes existentes; o dashboard passa a usar as novas.

### API (`src/dashboard.js` / `src/server.js`)

- `GET /api/dados?data=YYYY-MM-DD` (sessão) — passa a devolver
  `{ data, resumo: resumoAgenda, porMedico: porMedicoAgenda, agenda: agendaCompleta }`.
- `POST /api/atualizar-agenda?data=YYYY-MM-DD` (sessão) — chama `snapshotAgenda` **ao vivo**
  para a data e retorna o payload de `/api/dados` já atualizado. Em erro do MedX, responde
  `502` com mensagem amigável (a UI mostra aviso, mantém o snapshot anterior).
- Servir `public/` via `express.static` (em `server.js`, antes do router do dashboard).
- A injeção de `medx`/`config` no router do dashboard será adicionada (hoje recebe só
  `{ store, config }`); `server.js`/`index.js` passam `medx` adiante.

### UI (`views/dashboard.html`)

- Header: logo Mais Chat, seletor de data, botão **"Atualizar agenda"** (`gray-800`), link "sair".
- **Cards de resumo**: Total na agenda · Elegíveis · Enviados · Entregues · Lidos · Falhas · Pulados.
- **Gráfico** por médico (Chart.js) com cores da marca.
- **Seção por médico**: para cada médico, um card com cabeçalho (nome + contagem) e uma tabela
  de agendamentos do dia: `Hora · Paciente · Telefone · Status`. O status é um **chip**
  (enviado/entregue/lido/falha) ou o **motivo** (bloqueio/sem telefone/sem paciente) para os
  não-elegíveis. Linhas não-elegíveis levemente esmaecidas.
- Escape de HTML mantido (`esc(...)`, já existe) para todos os campos vindos da API.
- Botão "Atualizar agenda" faz `POST /api/atualizar-agenda`, com estado de carregando e
  tratamento de erro.

## Componentes (resumo de responsabilidades)

| Unidade | Responsabilidade | Depende de |
|---|---|---|
| `agendaSnapshot.js` (novo) | Puxar agenda do MedX, classificar elegibilidade/motivo, gravar snapshot | `medx`, `store`, `agendamentos.js` |
| `store.js` (+métodos) | Persistir/consultar `agenda_itens`; join com `envios` | `node:sqlite` |
| `dashboard.js` (+rota) | Servir dados da agenda e endpoint de atualização sob demanda | `store`, `medx`, `config` |
| `views/*.html` | Apresentação rebrandada (tema claro, marca, seção por médico) | `public/` assets |
| `public/` (novo) | Logo, favicons, manifest da Mais Chat | — |

## Tratamento de erros

- `/api/atualizar-agenda`: falha de rede/auth do MedX → `502` + mensagem; UI exibe toast e
  mantém o último snapshot.
- `gravarSnapshot` no `job.js`: se lançar, o job loga e **segue para o envio** (snapshot é
  complementar; não pode regredir o envio já validado).
- Datas sem agenda → resumo zerado e estado vazio amigável na UI ("Sem agenda para esta data").

## Testes (TDD, somando aos 35 existentes)

- `agendamentos`/classificação: `motivo` correto para bloqueio, sem paciente, sem telefone, elegível.
- `store`: `upsertAgendaItem` (insert + update idempotente), `agendaCompleta` (join com/sem
  envio correspondente), `resumoAgenda`, `porMedicoAgenda`.
- `agendaSnapshot`: com `medx` e `store` fakes, grava todos os itens e classifica; não envia.
- `dashboard`: `/api/dados` exige sessão e retorna a nova forma; `/api/atualizar-agenda`
  exige sessão, chama snapshot e devolve dados (MedX fake); 502 em erro do MedX.

## Decisões fechadas

- Tema **claro** (não manter escuro).
- Layout **seção por médico** (não tabela única filtrável).
- Fonte da agenda: **híbrido** (snapshot persistido + botão atualizar ao vivo).
- `agenda_itens` é **tabela separada** de `envios` (separação de responsabilidades; não
  reescreve as queries/tabela já testadas).
