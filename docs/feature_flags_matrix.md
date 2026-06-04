# Feature Flags Matrix - IntegraGLPI V7

Phase: `integaglpi_v8_final_governance_lgpd_readiness_and_release_gate_001`
Updated: 2026-06-04

## Rule

Feature flags são controles operacionais. Alterar flag em TESTE, HOMOLOGAÇÃO ou PRODUÇÃO exige gate humano, registro da decisão e smoke direcionado. Este documento não autoriza alteração de `.env`.

## Critical Flags

| Flag | Default seguro | Domínio | Risco se ativada sem gate | Gate mínimo |
| --- | --- | --- | --- | --- |
| `OUTBOUND_SEND_MODE` | `mock` | WhatsApp outbound | Envio real ao cliente | Dono operacional + smoke Meta em TESTE + Cursor review |
| `LOGMEIN_INTEGRATION_ENABLED` | `false` | LogMeIn cache read-only | Chamada externa e cache local desatualizado/incompleto | Infra + Segurança + smoke read-only |
| `LOGMEIN_RECONCILIATION_ENABLED` | `false` | LogMeIn relatório remoto | Chamada externa de relatório e fila local | Infra + Segurança + revisão de HTTP/provider |
| `AI_SUPERVISOR_ENABLED` | `false` | IA supervisora local | Análises automáticas internas | Supervisor + dry-run validado |
| `AI_SUPERVISOR_DRY_RUN` | `true` | IA supervisora local | Provider local real executando análise | Supervisor + teste Ollama/local |
| `AI_SUPERVISOR_PROVIDER` | `disabled` | IA supervisora local | Provider inesperado | Admin + configuração central |
| `AI_ONLINE_ALERT_WORKER_LOOP` | `false` | Worker IA interno | Loop periódico sem acompanhamento | Supervisor + janela TESTE |
| `AI_ONLINE_ALERT_WORKER_INTERVAL_SECONDS` | `60` | Worker IA interno | Carga excessiva se muito baixo | Supervisor + infra |
| `AI_PILOT_CLOUD_ENABLED` | `false` | Cloud pilot | Exposição externa de contexto | DPO + direção + admin + incidentAck |
| `AI_PILOT_EMBEDDINGS_ENABLED` | `false` | Cloud/embeddings | Envio externo de dados | DPO + direção + admin |
| `AI_PILOT_PROVIDER` | `disabled` | Cloud pilot | Provider externo ativo | DPO + direção + admin |
| `AI_PILOT_HARD_BUDGET_BLOCK` | `true` | Cloud pilot | Custo sem bloqueio | Direção + admin |
| `AI_PILOT_DPO_APPROVED` | `false` | Cloud pilot | Uso sem base LGPD | DPO |
| `AI_PILOT_DIRECTOR_APPROVED` | `false` | Cloud pilot | Uso sem autorização executiva | Direção |
| `AI_PILOT_ADMIN_OPT_IN` | `false` | Cloud pilot | Uso sem opt-in técnico | Admin |
| `AI_PILOT_INCIDENT_ACK` | `false` | Cloud pilot | Falta de ciência de incidente/custo | Admin + Segurança |
| `AI_PILOT_TEST_ENVIRONMENT_ONLY` | `true` | Cloud pilot | Cloud em produção sem gate | DPO + direção + Cursor |
| `EXTERNAL_RESEARCH_CLOUD_ENABLED` | `false` | Pesquisa externa | Chamada cloud com PII se guard falhar | DPO + allowlist + PII Guard |
| `GLPI_KB_SEARCH_URL` | vazio | KB local via PHP | Node tenta buscar KB sem endpoint preparado | Admin + Bearer + smoke local |
| `GLPI_KB_SEARCH_TIMEOUT_MS` | limitado | KB local via PHP | Timeout ruim no painel | Admin + smoke |

## LogMeIn Flags

