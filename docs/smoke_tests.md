# Smoke Tests IntegraGLPI IA V4.1

Uso: executar manualmente em TESTE/HOMOLOGACAO. Este roteiro nao chama IA automaticamente, nao envia WhatsApp automatico e nao altera producao.

Preflight:
- `git status --short`
- `git diff --check`
- `cd integration-service && npx tsc --noEmit`
- `cd integration-service && npm test`
- `php -l` nos PHP alterados

Smoke seguro:
1. Abrir GLPI e confirmar menu do plugin.
2. Abrir KB nativa read-only e buscar artigo visivel.
3. Abrir ticket de teste e validar aba WhatsApp.
4. Executar P1 manual somente com provider permitido e dry-run quando aplicavel.
5. Abrir P4 dashboard e confirmar empty state/cards.
6. Abrir P8 coaching e confirmar aviso anti-punitivo.
7. Abrir P9 pesquisa externa, gerar preview, confirmar que sem preview retorna `EXTERNAL_RESEARCH_PREVIEW_REQUIRED`.
8. Confirmar que P7 cloud/embeddings permanece bloqueado por default.

Ollama:
- Health de Ollama e opcional.
- Se `SMOKE_TEST_SKIP_OLLAMA=true`, o smoke deve seguir sem falhar por IA local ausente.
- Health nao deve gerar resposta de IA nem chamar cloud.

Worker IA Observadora Online em TESTE/HOMOLOGACAO:
- Subir pelo compose de teste: `docker compose -f docker-compose.dev.yml up -d integaglpi-ai-online-alert-worker`.
- Confirmar logs com `[integration-service][ai_online_alerts][loop_started]` e `[integration-service][ai_online_alerts][loop_tick]`.
- Confirmar que `AI_ONLINE_ALERT_WORKER_INTERVAL_SECONDS=60` esta aplicado no servico de teste.
- Para Copiloto, usar `COPILOT_DRAFT_MODEL` e `COPILOT_TIMEOUT_SECONDS` quando precisar de modelo/timeout menor que `AI_SUPERVISOR_MODEL`.
- Para Alertas Online, usar `AI_ONLINE_ALERT_MODEL` e `AI_ONLINE_ALERT_TIMEOUT_SECONDS` quando precisar de modelo/timeout proprio.
- Se as variaveis especificas nao existirem, o fallback seguro continua sendo `AI_SUPERVISOR_MODEL` e `AI_SUPERVISOR_TIMEOUT_SECONDS`.
- Gerar mensagem de teste com termo forte, por exemplo "supervisor" ou "procon", e validar alerta interno no Monitor Online em ate 1-2 minutos.
- Confirmar que o alerta e interno/read-only, sem envio de WhatsApp, sem alteracao de ticket e sem escrita de KB.

Abortar se:
- Qualquer WhatsApp/template for enviado automaticamente.
- Qualquer ticket/status/prioridade for alterado pela IA.
- Qualquer escrita na KB nativa ocorrer automaticamente.
- Logs exibirem PII, segredo ou prompt bruto.
