# Homologacao 8.9 - Checklist E2E

Use este roteiro no ambiente real com GLPI, Postgres, Redis, integration-service
e WhatsApp Cloud API ativos.

## 0. Pre-requisitos GLPI API

- O `GLPI_USER_TOKEN` usado pelo `integration-service` deve pertencer a um
  usuario GLPI ativo.
- Esse usuario deve ter perfil com permissao para atualizar Ticket na entidade
  dos tickets criados pelo WhatsApp, com acesso recursivo quando houver
  subentidades.
- Para o fluxo `Aprovar`, o usuario API tambem deve conseguir criar follow-up
  de aceite de solucao e fechar chamado solucionado no GLPI 11. A UI do GLPI 11
  aprova a solucao pelo fluxo de `ITILFollowup` com `add_close`, nao por update
  generico de `Ticket`.
- Validar antes da homologacao:

```bash
curl -k -sS \
  -H "App-Token: <GLPI_APP_TOKEN>" \
  -H "Authorization: user_token <GLPI_USER_TOKEN>" \
  "https://<glpi>/apirest.php/initSession/"

curl -k -sS -X POST \
  -H "App-Token: <GLPI_APP_TOKEN>" \
  -H "Session-Token: <SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"input":[{"items_id":<TICKET_SOLVED_ID>,"itemtype":"Ticket","content":"Cliente aprovou a solucao via WhatsApp.","add_close":1}]}' \
  "https://<glpi>/apirest.php/Ticket/<TICKET_SOLVED_ID>/ITILFollowup"
```

## 1. Triagem e fila

- Enviar `Oi` como cliente novo.
- Com 1 a 3 filas ativas: confirmar recebimento de botoes interativos.
- Clicar em um botao: confirmar criacao de ticket no grupo correto.
- Confirmar `queue_id` persistido na conversation.
- Digitar `1` em novo fluxo: confirmar fallback textual funcionando.
- Com 4 ou mais filas ativas: confirmar menu textual, sem botoes.

## 2. Midia

- Enviar PDF em conversa `open`.
- Confirmar `media_info.status = synced`.
- Confirmar `media_info.glpi_document_id` e `media_info.glpi_ticket_id`.
- Confirmar documento em `glpi_documents`.
- Confirmar vinculo em `glpi_documents_items` com `itemtype = Ticket`.
- Enviar imagem em conversa `open` e repetir verificacoes.
- Enviar audio permitido em conversa `open`, se aplicavel.
- Enviar midia em `awaiting_queue_selection`.
- Confirmar rejeicao com mensagem de midia invalida + menu.
- Confirmar que nao houve download, upload GLPI ou criacao de ticket.

## 3. Solucao: Aprovar

- Tecnico soluciona chamado no GLPI.
- Cliente recebe botoes `Aprovar` e `Reabrir`.
- Cliente clica `Aprovar`.
- Confirmar ticket em `CLOSED`.
- Confirmar row em `solution_actions` com `action = approve` e `status = success`.
- Confirmar conversation/runtime `closed`.
- Confirmar exatamente uma mensagem de fechamento ao cliente.
- Confirmar que a mensagem de fechamento veio pelo fluxo PHP `notifyTicketClosed`.

## 4. Solucao: Reabrir

- Tecnico soluciona outro chamado no GLPI.
- Cliente recebe botoes `Aprovar` e `Reabrir`.
- Cliente clica `Reabrir`.
- Confirmar ticket em `PROCESSING/ASSIGNED`.
- Confirmar row em `solution_actions` com `action = reopen` e `status = success`.
- Confirmar conversation/runtime `open`.
- Confirmar mensagem do Node: `Atendimento reaberto. Um tecnico analisara sua solicitacao.`
- Confirmar que o PHP nao enviou segunda mensagem de reabertura.

## 5. Fluxos manuais

- Fechamento manual pelo tecnico: cliente recebe notificacao normal de fechamento.
- Solucao manual pelo tecnico: cliente recebe botoes `Aprovar` e `Reabrir`.
- Follow-up publico manual: cliente recebe notificacao.
- Follow-up privado: cliente nao recebe notificacao.
- Follow-up criado por inbound WhatsApp: cliente nao recebe eco da propria mensagem.

## 6. Seguranca e sessao

- POST interno sem auth key deve retornar 401.
- Webhook Meta com assinatura invalida deve retornar 401.
- `.env` real nao deve aparecer no pacote/versionamento.
- Logs nao devem mostrar tokens, senhas, auth key ou payload sensivel completo.

## Resultado

Preencher no servidor:

```text
Data:
Ambiente:
Responsavel:
Triagem/fila:
Midia:
Aprovar:
Reabrir:
Fluxos manuais:
Seguranca:
Bloqueadores:
Veredito:
```
