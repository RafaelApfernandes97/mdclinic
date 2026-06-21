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
