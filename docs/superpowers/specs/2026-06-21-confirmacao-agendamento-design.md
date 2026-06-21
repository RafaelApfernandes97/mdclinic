# Automação de Confirmação de Agendamento (MedX → Mais Chat)

**Data:** 2026-06-21
**Status:** Aprovado para planejamento

## Objetivo

Serviço que, **todo dia às 08:00 (America/Sao_Paulo)**, consulta a agenda do MedX,
identifica os agendamentos **do dia seguinte** e dispara um **template de WhatsApp (Meta)**
de confirmação para cada paciente, via API REST do **Mais Chat**, sem reenviar para o mesmo
agendamento. Depois do envio, **atualiza o status (ACK) das mensagens** consultando o
Mais Chat, e oferece um **dashboard web (só leitura, com login)** para acompanhar os envios.

Escopo da v1: **somente envio (mão única).** Capturar resposta do paciente e gravar
confirmação de volta no MedX (`UpdateAgendamento`) **fica fora desta versão**.

## Contexto

- Documentação da API MedX em `apimdx.txt` (auth, agenda, usuários, etc.).
- Envio do template e consulta de ACK são feitos pela **API REST do Mais Chat** (não pelo
  MCP, que só existe dentro da sessão do Claude). Todas as credenciais/URLs vêm do `.env`.
- O template e suas variáveis serão criados pelo usuário **mais tarde** → nome do template
  e mapeamento de variáveis são **configuráveis no `.env`**.
- Hospedagem: **EasyPanel** (container Docker). Agendamento via `node-cron` interno
  (processo sempre ligado), sem cron externo do painel.

## Arquitetura

Serviço Node.js empacotado em **Docker**, rodando no EasyPanel como processo persistente.

- **Scheduler interno** (`node-cron`) dispara o job de envio às 08:00 BR.
- **Passes de ACK** agendados após cada lote: **+5 min** do fim da campanha e **+1h** do
  envio (ver "Atualização de ACK").
- **Servidor HTTP** (Express) que serve:
  - O **dashboard web** (com login) para acompanhamento.
  - `GET /health` → checagem de saúde para o EasyPanel.
  - `POST /run-now` → executa o job de envio manualmente (protegido por `RUN_TOKEN`).
- **Persistência**: **SQLite em volume persistente** do EasyPanel, para envios, status de
  ACK e os passes de atualização sobreviverem a reinícios do container.

### Fluxo diário (job de envio)

1. **Autentica no MedX** → `GET /api/integration/GetAuthorizedToken?token=...`
   (token vale 180 min; gerado a cada execução).
2. **Calcula a data de amanhã** no fuso `America/Sao_Paulo`.
3. **Busca a agenda de amanhã** → `GET /api/integration/GetAgenda?inicio=AMANHA&fim=AMANHA`
   (toda a clínica = todos os pacientes).
4. **Mapeia médicos** → `GET /api/integration/GetUsuariosAgenda` para traduzir
   `Id_Usuario` → nome do médico.
5. **Filtra** os elegíveis:
   - `SMS` (telefone) preenchido **e** `Id_Paciente` válido (≠ 0/nulo);
   - **ignora** bloqueios: `Descricao` contendo `FECHADA`, `BLOQUEADO` ou `SEQUENCIAL`,
     ou sem paciente vinculado;
   - **ignora** quem já recebeu (registro no SQLite por `Id_Agendamento`).
6. **Extrai dados**: nome do paciente (início da `Descricao`), telefone normalizado para
   WhatsApp (`55` + DDD + número), data e hora (`Inicio`), nome do médico.
7. **Envia o template** via API REST do Mais Chat (nome do template + variáveis na ordem
   definidas no `.env`); guarda o **ID da mensagem** retornado.
8. **Registra o envio** no SQLite (anti-duplicidade + ACK inicial) e gera log no console.
9. **Cria/atualiza o lote do dia** e **agenda os dois passes de ACK** (+5min do fim da
   campanha, +1h do envio).

### Atualização de ACK

- O Mais Chat expõe uma **consulta de mensagem** que retorna o ACK atualizado.
- Para cada lote diário, há **dois passes**:
  - **Passe 1:** `fim_da_campanha + 5 minutos`.
  - **Passe 2:** `horario_do_envio + 1 hora`.
- Em cada passe, consulta o status **apenas das mensagens que ainda não estão `lido`**
  (mensagens já `lido` não são reconsultadas) e atualiza `ack` e `ack_atualizado_em`.
- Os passes são **persistidos** na tabela `lotes`. Na inicialização, o serviço **reagenda
  passes pendentes** (cujo horário ainda não passou) e **executa imediatamente** os que já
  venceram enquanto o container estava fora do ar.
