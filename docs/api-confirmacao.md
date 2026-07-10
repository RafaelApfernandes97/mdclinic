# API — Confirmação de Consulta

Endpoint chamado pelo **bot** quando o paciente clica no botão **"Confirmar"** do
template de WhatsApp. O bot conhece apenas o **telefone** do paciente. O sistema localiza
o agendamento no MedX pelo telefone e grava o status **CONFIRMADO**.

## Endpoint

```
POST /api/confirmacao
Content-Type: application/json
```

- **Sem autenticação.** Qualquer chamada com corpo válido é processada.
- Escreve direto na agenda do MedX (produção).

## Como o agendamento é localizado

1. Normaliza o telefone recebido (aceita `11911761633`, `(11) 91176-1633`,
   `5511911761633` — todos viram `5511911761633`). A comparação **tolera o 9º dígito**:
   o `wa_id` do WhatsApp pode vir sem o 9 (`553488353700`) e ainda casa com o número
   guardado no MedX com o 9 (`34988353700`).
2. Busca a agenda na janela **hoje até hoje+15 dias** (fuso de Brasília; configurável
   via `JANELA_CONFIRMACAO_DIAS`). A janela cobre o envio de véspera — inclusive
   **sexta → segunda**, quando o envio pula o fim de semana — e o **envio antecipado
   de 15 dias**.
3. Filtra os agendamentos daquele telefone que **ainda não passaram**, ignorando os
   **DESMARCADOS** (confirmar um desmarcado o ressuscitaria no MedX).
4. Confirma o **mais próximo no tempo** (menor horário de início futuro).

## Corpo da requisição

| Campo      | Tipo   | Obrigatório | Descrição                                          |
|------------|--------|-------------|----------------------------------------------------|
| `telefone` | string | sim         | Telefone do paciente (com ou sem DDI/DDD/máscara). |

```json
{
  "telefone": "11911761633"
}
```

## Exemplo — cURL

```bash
curl --location 'https://SEU-DOMINIO/api/confirmacao' \
  --header 'Content-Type: application/json' \
  --data '{ "telefone": "11911761633" }'
```

## Exemplo — local (desenvolvimento)

```bash
curl --location 'http://localhost:3000/api/confirmacao' \
  --header 'Content-Type: application/json' \
  --data '{ "telefone": "11911761633" }'
```

## Respostas

### 200 — confirmado

```json
{
  "success": true,
  "idAgendamento": -19659252,
  "statusAplicado": "CONFIRMADO",
  "jaConfirmado": false,
  "inicio": "2026-07-09T18:00:00",
  "telefone": "5511911761633"
}
```

- `jaConfirmado: true` → o agendamento **já estava** CONFIRMADO. A chamada é idempotente
  e nada foi reescrito no MedX.
- `idAgendamento` / `inicio` → identificam qual agendamento foi confirmado (útil para log
  do bot).

### 400 — telefone ausente ou inválido

```json
{ "success": false, "erro": "telefone obrigatório" }
```
```json
{ "success": false, "erro": "telefone inválido" }
```

### 404 — nenhum agendamento para o telefone

```json
{ "success": false, "erro": "Nenhum agendamento futuro para este telefone (próximos 15 dias)" }
```

### 502 — falha ao gravar no MedX

```json
{ "success": false, "erro": "Falha ao confirmar no MedX" }
```

## Observações

- **Idempotente:** clicar "Confirmar" mais de uma vez não gera efeito duplicado.
- **Janela de 15 dias:** se o agendamento for além de hoje+15 dias, a resposta é **404**.
  A janela acompanha `JANELA_CONFIRMACAO_DIAS` (mesma configuração do envio 15 dias).
- **Múltiplos agendamentos:** se o mesmo telefone tiver mais de um na janela, somente o
  **mais próximo** é confirmado. Se o paciente recebeu a mensagem de 15 dias mas tem
  outra consulta antes, o clique confirma a consulta **mais próxima**.
- **Agendamento que já passou:** horários anteriores ao momento da chamada são ignorados.
