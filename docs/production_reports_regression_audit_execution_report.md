# Relatório de Execução — Auditoria Pós-Fix em Homologação

Phase: `integaglpi_v8_post_fix_full_homologation_audit_002`
Executado em: 2026-06-04 (UTC-3) por auditoria operacional read-only via SSH.
Fix sob avaliação: commit `601461c` ("fix(integaglpi): address homologation regression failures").

> Este documento é apenas relatório de auditoria. Não altera runtime, não corrige código,
> não toca produção, não faz deploy/commit. Toda evidência foi coletada read-only.

---

## 1. Veredito

**VERDICT: NO_GO** (bloqueio de validação, não falha de fix).

O fix `601461c` está **corretamente implantado** em homologação e **nenhuma regressão pós-fix foi
observada**, porém a missão central — "validar com eventos novos, não resíduos históricos" — **não
pôde ser cumprida** porque:

1. Não há tráfego pós-cutoff em homologação (último evento `2026-06-04 12:58:18Z`, anterior ao
   restart pós-fix `14:13:48Z`).
2. Os insumos obrigatórios não foram fornecidos: `TEST_WHATSAPP_NUMBER`, `TEST_ENTITY_ID`,
   `TEST_QUEUE_ID`, `TEST_TECHNICIAN_A/B`, sessão/credencial de UI GLPI.
3. `OUTBOUND_SEND_MODE=real` em HML: gerar evento sintético poderia disparar WhatsApp **real**.
4. Webhook guard ativo (assinatura Meta) impede injeção de inbound sintético sem segredo.

As STOP_CONDITIONS da própria fase ("test number não confirmado", "UI autenticada não disponível")
exigem `NO_GO`. **Não é um NO_GO por falha do fix** — é um NO_GO por impossibilidade de prova em
runtime sob as condições/insumos atuais.

---

## 2. Ambiente validado (read-only)

| Item | Resultado | Evidência |
|---|---|---|
| Host SSH | `GLPIv5` / `azureuser` | `hostname && whoami` |
| Produção isolada | Sim | containers `prod-*` (3002/5433) ignorados; nenhum comando os tocou |
| integration-service | OK | `/health` ok:true, uptime estável, restarts=0 |
| PostgreSQL HML | OK | `current_database=glpi_integaglpi`, latência 1ms |
| Redis HML | OK | `PONG`, `DBSIZE=0`, 0 locks/dead/queue |
| Worker inatividade | OK (idle) | `[inactivity][JOB_STARTED]` interval=60s, ciclos `no_eligible_candidates` |
| Migrations | Aplicadas no boot | logs `Applied schema migration file` (automático no container) |
| Cutoff pós-fix | `2026-06-04T14:13:48Z` | `docker inspect StartedAt` do container de integração |

**Confirmação de deploy do fix (marcadores no `dist` em execução):**
- T10 → `classifyAutocloseFailureReason`, `glpi_permission_denied` em `InactivityAutomationService.js`.
- T13 → `UNSUPPORTED_MEDIA_TYPE`, `glpi_permission_denied` em `MediaProcessingService.js`.
- T01 → `glpiEntityName` em `InboundWebhookService.js`.

---

## 3. Foco pós-fix (T01 / T10 / T13)

### T01 — Entidade preservada
- **Legacy (pré-cutoff):** 180 tickets; **117 sem entidade válida** (65%), 63 com entidade nomeada.
  Confirma que o bug era real antes do fix.
- **Pós-cutoff:** 0 conversas criadas → **sem evento novo para provar a correção**.
- Código implantado agora propaga `glpiEntityId`/`glpiEntityName` na criação de conversa a partir
  da entidade lembrada (`InboundWebhookService` linhas ~1891 e ~2058 do commit).
- **Status: INCONCLUSIVE** (deploy correto, sem evento novo).

### T10 — Inatividade não envia WhatsApp se GLPI falha
- **Legacy:** 25 `failed` + múltiplos `skip_reason='GLPI request failed for /Ticket/...'`, 2 `autoclose_done`.
- **Pós-cutoff:** 0 linhas `failed`/`permission`/autoclose; worker roda mas `checked_count=0`.
- Código implantado agora: resolve o ticket no GLPI **antes** de qualquer envio; em falha, classifica
  `glpi_permission_denied` (403) ou `autoclose_failed` e **não envia WhatsApp**.
- **post_cutoff_403_count = 0**, **post_cutoff_failed_count = 0**, **whatsapp_sent_after_glpi_fail = não observado**.
- **Status: INCONCLUSIVE** (deploy correto, sem ciclo de inatividade novo).

### T13 — Mídia/anexo tipados
- **Legacy:** `document/error=3`, `audio/uploaded_unlinked=2`, `image/error=1`, `document/blocked=skipped` etc.
- **Pós-cutoff:** 0 mensagens de mídia; `error_type` pós-cutoff vazio.
- Código implantado agora tipa `unsupported_media_type`, `attachment_blocked`,
  `glpi_permission_denied` e `error_code=UNSUPPORTED_MEDIA_TYPE`.
- **post_cutoff_media_error_count = 0**, **post_cutoff_uploaded_unlinked_count = 0**.
- **Status: INCONCLUSIVE** (deploy correto, sem mídia nova).

---

## 4. Matriz regressiva T01–T23

