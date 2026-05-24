# LGPD e Resposta a Incidente IA V4.1

Gatilhos de incidente:
- PII ou segredo detectado em payload externo/cloud.
- Suspeita de envio indevido a provider externo.
- Prompt bruto persistido por erro.
- Fonte externa sem allowlist usada em pesquisa.
- Evento de auditoria sem source ou payload com dado sensivel.

Acao imediata:
1. Desabilitar provider externo e flags cloud/embedding.
2. Bloquear novas pesquisas externas ou pilotos cloud.
3. Registrar incidente com hash, provider, model e usuario, sem payload bruto.
4. Notificar DPO, direcao e responsavel tecnico.
5. Preservar evidencias sanitizadas.
6. Confirmar que nao houve WhatsApp, template, ticket mutation ou KB write.

Investigacao:
- Localizar `audit_events` por correlation id, request id ou hash.
- Validar custos e provider em `ai_pilot_usage` ou `external_research_requests`.
- Conferir se houve bloqueio por budget, PII, source ou preview.
- Nao reenviar payload automaticamente.

Retencao:
- `audit_events`: reter conforme governanca.
- `ai_pilot_usage` e `external_research` logs: manter para rastreabilidade de incidente.
- `ai_pilot_embeddings`: remover manualmente se houver suspeita de dado sensivel.
- Feedbacks e revisoes: manter sem texto bruto e com notas sanitizadas.