| Flag | Default seguro | Observação |
| --- | --- | --- |
| `LOGMEIN_API_BASE_URL` | vazio/canônico interno por código | Nunca colocar URL com path de ação. Código força paths allowlisted. |
| `LOGMEIN_COMPANY_ID` | secret externo | Não logar, não documentar valor. |
| `LOGMEIN_PSK` | secret externo | Não logar, não documentar valor. |
| `LOGMEIN_TIMEOUT_MS` / `LOGMEIN_HTTP_TIMEOUT_MS` | limitado por código | Evita bloqueio longo do serviço. |
| `LOGMEIN_SYNC_LOCK_TTL_MS` | limitado por código | Evita sync concorrente. |
| `LOGMEIN_RECONCILIATION_LOCK_TTL_MS` | limitado por código | Evita conciliação concorrente. |
| `LOGMEIN_RECONCILIATION_LOOKBACK_DAYS` / `HOURS` | limitado por código | Janela deve ser pequena em TESTE. |
| `LOGMEIN_RECONCILIATION_CHUNK_MINUTES` / `OVERLAP_MINUTES` | limitado por código | Controla volume do relatório. |
| `LOGMEIN_RECONCILIATION_MAX_RETRIES` | limitado por código | Proibido retry loop infinito. |
| `LOGMEIN_RECONCILIATION_CIRCUIT_COOLDOWN_SECONDS` | limitado por código | Protege provider após HTTP 5xx. |

## Operational Gates

| Ambiente | Regra |
| --- | --- |
| TESTE | Pode habilitar flag controlada somente com smoke documentado e sem cliente real quando aplicável. |
| HOMOLOGAÇÃO | Pode habilitar flag após Cursor review e aprovação humana da área dona. |
| PRODUÇÃO | Alteração exige release window, rollback, smoke pós-deploy e aprovação explícita. |

## Forbidden Shortcuts

- Nunca habilitar cloud sem DPO + direção + admin + incidentAck.
- Nunca trocar `OUTBOUND_SEND_MODE` para `real` em TESTE.
- Nunca habilitar LogMeIn como requisito para criar ou responder ticket.
- Nunca usar feature flag para contornar CSRF/RBAC/Bearer/entity scope.
- Nunca registrar segredo ou token no valor auditado.

## V8 — Exibição read-only na Saúde Técnica

A tela **Saúde Técnica** (`front/technical.health.php`) exibe, somente leitura, as flags críticas e
o ambiente. Regras de exibição:

- Valores autoritativos: `ENVIRONMENT` (URL base do GLPI), `AI_SUPERVISOR_ENABLED` (config do plugin),
  `INTEGRATION_SERVICE_HOST` (host apenas), `META_WEBHOOK_CONFIGURED` (booleano do diagnóstico Node).
- Flags Node ainda não expostas pelo endpoint de diagnóstico — `OUTBOUND_SEND_MODE`,
  `EXTERNAL_RESEARCH_CLOUD_ENABLED`, `LOGMEIN_INTEGRATION_ENABLED`, `GLPI_KB_SEARCH_URL` — aparecem
  como **"não exposto pelo diagnóstico"**; nunca são adivinhadas/fabricadas.
- URLs são reduzidas a `scheme://host(:porta)`; nenhuma URL completa, token, PSK ou senha é exibida.
- A tela **não altera** flag, `.env`, Docker ou produção. Alteração de flag permanece manual e com gate.
- Migrations 044/045: status por verificação de arquivo (sem acesso ao banco), apenas informativo.

## V8 Final — Produto Operacional Controlado