| Teste | Status | Base da avaliação |
|---|---|---|
| T01 Entidade | INCONCLUSIVE | Fix implantado; sem criação pós-cutoff |
| T02 Protocolo→ticket GLPI | INCONCLUSIVE | Sem abertura nova; exige API/UI autenticada |
| T03 Chamados travados | INCONCLUSIVE | Exige UI Central + dados ativos |
| T04 Categoria/tempo editáveis | INCONCLUSIVE | Exige UI GLPI autenticada |
| T05 Salvar/403 | INCONCLUSIVE | Sem UI; logs pós-cutoff sem 403 de plugin |
| T06 Técnico exibido | INCONCLUSIVE | Exige UI + claim sintético |
| T07 Transferência | INCONCLUSIVE | Exige UI + 2 técnicos de teste |
| T08 Notificação atribuição | INCONCLUSIVE | Exige claim sintético (outbound real = risco) |
| T09 Telefone mascarado | INCONCLUSIVE | Exige UI Central/ticket |
| T10 Inatividade | INCONCLUSIVE | Fix implantado; sem ciclo novo |
| T11 Reabertura | INCONCLUSIVE | Exige UI + ticket resolvido sintético |
| T12 Histórico ao responder | INCONCLUSIVE | Exige UI + conversa com timeline |
| T13 Mídia | INCONCLUSIVE | Fix implantado; sem mídia nova |
| T14 Foto na abertura | INCONCLUSIVE | Exige número de teste + inbound real |
| T15 Abas Conversas vs Chamados | INCONCLUSIVE | Exige UI |
| T16 Automação invasiva | INCONCLUSIVE→tendência PASS | Sem outbound automático nos logs pós-cutoff; garantias estáticas mantidas |
| T17 Nome remetente | INCONCLUSIVE | Exige UI + contato |
| T18 Bot health | PASS (parcial) | `/health` ok, FSM/worker ativos, restarts=0, sem erro pós-cutoff |
| T19 Abertura manual e-mail/telefone | INCONCLUSIVE | Exige UI GLPI |
| T20 Locks/dead-letter | PASS | Redis 0 locks/0 dead; tabela `dead_letter`=0; `DBSIZE=0` |
| T21 Sessão/CSRF | INCONCLUSIVE | Exige UI; logs sem CSRF inválido pós-cutoff |
| T22 SmartHelp guiado | INCONCLUSIVE | Exige UI; ver risco do container AI ausente |
| T23 Menus/drilldowns | INCONCLUSIVE | Exige UI GLPI por perfil |

Resumo: **PASS=2 (T18, T20)**, **PASS parcial/tendência=1 (T16)**, **INCONCLUSIVE=20**, FAIL=0, NOT_APPLICABLE=0.
Nenhum FAIL pós-cutoff — porém ausência de FAIL aqui reflete ausência de tráfego, não prova de correção.

---

## 5. Análise sênior — saúde geral e melhorias

### Achados de configuração/risco (não bloqueiam, mas exigem atenção)
1. **`OUTBOUND_SEND_MODE=real` em homologação** — alto risco operacional: qualquer fluxo que
   dispare outbound envia WhatsApp real. Recomenda-se `mock`/número de teste dedicado em HML, salvo
   janela de teste E2E controlada com número autorizado.
2. **`glpi-integaglpi-ai` definido no compose mas inexistente** (`No such object`). Funções de IA
   (resumo SmartHelp, copiloto) dependem do provider local; se o Ollama esperado vive nesse serviço,
   T22 e o resumo local podem cair em `provider_unavailable`. Validar onde o Ollama está servindo.
3. **`LOGMEIN_INTEGRATION_ENABLED=true` em HML** — diverge do default seguro de governança (OFF).
   Confirmar se é intencional para teste read-only; manter OFF se não houver smoke ativo.
4. **Redis sem limite de memória** (`maxmemory=0`, `noeviction`). Definir `maxmemory` + política de
   eviction adequada para evitar OOM em pico.
5. **Migrations aplicadas automaticamente no boot do container** em HML. Aceitável em homologação,
   mas confirmar que produção exige gate manual (não aplicar no boot).
6. **`NODE_ENV=development`** no integration HML — esperado em homologação; garantir que produção
   roda `production`.

### Pontos positivos
- Higiene de logs do fix: `GlpiClient` deixou de logar o corpo completo do PUT (`glpiTicketUpdateBody`),
  passando a logar apenas `status`/`hasExtraInput` — reduz exposição de payload. Bom para LGPD.
- Worker de inatividade resiliente e idempotente (ciclo 60s, sem candidatos → `CHECKED` limpo).
- Sem dead-letter, sem locks presos, sem reinícios de container.
- `/health` expõe readiness e webhook guard (`app_signature_configured`, `allowlist_configured`).

### Recomendação para fechar a auditoria (flip NO_GO → GO_READY)
Fornecer e executar um **smoke E2E controlado em HML** com:
- número WhatsApp de teste dedicado (`TEST_WHATSAPP_NUMBER`);
- `TEST_ENTITY_ID`, `TEST_QUEUE_ID`, `TEST_TECHNICIAN_A/B`;
- sessão de UI GLPI autenticada (perfis admin/supervisor/técnico);
- preferível `OUTBOUND_SEND_MODE=mock` ou janela autorizada para o número de teste.

Com isso: criar conversa AUDIT-* → confirmar `glpi_entity_id>0`/`glpi_entity_name` (T01);
forçar ciclo de inatividade com GLPI indisponível e confirmar ausência de WhatsApp (T10);
enviar mídia suportada e não-suportada e confirmar Document_Item / `unsupported_media_type` (T13);
e percorrer os 12 testes de UI.

---

## 6. Segurança da execução

- Produção não tocada (containers `prod-*` apenas listados, nunca acessados).
- Nenhum SQL destrutivo; apenas `SELECT`/`information_schema`/`INFO`/`SCAN`/`DBSIZE`.
- Nenhuma mensagem enviada a cliente real.
- Nenhuma alteração de runtime/código/`.env`/migration/deploy/commit pela auditoria.
- Segredos não impressos; `env` filtrado com redaction.
- Node não acessou MariaDB GLPI (apenas PostgreSQL de integração + API quando aplicável).
