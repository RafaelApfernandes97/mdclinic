# Automação de Confirmação de Agendamento (MedX → Mais Chat)

**Data:** 2026-06-21
**Status:** Aprovado para planejamento

## Objetivo

Serviço que, **todo dia às 08:00 (America/Sao_Paulo)**, consulta a agenda do MedX,
identifica os agendamentos **do dia seguinte** e dispara um **template de WhatsApp (Meta)**
de confirmação para cada paciente, via API REST do **Mais Chat**, sem reenviar para o mesmo
agendamento.

Escopo da v1: **somente envio (mão única).** Capturar resposta do paciente e gravar
confirmação de volta no MedX (`UpdateAgendamento`) **fica fora desta versão**.

## Contexto

- Documentação da API MedX em `apimdx.txt` (auth, agenda, usuários, etc.).
- Envio do template é feito pela **API REST do Mais Chat** (não pelo MCP, que só existe
  dentro da sessão do Claude). Todas as credenciais/URLs vêm do `.env`.
- O template e suas variáveis serão criados pelo usuário **mais tarde** → nome do template
  e mapeamento de variáveis são **configuráveis no `.env`**.
- Hospedagem: **EasyPanel** (container Docker). Agendamento via `node-cron` interno
  (processo sempre ligado), sem cron externo do painel.

## Arquitetura

Serviço Node.js empacotado em **Docker**, rodando no EasyPanel como processo persistente.

- **Scheduler interno** (`node-cron`) dispara o job às 08:00 BR.
- **Mini servidor HTTP**:
  - `GET /health` → checagem de saúde para o EasyPanel.
  - `POST /run-now` → executa o job manualmente (protegido por `RUN_TOKEN`), para testes.
- **Persistência**: **SQLite em volume persistente** do EasyPanel, para o controle de
  duplicidade sobreviver a reinícios do container.

### Fluxo diário (o job)

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
   definidas no `.env`).
8. **Registra o envio** no SQLite (anti-duplicidade) e gera log no console.

## Componentes

| Arquivo | Responsabilidade |
|---|---|
| `src/config.js` | Lê e valida variáveis do `.env`. |
| `src/medx.js` | Cliente MedX: auth, `getAgenda`, `getUsuarios`; re-auth em token expirado. |
| `src/maischat.js` | Cliente Mais Chat: `sendTemplate(telefone, variaveis)`. |
| `src/agendamentos.js` | Filtros, extração de nome, normalização de telefone, formatação de data/hora BR. |
| `src/store.js` | Controle de duplicidade em SQLite (`jaEnviado`, `registrarEnvio`). |
| `src/job.js` | Orquestra o fluxo diário. |
| `src/scheduler.js` | `node-cron` (08:00 BR) + servidor HTTP (`/health`, `/run-now`). |
| `src/index.js` | Ponto de entrada: inicia scheduler + servidor. |
| `Dockerfile` | Imagem do serviço. |
| `.env.example` | Modelo de configuração. |
| `README.md` | Como configurar e implantar no EasyPanel. |

## Modelo de dados (SQLite)

Tabela `envios`:

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_agendamento` | INTEGER PK | Chave de idempotência. |
| `id_paciente` | INTEGER | ID do paciente. |
| `telefone` | TEXT | Telefone normalizado enviado. |
| `inicio` | TEXT | Data/hora do agendamento. |
| `status_envio` | TEXT | `enviado` / `erro`. |
| `data_envio` | TEXT | Timestamp ISO do envio. |
| `erro` | TEXT | Mensagem de erro, se houver. |

Idempotência: existe registro `enviado` para o `id_agendamento` → **não reenvia**.
Registro com `erro` pode ser retentado na próxima execução.

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
| `CRON_HORARIO` | Expressão cron (default `0 8 * * *`). |
| `TZ` | Fuso (`America/Sao_Paulo`). |
| `RUN_TOKEN` | Token que protege o `POST /run-now`. |
| `PORT` | Porta do servidor HTTP (default `3000`). |
| `SQLITE_PATH` | Caminho do arquivo SQLite no volume (ex.: `/data/envios.db`). |

> O formato exato do body do `sendTemplate` será espelhado no formato Meta/Mais Chat e
> isolado em `maischat.js`; o mapeamento de variáveis é dirigido por
> `MAISCHAT_TEMPLATE_VARIAVEIS`.

## Tratamento de erros

- **Token MedX expirado** (401/erro de auth) → re-autentica e repete a chamada uma vez.
- **Falha de envio de um paciente** → registra `erro` no SQLite, loga e **continua** o lote.
- **Sem telefone / bloqueio / sem paciente** → pula com log explicativo.
- **Idempotência** → reexecução no mesmo dia não reenvia os já marcados como `enviado`.
- **Falha global** (ex.: MedX fora do ar) → loga e encerra o job sem derrubar o processo;
  próxima execução tenta de novo.

## Regras de negócio

- Não enviar sem telefone.
- Não enviar duplicado por `Id_Agendamento`.
- Normalizar telefone para formato WhatsApp brasileiro (`55` + DDD + número).
- Considerar fuso `America/Sao_Paulo` ao calcular "amanhã" e formatar data/hora.
- Ignorar `FECHADA` / `BLOQUEADO` / `SEQUENCIAL` e registros sem paciente.

## Testes

- **Unitários** (foco em lógica pura, sem rede):
  - extração do nome do paciente a partir da `Descricao`;
  - normalização de telefone (vários formatos de entrada);
  - filtro de elegibilidade (bloqueios, sem SMS, sem paciente);
  - formatação de data/hora BR;
  - cálculo de "amanhã" no fuso correto;
  - `store`: `jaEnviado` / `registrarEnvio` (idempotência) com SQLite em memória.
- **Clientes HTTP** (`medx`, `maischat`): testados com mock de `fetch` (auth, re-auth,
  montagem de payload do template).
- **`job`**: teste de orquestração com clientes e store mockados (caminho feliz +
  pula bloqueio + pula já enviado + continua após erro de um envio).

## Fora de escopo (v1)

- Receber respostas do paciente / webhooks.
- Gravar confirmação de volta no MedX (`UpdateAgendamento`).
- Painel/UI de acompanhamento.
- Reenvio/retry automático em janelas adicionais (apenas a execução diária).
