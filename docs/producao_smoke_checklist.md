# Smoke Producao

Executar após promoção manual e com janela de rollback aberta.

## Diagnóstico

- Abrir Diagnóstico Operacional.
- Confirmar `build_id`/`package_id`.
- Confirmar sem `runtime_mismatch`.
- Confirmar sem segredos exibidos.
- Confirmar OPcache/cache reiniciado.
- Confirmar Webhook Guard ativo.
- Confirmar IA de producao desligada para cliente.

## Fluxos críticos

- Inbound WhatsApp registrado.
- Outbound manual dentro da janela 24h.
- Criação de ticket com entidade.
- Memória de entidade.
- Mídia/anexo recebido.
- Delivery `sent/delivered/read/failed`.
- Reabertura com motivo.
- CSAT após aprovação.
- Inatividade/reminder visível.
- Contratos/Horas carrega e salva com permissão.
- Dashboard operacional abre para perfil autorizado.
- IA Supervisora read-only; IA Copiloto desligada.

## Smoke Detalhado

- Criar conversa nova por inbound.
- Confirmar janela WhatsApp 24h aberta.
- Selecionar fila.
- Coletar perfil.
- Confirmar entidade/memoria.
- Criar ticket GLPI.
- Enviar resposta manual somente com `glpi_ticket_id`.
- Receber midia e confirmar anexo.
- Confirmar delivery `sent/delivered/read` ou falha sanitizada.
- Solucionar ticket.
- Aprovar solucao e enviar CSAT.
- Reabrir com motivo e confirmar follow-up.
- Ver Contratos/Horas como perfil autorizado.
- Ver Console 2.0 paginado.
- Ver Dashboard de Qualidade.
- Confirmar inatividade/reminder em diagnostico.

## Segurança

- Técnico restrito não vê entidade fora do escopo.
- Perfil sem permissão não altera configurações.
- Plugin não mostra tokens/senhas.
- Nenhum comando de servidor é executado pelo plugin.
- Nenhuma ação automática fecha/reabre sem evento humano ou regra já existente.
- Texto livre fora da janela 24h não é enviado sem template.
