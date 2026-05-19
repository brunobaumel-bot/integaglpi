# Smoke Produção Curto

Fase: `integaglpi_post_production_baseline_001`

Objetivo: validar produção após promoção manual, sem alterar regras funcionais e sem acionar IA.

## Pré-condições

- Janela de rollback aberta.
- Operador autorizado presente.
- Backup confirmado.
- Webhook Guard ativo.
- IA OFF em produção.

## Smoke Manual

- [ ] Health/readiness do Node responde.
- [ ] Diagnóstico do plugin não mostra segredo.
- [ ] Inbound WhatsApp chega e cria/atualiza conversa.
- [ ] Outbound WhatsApp manual funciona em conversa com ticket.
- [ ] Criação de ticket GLPI funciona quando aplicável.
- [ ] Follow-up GLPI é criado em conversa existente.
- [ ] Mídia/anexo seguro é recebido e vinculado.
- [ ] Delivery mostra `sent`, `delivered`, `read` ou `failed` sanitizado.
- [ ] Reabertura com motivo funciona.
- [ ] CSAT funciona após aprovação.
- [ ] Console/Central carrega e respeita perfil.
- [ ] Encerramento administrativo aparece apenas para conversa presa elegível sem ticket e exige motivo.
- [ ] Dashboard carrega para perfil autorizado.
- [ ] Inatividade/autoclose base aparece em diagnóstico quando aplicável.
- [ ] IA Supervisora permanece read-only e OFF para produção.

## Evidência Esperada

- Horário do teste.
- Usuário operador.
- Ambiente.
- Ticket/conversa de teste autorizados.
- Correlation_id, quando disponível.
- Resultado de cada item.

## Critérios de Abort

- Segredo aparece em UI/log.
- Webhook Guard falha.
- Inbound ou outbound falha.
- Ticket/follow-up GLPI falha.
- Delivery não registra status.
- IA aparece ativa.
- Console/Central indisponível.
- Encerramento administrativo permite conversa com ticket, sem motivo ou atividade recente.
- Reabertura/CSAT quebra fluxo já estável.

## Segurança Documental

Nunca versionar, copiar ou colar em documentação: .env real, .ovpn, tokens, Bearer tokens, PSK, Phone Number ID real, senhas, dumps SQL, backups reais, payloads brutos sensíveis ou dados pessoais desnecessários.
