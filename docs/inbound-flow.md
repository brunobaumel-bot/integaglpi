# Inbound Flow - Fase 1

## Resumo

O `integration-service` recebe o webhook da Meta, valida a origem, reserva a mensagem por `message_id` com indice unico e so depois tenta sincronizar com o GLPI.

## Sequencia

1. `GET /webhook/meta` valida `hub.verify_token` e devolve o challenge.
2. `POST /webhook/meta` passa obrigatoriamente pelo middleware `X-Hub-Signature-256`.
3. O payload e validado e transformado em mensagens inbound.
4. Cada mensagem gera um registro em `glpi_plugin_whatsapp_webhook_events`.
5. A mensagem e reservada em `glpi_plugin_whatsapp_messages` usando `UNIQUE(message_id)` e `ON CONFLICT DO NOTHING`.
6. Se a reserva falhar, a entrega e tratada como duplicada e a Meta recebe `200 OK`.
7. Em caso de aceite local, o servico resolve o contato por Redis e, se necessario, por GLPI.
8. Se houver conversa aberta, adiciona follow-up ao ticket existente.
9. Se nao houver conversa aberta, cria ticket novo e conversa vinculada.
10. Se o GLPI falhar temporariamente, o evento e a mensagem permanecem persistidos com status `pending_glpi`.

## Idempotencia forte

A garantia principal e feita por `glpi_plugin_whatsapp_messages.message_id` com indice unico.
O fluxo usa tentativa de insercao segura antes de qualquer chamada ao GLPI, evitando corrida de concorrencia sem depender de lock pessimista.

## Cache de contatos

As chaves Redis seguem o padrao:

- `glpi_plugin_whatsapp:contact:phone:<phone_e164>`

O payload em cache preserva a identidade local e os IDs conhecidos do GLPI.