- Níveis de ACK: `enviado` / `entregue` / `lido` / `falha`. O mapeamento dos códigos do
  Mais Chat para esses níveis fica isolado em `maischat.js` e é configurável quando a API
  real for conhecida.

### Dashboard web (só leitura, com login)

- **Autenticação**: usuário/senha vindos do `.env`; sessão por **cookie assinado**.
  Todas as rotas do dashboard exigem sessão válida; sem sessão → redireciona para `/login`.
- **Stack**: páginas servidas pelo próprio Node (HTML + JS leve), **sem framework SPA**.
  Gráfico de barras com **Chart.js via CDN**.
- **Visões** (todas com **filtro por data**, default = hoje):
  - **Contadores**: total enviado, entregue, lido, falha.
  - **Gráfico de barras**: **envios por médico (Dr)**.
  - **Tabela detalhada**: paciente, telefone, médico, horário da consulta, status ACK,
    hora do envio, hora da última atualização de ACK.
- **Sem ações de escrita** na tela (só leitura). Disparo manual continua via `POST /run-now`
  protegido por `RUN_TOKEN` (fora do dashboard).

## Componentes

| Arquivo | Responsabilidade |
|---|---|
| `src/config.js` | Lê e valida variáveis do `.env`. |
| `src/medx.js` | Cliente MedX: auth, `getAgenda`, `getUsuarios`; re-auth em token expirado. |
| `src/maischat.js` | Cliente Mais Chat: `sendTemplate(...)` e `getStatusMensagem(idMensagem)`; mapeia código → nível de ACK. |
| `src/agendamentos.js` | Filtros, extração de nome, normalização de telefone, formatação de data/hora BR, cálculo de "amanhã". |
| `src/store.js` | SQLite: envios (`jaEnviado`, `registrarEnvio`, `atualizarAck`), lotes (`criarLote`, `passesPendentes`, `marcarPasseFeito`) e consultas do dashboard (`resumoPorData`, `porMedico`, `detalhado`). |
| `src/job.js` | Orquestra o fluxo diário de envio + criação do lote. |
| `src/ackUpdater.js` | Executa um passe de ACK (consulta mensagens não-`lido` e atualiza). |
| `src/scheduler.js` | `node-cron` (08:00 BR) + reagendamento/execução dos passes de ACK pendentes. |
| `src/dashboard.js` | Rotas Express do dashboard: `/login`, logout, páginas e dados; middleware de sessão. |
| `src/server.js` | Servidor HTTP: monta dashboard + `/health` + `/run-now`. |
| `src/index.js` | Ponto de entrada: inicia store, scheduler e servidor. |
| `views/` | Templates HTML do login e do dashboard. |
| `Dockerfile` | Imagem do serviço. |
| `.env.example` | Modelo de configuração. |
| `README.md` | Como configurar e implantar no EasyPanel. |

## Modelo de dados (SQLite)

### Tabela `envios`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_agendamento` | INTEGER PK | Chave de idempotência. |
| `id_paciente` | INTEGER | ID do paciente. |
| `nome_paciente` | TEXT | Nome extraído da `Descricao`. |
| `telefone` | TEXT | Telefone normalizado enviado. |
| `id_usuario` | INTEGER | ID do médico. |
| `nome_medico` | TEXT | Nome do médico (de `GetUsuariosAgenda`). |
| `inicio` | TEXT | Data/hora do agendamento. |
| `id_mensagem` | TEXT | ID retornado pelo Mais Chat no envio (para consultar ACK). |
| `status_envio` | TEXT | `enviado` / `erro`. |
| `ack` | TEXT | `enviado` / `entregue` / `lido` / `falha`. |
| `ack_atualizado_em` | TEXT | Timestamp ISO da última atualização de ACK. |
| `data_envio` | TEXT | Timestamp ISO do envio. |
| `data_lote` | TEXT | Data do lote (`YYYY-MM-DD`), para filtros do dashboard. |
| `erro` | TEXT | Mensagem de erro, se houver. |

Idempotência: existe registro com `status_envio = enviado` para o `id_agendamento` →
**não reenvia**. Registro com `status_envio = erro` pode ser retentado na próxima execução.

### Tabela `lotes`

| Coluna | Tipo | Descrição |
|---|---|---|
| `data_lote` | TEXT PK | Data do lote (`YYYY-MM-DD`). |
| `fim_campanha` | TEXT | Timestamp ISO do último envio do dia. |
| `passe1_em` | TEXT | Quando rodar o passe +5min (`fim_campanha + 5min`). |
| `passe1_feito` | INTEGER | 0/1. |
| `passe2_em` | TEXT | Quando rodar o passe +1h (`data_envio + 1h`). |
| `passe2_feito` | INTEGER | 0/1. |