| Flag | Ambiente | Default seguro | Owner da decisão | Risco se ativada | Gate necessário |
| --- | --- | --- | --- | --- | --- |
| `OUTBOUND_SEND_MODE` | Todos | `mock` fora de produção controlada | Dono operacional WhatsApp | Envio real indevido | Smoke Meta + janela + aprovação humana |
| `AI_SUPERVISOR_ENABLED` | Todos | `false` | Supervisão | Análise automática inesperada | Dry-run local + Cursor review |
| `AI_SUPERVISOR_DRY_RUN` | Todos | `true` | Supervisão | Sugestão interpretada como ação | Evidência de read-only |
| `AI_PILOT_CLOUD_ENABLED` | Todos | `false` | DPO + direção + admin | Contexto externo sem base legal | DPO, direção, admin, incidentAck |
| `AI_PILOT_EMBEDDINGS_ENABLED` | Todos | `false` | DPO + direção | Envio externo de dados | PII Guard + smoke sintético |
| `EXTERNAL_RESEARCH_CLOUD_ENABLED` | Todos | `false` | DPO/LGPD | Cloud com PII se guard falhar | Consentimento humano + PII Guard + audit |
| `GLPI_KB_SEARCH_URL` | TESTE/HOMOLOGAÇÃO | vazio até endpoint validado | Admin plugin | Busca local quebrada ou lenta | Bearer interno + smoke local |
| `LOGMEIN_INTEGRATION_ENABLED` | Todos | `false` | Infra + segurança | Dependência externa indevida | Smoke read-only sem cliente real |
| `LOGMEIN_RECONCILIATION_ENABLED` | Todos | `false` | Infra + segurança | Chamada de relatório/provider instável | Circuit breaker + smoke manual |
| `META_WEBHOOK_CONFIGURED` | Diagnóstico | informativo | Meta owner | Diagnóstico incompleto | Read-only; não altera configuração |

Defaults seguros significam: cloud OFF, LogMeIn OFF, IA assistiva sem mutação, KB sem autopublicação, produção com gate humano.

## V8 — SmartHelp cloud-safe rewrite (`SMARTHELP_CLOUD_RESIDUAL_MODE`)

| Flag | Default seguro | Domínio | Efeito |
| --- | --- | --- | --- |
| `SMARTHELP_CLOUD_RESIDUAL_MODE` | `0` (OFF) | Ajuda externa/nuvem | OFF: política estrita `block-on-detected` (qualquer PII detectada bloqueia — comportamento atual preservado). ON: `block-on-residual` somente sobre o texto reescrito cloud-safe (placeholders não bloqueiam; PII residual real bloqueia). |

Regras:
- A nuvem usa SOMENTE o resumo técnico editável, reescrito em contexto genérico (`rewriteCloudSafe`); nunca `ticket.content`/histórico bruto.
- Reescrita determinística (sanitização dupla + cap de 600 chars); IA local opcional, nunca filtro único.
- Provider recebe apenas o texto cloud-safe; auditoria grava hash + tipos + status, sem texto bruto.
- Habilitar a flag exige gate humano + smoke em homologação; nunca alterar `.env` por automação.

## Final V8 Feature Flag Matrix

| Domain | Flag / control | TESTE default | HOMOLOGACAO default | PRODUCAO default | Owner | Human gate |
| --- | --- | --- | --- | --- | --- | --- |
| WhatsApp | `OUTBOUND_SEND_MODE` | `mock` | controlled | production-approved only | Operations WhatsApp | Required before real send |
| WhatsApp | Meta webhook configuration | test phone only | homologation phone only | production phone only | Meta owner | Required per environment |
| SmartHelp | Guided workflow buttons | enabled manually | enabled manually | enabled manually if smoke passed | Support lead | Required for production enablement |
| IA local | Ollama/local provider | optional/manual | optional/manual | optional/manual | AI owner | Required if provider changes |
| Cloud | `EXTERNAL_RESEARCH_CLOUD_ENABLED` | `false` | `false` until DPO smoke | `false` until signed GO | DPO + direction + admin | Required |
| Cloud | PII Guard / sanitized preview | required | required | required | Security/DPO | Cannot be disabled |
| KB | Feedback and candidates | local/reviewed | local/reviewed | local/reviewed | KB owner | Required for publish |
| KB | Autopublish | forbidden | forbidden | forbidden | KB owner | Not allowed in V8 |
| LogMeIn | `LOGMEIN_INTEGRATION_ENABLED` | `false` | `false` unless read-only smoke | `false` unless explicit GO | Infra/security | Required |
| LogMeIn | `LOGMEIN_RECONCILIATION_ENABLED` | `false` | `false` unless provider stable | `false` unless explicit GO | Infra/security | Required |
| Observability | Technical Health | read-only | read-only | read-only | Operations | No mutation allowed |
| Production | Production promotion | blocked | blocked | manual only | Release owner | Signed go/no-go |

Safe default rule: if owner or gate evidence is missing, keep the flag OFF or read-only.
