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

Abortar se:
- Qualquer WhatsApp/template for enviado automaticamente.
- Qualquer ticket/status/prioridade for alterado pela IA.
- Qualquer escrita na KB nativa ocorrer automaticamente.
- Logs exibirem PII, segredo ou prompt bruto.

