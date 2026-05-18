# Fase 8.5 — IA Supervisora de Qualidade

Status: implementada em desenvolvimento/TESTE, sem deploy automático.

## Escopo

- IA supervisora read-only, acionada manualmente por supervisor.
- Provider MVP: Ollama local.
- Cloud fora do MVP.
- Feature flag `AI_SUPERVISOR_ENABLED=false` por padrão.
- Dry-run configurável para testes.
- Saída estruturada e validada como JSON `ai_quality_v1`.
- Integração no Contexto WhatsApp e no Backoffice Supervisor.
- Feedback simples do supervisor: útil, pouco útil ou incorreta.

## Guardrails

- A IA não envia WhatsApp.
- A IA não altera ticket, status, solução, CSAT, contratos ou horas.
- A IA não roda automaticamente após fechamento.
- O prompt usa somente mensagens textuais minimizadas.
- Telefone, e-mail, nomes e dados sensíveis são mascarados antes do envio ao modelo.
- Prompt completo, payload Meta bruto, anexos, mídia, base64, tokens e URLs assinadas não são armazenados.

## Modelo de Dados

Migration:

- `integration-service/schema-migrations/017_ai_quality_analyses.sql`

Tabela:

- `glpi_plugin_integaglpi_ai_quality_analyses`

Campos principais:

- `conversation_id`
- `glpi_ticket_id`
- `analysis_version`
- `provider`
- `model`
- `status`
- `classification_resolution`
- `sentiment`
- `flags`
- `summary`
- `recommendation`
- `result_json`
- `supervisor_feedback`
- `feedback_notes`
- `created_by`
- `created_at`
- `updated_at`

## Configuração

Variáveis sem segredo:

- `AI_SUPERVISOR_ENABLED=false`
- `AI_SUPERVISOR_PROVIDER=ollama`
- `AI_SUPERVISOR_MODEL=llama3.1`
- `AI_SUPERVISOR_BASE_URL=http://127.0.0.1:11434`
- `AI_SUPERVISOR_TIMEOUT_SECONDS=30`
- `AI_SUPERVISOR_MAX_MESSAGES=30`
- `AI_SUPERVISOR_MAX_CHARS=12000`
- `AI_SUPERVISOR_DRY_RUN=true`

Configuração PHP/GLPI:

- O botão no plugin usa `AI_SUPERVISOR_ENABLED` lido pelo PHP.
- Ordem de leitura no PHP: `getenv()`, constante PHP, `$CFG_GLPI['plugin_integaglpi']`, `$CFG_GLPI['integaglpi']`, `$PLUGIN_INTEGAGLPI_CONFIG` e, por fim, o campo persistido `ai_supervisor_enabled` na configuração do próprio plugin.
- A tela de configuração do plugin possui o checkbox `Habilitar IA Supervisora no GLPI`; o padrão seguro permanece desligado (`0`).
- A chave interna usa preferencialmente o campo seguro `integration_auth_key` da configuração do plugin.
- Como fallback operacional, `INTEGRATION_SERVICE_API_KEY` pode ser exposto ao PHP pela mesma ordem acima.
- Nunca registrar o valor real de `INTEGRATION_SERVICE_API_KEY` em documento, tela ou log.

## Smoke Manual

1. Aplicar migration 017 em TESTE.
2. Reiniciar `integration-service` TESTE.
3. Manter `AI_SUPERVISOR_ENABLED=false` e confirmar que botões IA não aparecem.
4. Ativar `AI_SUPERVISOR_ENABLED=true` e `AI_SUPERVISOR_DRY_RUN=true`.
5. Abrir ticket com conversa WhatsApp e acionar `Analisar conversa`.
6. Confirmar análise gravada no Contexto WhatsApp.
7. Confirmar coluna IA no Backoffice Supervisor.
8. Salvar feedback do supervisor.
9. Confirmar que nenhum WhatsApp foi enviado e nenhum ticket/status/contrato foi alterado.
10. Testar Ollama indisponível com dry-run desligado e confirmar status `failed` amigável.

## Limitações do MVP

- Sem provider cloud.
- Sem execução automática.
- Sem análise de mídia/anexos.
- Sem decisão automática; supervisor humano mantém a decisão final.