## Configuração (`.env`)

| Variável | Descrição |
|---|---|
| `MEDX_BASE_URL` | Base URL do MedX. |
| `MEDX_TOKEN_INTEGRACAO` | Token de integração do MedX. |
| `MAISCHAT_BASE_URL` | Base URL da API do Mais Chat. |
| `MAISCHAT_TOKEN` | Token de autenticação do Mais Chat. |
| `MAISCHAT_TEMPLATE_NOME` | Nome do template Meta a enviar. |
| `MAISCHAT_TEMPLATE_VARIAVEIS` | Ordem das variáveis (ex.: `nome,medico,data,hora`). |
| `MAISCHAT_TEMPLATE_IDIOMA` | Código de idioma do template (ex.: `pt_BR`). |
| `CRON_HORARIO` | Expressão cron do envio (default `0 8 * * *`). |
| `ACK_PASSE1_MIN` | Minutos após o fim da campanha para o passe 1 (default `5`). |
| `ACK_PASSE2_MIN` | Minutos após o envio para o passe 2 (default `60`). |
| `TZ` | Fuso (`America/Sao_Paulo`). |
| `RUN_TOKEN` | Token que protege o `POST /run-now`. |
| `DASHBOARD_USER` | Usuário de login do dashboard. |
| `DASHBOARD_PASSWORD` | Senha de login do dashboard. |
| `SESSION_SECRET` | Segredo para assinar o cookie de sessão. |
| `PORT` | Porta do servidor HTTP (default `3000`). |
| `SQLITE_PATH` | Caminho do arquivo SQLite no volume (ex.: `/data/envios.db`). |

> O formato exato do body do `sendTemplate` e da consulta de status será espelhado no
> formato Meta/Mais Chat e isolado em `maischat.js`; o mapeamento de variáveis é dirigido
> por `MAISCHAT_TEMPLATE_VARIAVEIS` e o de códigos de ACK fica centralizado no mesmo módulo.

## Tratamento de erros

- **Token MedX expirado** (401/erro de auth) → re-autentica e repete a chamada uma vez.
- **Falha de envio de um paciente** → registra `erro` no SQLite, loga e **continua** o lote.
- **Falha na consulta de ACK de uma mensagem** → loga e segue para as demais; o passe pode
  ser retentado no próximo passe agendado.
- **Sem telefone / bloqueio / sem paciente** → pula com log explicativo.
- **Idempotência** → reexecução no mesmo dia não reenvia os já marcados como `enviado`.
- **Falha global** (ex.: MedX fora do ar) → loga e encerra o job sem derrubar o processo;
  próxima execução tenta de novo.
- **Reinício do container** → passes de ACK pendentes são reagendados; passes vencidos são
  executados na inicialização.

## Regras de negócio

- Não enviar sem telefone.
- Não enviar duplicado por `Id_Agendamento`.
- Normalizar telefone para formato WhatsApp brasileiro (`55` + DDD + número).
- Considerar fuso `America/Sao_Paulo` ao calcular "amanhã" e formatar data/hora.
- Ignorar `FECHADA` / `BLOQUEADO` / `SEQUENCIAL` e registros sem paciente.
- Em cada passe de ACK, **não reconsultar** mensagens já com ACK `lido`.

## Testes

- **Unitários** (lógica pura, sem rede):
  - extração do nome do paciente a partir da `Descricao`;
  - normalização de telefone (vários formatos de entrada);
  - filtro de elegibilidade (bloqueios, sem SMS, sem paciente);
  - formatação de data/hora BR e cálculo de "amanhã" no fuso correto;
  - `store`: idempotência, `atualizarAck`, agregações do dashboard
    (`resumoPorData`, `porMedico`, `detalhado`) com SQLite em memória;
  - agendamento de passes: cálculo de `passe1_em`/`passe2_em` e seleção de passes pendentes.
- **Clientes HTTP** (`medx`, `maischat`): mock de `fetch` (auth, re-auth, payload do
  template, consulta de status e mapeamento de código → nível de ACK).
- **`job`**: orquestração com clientes e store mockados (caminho feliz + pula bloqueio +
  pula já enviado + continua após erro de um envio + cria lote).
- **`ackUpdater`**: passe consulta só não-`lido`, atualiza ACK, marca passe feito.
- **Dashboard**: rota protegida sem sessão → redireciona para `/login`; login válido →
  acessa; endpoint de dados retorna agregações corretas (com store mockado/in-memory).

## Fora de escopo (v1)

- Receber respostas do paciente / webhooks.
- Gravar confirmação de volta no MedX (`UpdateAgendamento`).
- Ações de escrita no dashboard (reenvio/disparo pela tela).
- Reenvio/retry automático além dos dois passes de ACK definidos.
