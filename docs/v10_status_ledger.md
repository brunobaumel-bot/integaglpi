# V10 Status Ledger — Fonte Única de Verdade (SSOT)

PHASE: `integaglpi_v10_master_reconciliation_gap_closure_001`
Gerado: 2026-06-21 · Reconciliado contra git/código/testes (não contra relatórios externos)
Roadmap execução (SSOT): [`docs/roadmap_v10_plano_restante.md`](roadmap_v10_plano_restante.md) · Referência M0–M7/I1–I12: [`docs/roadmap_v10.md`](roadmap_v10.md)

Status final V10 HML: `V10_HML_CLOSED_WITH_RESSALVAS` — ver [`docs/v10_hml_final_closure.md`](v10_hml_final_closure.md). Produção V10 bloqueada; M8 inexistente no roadmap atual.

> **Regra de leitura:** este ledger reflete o que está **commitado/no working tree e testado**.
> Relatórios externos são `ADVISORY_ONLY` — ver seção "Reconciliação de claims".

---

## 1. Estado por fase (granular Smart Help / KB — fundação M1–M3)

| Fase | Escopo | Commit | Cursor | HML | Flags (default) | Gaps | Produção | Confiança |
|---|---|---|---|---|---|---|---|---|
| P1 Smart Help Prefill | Resumo sanitizado + prefill | `7aeb7ce` | CLOSE | PASS c/ ressalvas | `V10_SMART_HELP_*=false` | — | bloqueada | CONFIRMED |
| P2 KB Mining Rework MVP | Review MVP + contrato | docs `1eef7d0` · runtime `8950bea` | CLOSE c/ ressalvas | WEB smoke PASS c/ ressalvas | `V10_KB_MINING_*=false` | commit manual pós-review pendente | bloqueada | CONFIRMED |
| P3 KB Local Suggestions | Sugestões KB locais | `6b55bcd` | CLOSE c/ ressalvas | PASS c/ ressalvas | `V10_SMART_HELP_KB_SUGGESTIONS_ENABLED=false` | — | bloqueada | CONFIRMED |
| P4 External Research Fallback | Pesquisa externa manual | `e80a9a2` + fix `a73cd39` | CLOSE c/ ressalvas | HML validado pelo operador (smoke manual OK) | `V10_EXTERNAL_RESEARCH_*=false` | provider default HML ainda `disabled`; provider local controlado `ollama/gemma3:12b` habilitado | bloqueada | CONFIRMED_HML_WITH_RESSALVAS |
| P5 Resolution Draft | Rascunho assistido | `b614930` + fix `b614930` | FIX → fix commitado | HML validado | `V10_SMART_HELP_RESOLUTION_DRAFT_*=false` | sem produção; copy-only | bloqueada | CONFIRMED_HML |
| P6 Action Proposals | Propostas assistidas | `b614930` + fix `d6e0a23` | FIX → fix commitado | HML validado | `V10_ASSISTED_ACTION_PROPOSALS_*=false` | propostas read-only; approval required | bloqueada | CONFIRMED_HML |
| P7 Human Approval Queue | Fila aprovação efêmera | `b614930` + fix `ed09d91` | FIX → fix commitado | HML validado | `V10_HUMAN_APPROVAL_QUEUE_*=false` | estados UI-only efêmeros; sem POST mutável | bloqueada | CONFIRMED_HML |
| M4.1 Triage intent dry-run | Classificador heurístico read-only (Node) | working tree | testes locais PASS | `V10_WHATSAPP_TRIAGE_*=false` | sem webhook/FSM; M4 macro não promovível | bloqueada | CONFIRMED_LOCAL |

## 2. Estado por macro (roadmap M0–M7)

| Macro | Nome | Status real | Confiança |
|---|---|---|---|
| M0 | Reprodutibilidade HML e gate de segurança | **B1 READY** (integration-service formal deploy + re-smoke 10/10 @ `882a66a`); ressalva PHP webroot manual — ver [`v10_m0_hml_reproducibility_report.md`](v10_m0_hml_reproducibility_report.md) | CONFIRMED_HML_WITH_RESSALVAS |
| M1 | Quick Wins N1-pleno | Fundação P1–P7 validada em HML, flags default-off, produção bloqueada | CONFIRMED_HML_WITH_RESSALVAS |
| M2 | Cockpit + IA supervisora | HML_PASS_WITH_RESSALVAS — commit `370b93a`; smoke read-only c/ ressalvas | CONFIRMED_HML_WITH_RESSALVAS |
| M3 | Observabilidade/retenção | **DONE_FOR_GATE** — commit `c69387d`; observabilidade read-only validada, retenção real fora do escopo e bloqueada | CONFIRMED_HML_FOR_GATE |
| M4 | Triagem + tier-0 | **M4.1** `a37b3d3` · **M4.2** `406e56a` HML pass · **M4.3** `4324eef` COMMITTED · **M4.4** working tree `IMPLEMENTED_NOT_GATE_COUNTABLE` — [M4.1](v10_hml_m4_1_triage_intent_dry_run.md) · [M4.2](v10_hml_m4_2_kb_deflection_candidate_dry_run.md) · [M4.3](v10_hml_m4_3_synthetic_whatsapp_simulator.md) · [M4.4](v10_hml_m4_4_tier0_e2e_synthetic_controlled.md); M4 macro **NOT promotable** até M4-GATE | PARTIAL_HML_WITH_RESSALVAS |
| M5 | Shadow Mode supervisionado | **M5.1 HML_APPLIED** · **M5.2 HML_PASS_WITH_RESSALVAS @ `57f84b6` + M5-GATE data alignment** — engine metadata-only com adapter PostgreSQL; UI PHP fail-closed/read-only até ponte interna Node; GO humano; M6 nunca automática — [M5.1](v10_hml_m5_1_shadow_queue_migration.md) · [M5.2](v10_hml_m5_2_shadow_engine_ui.md); M5 macro **NOT promotable** até M5-GATE | PARTIAL_HML_WITH_RESSALVAS |
| M6 | Autonomia controlada | **M6.1 HML_PASS_WITH_RESSALVAS @ `7e5b354`** (control plane por categoria) · **M6.2 HML_PASS @ `8735d71`** — piloto restrito sandbox/simulação, guard fake-only, `[MOCK_PILOT]`, `real_execution_allowed=false`, 43 testes, deploy/smoke HML Node PASS — [M6.1](v10_hml_m6_1_control_plane_category_autonomy.md) · [M6.2](v10_hml_m6_2_restricted_category_pilot.md); produção V10 bloqueada e M7 apenas como stub registrado, sem runtime | PARTIAL_HML_WITH_RESSALVAS |
| M7 | Ações autônomas / classe de serviço | **HORIZON · STUB · NOT_PROMOTABLE** — stub type-only `ServiceClassAutonomyStub.ts`, allowlist de classes `[]`, literais `autonomy/real_execution/production/global_autonomy=false`, sem runtime/wiring (testado), 16 testes; sem produção, sem Meta/WhatsApp, sem ação externa, sem migration/schema — [M7](v10_hml_m7_autonomy_horizon_stub.md) | NOT_PROMOTABLE_BY_DESIGN |
| V10 Closure | Fechamento final HML | **V10_HML_CLOSED_WITH_RESSALVAS** — M5.2/M6.1/M6.2 HML pass with ressalvas; M7 committed horizon/stub not_promotable; produção bloqueada; sem M8 — [closure](v10_hml_final_closure.md) | CLOSED_HML_WITH_RESSALVAS |
| M5.x Shadow Replay Lab | Test tooling (prod→HML replay) | **G1_PHP_B1_HML_PASS** — G0 documental assinado; GO humano registrado; retry 002 publicou o plugin canônico PHP em HML com baseline semântico `39`, 10 diretórios dormentes movidos para backup, ownership `glpie7867:glpie7867`, smoke S01-S10 PASS; G2 outbound-null READY após reconciliação documental do hash HML; `construction_allowed=false` permanece até fase explícita de construção Shadow Replay — [design](v10_shadow_replay_lab_design_decision.md) · [G0 DPIA](v10_shadow_replay_lab_g0_dpia_pack.md) · [data contract](v10_shadow_replay_lab_data_contract.md) · [tenant/retention](v10_shadow_replay_lab_tenant_retention_policy.md) · [readiness](v10_shadow_replay_lab_readiness_matrix.md) · [G1 deploy](v10_shadow_replay_lab_g1_php_reproducible_deploy.md) · [G2 outbound-null](v10_shadow_replay_lab_g2_outbound_null_isolation.md) | PARTIAL_HML_G1_PASS_G2_READY_CONSTRUCTION_BLOCKED |

---

## 3. Integridade de commits (verificada via `git show --stat`)

| Commit | Mensagem | Conteúdo real | Observação |
|---|---|---|---|
| `7aeb7ce` | smart help sanitized prefill | P1 | OK |
| `1eef7d0` | kb mining rework contract | doc P2 | OK |
| `8950bea` | kb mining review mvp | runtime P2 | OK |
| `6b55bcd` | kb smart help local suggestions | P3 | OK |
| `e80a9a2` | manual external research fallback | P4: `.env.example`+front+js+service+template+test (450 ins) | OK — fase atômica |
| `b614930` | "sanitize kb evidence for v10 resolution draft" | **P5+P6+P7 backend** (1558 ins): `resolutionDraft`+`assistedActionProposals`+`humanApprovalDrafts`+3 gates+test P5 | ⚠ **COMMIT CONTAMINADO** — ver §4 |

### ⚠ Achado crítico: `b614930` é um commit contaminado
- Mensagem diz "Fase 5 fix" mas contém **backend completo de P5, P6 e P7** (3 métodos públicos + 3 gates).
- **Omite** `.env.example` (flags) e `ticket_tab.php` (botões) que esse backend referencia.
- Um checkout limpo de `b614930` teria backend sem flags/botões de UI (inofensivo: flags default-off, mas inconsistente).
- Decisão de remediação = **humana** (reset destrutivo é FORBIDDEN). Ver [gap report §Workspace](v10_gap_closure_report.md).

---

## 4. Working tree atual (2026-06-21)

| Arquivo | Estado | Pertence a | Natureza |
|---|---|---|---|
| `.env.example` | modificado | P5+P6+P7 (compartilhado) | flags V10 — nunca commitado |
| `integaglpi/templates/ticket_tab.php` | modificado | P5+P6+P7 (compartilhado) | botões — nunca commitado |
| `integaglpi/src/Service/SmartHelpService.php` | modificado | P4 fix + P6 fix | local-empty gate + sanitizeResolutionDraftKbEvidence + evidence_unavailable |
| `integaglpi/front/smart.help.php` | modificado | P6 fix | normalizer kb_evidence |
| `integaglpi/js/ticket_ai_panel.js` | modificado | P6 fix + P7 fix | kb_evidence send + state machine UI-only |
| `integaglpi/tests/V10AssistedActionProposalsStaticTest.php` | untracked | P6 | 17 testes |
| `integaglpi/tests/V10HumanApprovalDraftApplicationStaticTest.php` | untracked | P7 | 15 testes |
| `docs/v10_hml_*.md` (3) | untracked | P5/P6/P7 | docs |
| `audit_out/` | untracked | — | **NUNCA staged** |

Staged: **vazio**. `audit_out/`: **unstaged**. Nenhum reset/rebase executado.

---

## 5. Reconciliação de claims de relatórios externos

| Claim externo | Veredito | Prova |
|---|---|---|
| "V9.5 ainda NO-GO" | STALE | operador reporta promovida; `99fbc41` close readiness |
| "Fase 4 sem commit" | STALE | `e80a9a2` existe (450 ins) |
| "Fases 5–7 não implementadas" | STALE | backend em `b614930`; fixes no working tree |
| "V10 apenas 60% baseado em prompts" | UNSUPPORTED | sem métrica; não registrado como verdade |
| "Fases 6/7 precisam FIX" | CONFIRMED | Cursor FIX; fixes aplicados este changeset |

---

## 6. Flags V10 — todas default-off (`.env.example`)

Ver matriz canônica em [`docs/v10_hml_feature_flags_matrix.md`](v10_hml_feature_flags_matrix.md).
Bloqueadores globais sempre checados nos gates: `V10_PRODUCTION_ENABLED`, `V10_AUTONOMOUS_ACTIONS_ENABLED`,
`V10_AUTONOMOUS_SEND_ENABLED`, `V10_KB_AUTO_PUBLISH_ENABLED`. Runtime HML exigido (`isHmlRuntime()`).

---

## 7. M0 Gate 0 — atualização 2026-06-21

Phase: `integaglpi_v10_m0_hml_reproducibility_and_safety_gate_001`.

- Operador informou smoke manual P4 OK em GLPI HML; P5, P6, P7 e sanitização permanecem HML validado.
- Produção V10 permanece **bloqueada**. Nenhuma promoção, migration, schema change, Meta API ou WhatsApp real foi executado neste gate.
- HML runtime publicado foi conferido por SHA256 contra o workspace local versionado para:
  - `integaglpi/front/smart.help.php`
  - `integaglpi/js/ticket_ai_panel.js`
  - `integaglpi/src/Service/SmartHelpService.php`
  - `integaglpi/templates/ticket_tab.php`
- Ressalva: o webroot HML do plugin não é um checkout git; o método de atualização observado é cópia manual versionada com backup. Restart web/PHP não perde os arquivos, mas rebuild/redeploy limpo precisa reaplicar os arquivos versionados e `config/local_define.php`.
- M2 pode iniciar **somente em HML** depois deste M0, mantendo produção V10 bloqueada e sem autoenvio/autoexecução.

---

## 8. M4.2 Gate — atualização 2026-06-21

Phase: `integaglpi_v10_hml_m4_2_gate_closure_register_001`.

- Commit M4.2: `406e56a` (`feat(integaglpi): add v10 kb deflection candidate dry run`).
- Resultado operacional HML: `HML_PASS_WITH_RESSALVAS`.
- `glpi-integaglpi-integration` permaneceu `UP` após publicação HML.
- `/health` retornou `ok:true`.
- Smoke sintético M4.2: cenários A–F `PASS`.
- Produção V10 permanece **bloqueada**.
- Sem Meta API, WhatsApp real, envio de mensagem, criação/alteração de ticket, migration ou schema change.
- Ressalva operacional: durante a publicação HML, o `docker-compose` legado recriou `postgres`/`redis` do mesmo projeto HML por dependência do compose; não houve migration/schema e a saúde retornou OK. O recreate posterior do `integration-service` foi feito com `--no-deps`.
- Próximo passo registrado: `M4.3 HML Synthetic WhatsApp Simulator`.

---

## 9. Governança V10 — plano restante congelado (2026-06-21)

SSOT de execução: [`docs/roadmap_v10_plano_restante.md`](roadmap_v10_plano_restante.md).

```yaml
next_phase_id: integaglpi_v10_m5_1_shadow_queue_migration_001
next_action: M5.1 migration-only permitido; M5.2 bloqueada até métricas M4-GATE 30d
pre_requisito_gate_counting: N2→N3 confirmado; métricas M4-GATE 30d exigidas para M5.2
production_status: V10_BLOQUEADA
m0_b1: READY (integration-service HML @ 882a66a, re-smoke 10/10)
sequencia: N2→N3 → M5.1 → M4-GATE → M5.2 → M5-GATE → M6.1 → M6.2 → M6-GATE
```

**M4.3 ressalvas triadas pela M4.4:** R2 (baixa confiança 0.45–0.65) coberta no seam do agregador; R1 (KB real HML) carregada para smoke/gate com port compatível; R3 (endpoint HTTP) mantida fora do escopo por design service-level synthetic.

**Regra:** subfase operacional numerada proibida; migration = fase própria; gate = critério de dados.

---

## 10. M4.4 — Tier-0 E2E sintético/controlado

Phase: `integaglpi_v10_m4_4_tier0_e2e_synthetic_controlled_001`.

- Commit: `882a66a`.
- Status: `IMPLEMENTED_NOT_GATE_COUNTABLE`.
- Serviço: `V10Tier0E2eService`.
- Flags novas: `V10_WHATSAPP_TIER0_E2E_ENABLED=false`, `AI_AUTONOMY_KILL_SWITCH=false`.
- Garantias cobertas: identidade automatizada (I6), handoff universal (I2), kill switch (I3), ticket determinístico sem criação/mutação (I8), deflection rastreada a KB aprovada (I1), métricas metadata-only.
- Sem endpoint HTTP nesta fase; service-level smoke é o mecanismo de validação HML sintético.
- Sem Meta API, WhatsApp real, envio, ticket real, FSM/Redis mutation, migration ou schema change.
- Gate counting: **bloqueado** até confirmação de M0/B1 e N2→N3 (`v9_closure_done`, M3 done, `kbs_approved_tier0 >= 10`, busca top1 `>= 9/10` pós-deploy).

---

## 11. M0/B1 — HML reproduzível integration-service (2026-06-21)

Phase: `integaglpi_v10_m0_b1_hml_reproducible_deploy_resmoke_001`.

- Veredito: `M0_B1_READY` (integration-service).
- Deploy: `docker-compose build` + `up --force-recreate --no-deps integration-service`.
- Source commit: `882a66a`; imagem `sha256:eb5f9e56d8ad…7979a4`.
- Re-smoke 10/10: PASS.
- Ressalva: plugin PHP webroot permanece cópia manual (fora do escopo B1 Node).
- M5.1: liberada para migration isolada metadata-only após M4.4/M0-B1/N2→N3; M5.2 segue bloqueada até M4-GATE.

---

## 12. Gate N2→N3 — KB readiness audit (2026-06-21)

Phase: `integaglpi_v10_n2_n3_gate_kb_readiness_001`.

| Critério | Resultado |
|---|---|
| M0/B1 | READY (`0f8fe70`) |
| M3 done (gate strict) | **true** — `DONE_FOR_GATE`; observabilidade read-only, metadata-only, retenção real bloqueada |
| `kbs_approved_tier0` | **11** após curadoria HML metadata-only (`status=approved` em `glpi_plugin_integaglpi_kb_candidates`) |
| Gap para ≥10 | **0** — componente KB do gate N2→N3 pronto; ver relatório `docs/v10_n2_n3_kb_tier0_curation_report.md` |
| R1 smoke KB real HML | **PASS** — Postgres real, `top1=9/10`, `top3=10/10` pós-deploy `882a66a` |
| N2→N3 confirmed | **true** |
| M5.1 | **liberada para migration isolada metadata-only; M5.2 bloqueada** |

**Nota:** corpus searchable inclui `approved+candidate+needs_review` (30 candidatos tiered); gate exige **approved** Tier-0 ≥10, não candidatos.

---

## 13. Gate N2→N3 — KB Tier-0 curation (2026-06-21)

Phase: `integaglpi_v10_n2_n3_kb_tier0_curation_gate_fix_001`.

- Escopo: correção de gate HML-only para elevar KB `approved` de 1 para 11.
- Fonte oficial: tabela HML `glpi_plugin_integaglpi_kb_candidates`.
- Método: update controlado apenas em candidatos existentes, alterando `status`, `reviewed_at`, `review_notes` e `updated_at`; `source_tier` original preservado.
- Curadoria: 10 candidatos existentes aprovados após triagem metadata-only; hard-risk PII/secret-value screening zerado para e-mail, telefone, CPF, CNPJ e valores de segredo.
- Evidência pós-curadoria: `approved_total=11`, `approved_tier0_gate_count=11`, `distinct_category_signal=10`.
- Smoke KB/search HML: `top1=9/10`, `top3=10/10`, sem cloud, sem payload real, sem Meta API/WhatsApp.
- M5.1: migration isolada metadata-only permitida; N2→N3 está confirmado. Métricas M4-GATE 30d continuam indisponíveis e bloqueiam M5.2.

---

## 14. M3 gate strict closure (2026-06-21)

Phase: `integaglpi_v10_m3_gate_strict_closure_001`.

- Veredito: `M3_DONE_FOR_GATE`.
- Status anterior: `HML_PASS_WITH_RESSALVAS`.
- Ressalvas bloqueantes para N2→N3: nenhuma.
- Ressalvas não bloqueantes:
  - latência de provider pode aparecer como `not_available` quando não houver metadado seguro;
  - P7 continua UI-only e a observabilidade conta apenas eventos persistidos;
  - adoção aceita vs apagada por técnico exige persistência futura;
  - retenção real permanece fora do escopo M3 e bloqueada por flag/gate.
- Evidência local: `integaglpi/tests/V10AiObservabilityStaticTest.php` PASS; `integration-service/tests/observabilityService.test.ts` PASS.
- Evidência HML read-only: `glpi-integaglpi-integration` ativo; `/health` no host HML respondeu `ok:true`.
- N2→N3: confirmado após M0/B1 READY, M3 `DONE_FOR_GATE`, KB Tier-0 `approved >= 10`, smoke KB/search HML `top1=9/10`.
- M5.1: liberada para migration isolada metadata-only; M5.2 permanece bloqueada até M4-GATE 30d.

---

## 15. M4-GATE 30d metrics window (2026-06-21)

Phase: `integaglpi_v10_m4_gate_30d_metrics_window_001`.

- Veredito: `M4_GATE_NOT_READY`.
- Pré-gates: M0/B1 READY, N2→N3 confirmado, M3 `DONE_FOR_GATE`, KB Tier-0 `approved >= 10`, busca HML `top1=9/10`.
- M4.4 commit base: `882a66a` em 2026-06-21; não há janela operacional de 30 dias após a implementação M4.4.
- Fonte HML read-only consultada: PostgreSQL operacional, com SELECTs agregados em `audit_events` e `solution_actions`.
- Janela observada para eventos M4/CSAT-like em `audit_events`: 27 dias ativos no máximo, sem eventos persistidos de Tier-0/deflection M4 suficientes para compor numerador/denominador do gate.
- CSAT geral existe em `solution_actions`, mas não está vinculado a deflexão Tier-0 M4; portanto não serve como CSAT do M4-GATE.
- Métricas oficiais M4-GATE permanecem indisponíveis: deflexão Tier-0 30d, falso-resolvido Tier-0, CSAT Tier-0 e incidentes PII/alucinação em janela Tier-0.
- M5.1: migration isolada metadata-only permitida; M5.2 permanece bloqueada.

---

## 16. M5.1 — Shadow Mode Queue Migration HML (2026-06-21)

Phase: `integaglpi_v10_m5_1_shadow_queue_migration_001`.

- Status: `HML_APPLIED`.
- Migration criada: `integration-service/schema-migrations/060_shadow_mode_queue.sql`.
- Tabela HML: `public.glpi_plugin_integaglpi_shadow_queue`.
- Design: metadata-only, hash-only para idempotência e referências; sem raw payload, telefone, e-mail, CPF/CNPJ, token ou credencial.
- Estados: `suggested`, `approved`, `edited`, `rejected`, `expired`.
- Índices mínimos: `ux_shadow_queue_idempotency_key`, `idx_shadow_queue_state_expires_at`, `idx_shadow_queue_correlation_id`.
- Retenção/expurgo futuro: `expires_at`.
- Node: apenas tipos mínimos em `ShadowModeQueue.ts`; nenhuma engine, rota, UI, envio, Redis, FSM ou integração Meta/WhatsApp.
- Teste estático: `integration-service/tests/v10ShadowQueueMigrationStatic.test.ts`.
- Aplicação HML: via `psql` no container `glpi-integaglpi-postgres`; `to_regclass` OK; tabela vazia (`row_count=0`).
- Validação HML: colunas esperadas presentes, colunas proibidas ausentes, `chk_shadow_queue_state`, `ux_shadow_queue_idempotency_key`, `idx_shadow_queue_state_expires_at` e `idx_shadow_queue_correlation_id` OK.
- Produção V10 permanece bloqueada; migration não aplicada em produção.
- M4-GATE 30d não bloqueia a M5.1, mas continua bloqueando M5.2.

---

## 17. M5.2 — M5-GATE data alignment (2026-06-21)

Phase: `integaglpi_v10_m5_2_shadow_engine_ui_gate_metrics_alignment_001`.

- Status: `ALIGNED_LOCAL_NOT_COMMITTED`.
- Coleta metadata-only para M5-GATE por categoria: aprovação sem edição, acerto 72h (preparado), tempo revisão, CSAT por hash, incidentes críticos, diversidade revisores, taxa expiração.
- Serviço: `aggregateGateMetricsByCategory`, `buildGateMetricsRecord`, `M5_GATE_THRESHOLDS` em `ShadowModeQueueService.ts`.

### M5.2 Cursor FIX — PostgreSQL boundary (2026-06-21)

Phase: `integaglpi_v10_m5_2_shadow_engine_ui_fix_001`.

- Status: `FIXED_LOCAL_NOT_COMMITTED`.
- Correção: removido acesso `$DB` do GLPI/MariaDB em `ai.shadow.queue.php`; a fila `glpi_plugin_integaglpi_shadow_queue` pertence ao PostgreSQL operacional.
- Runtime Node: `PostgresShadowModeQueueRepository` implementa `ShadowModeQueuePort` para insert idempotente, listagem limitada, update de estado e expiração.
- UI PHP: fail-closed/read-only com `SHADOW_QUEUE_POSTGRES_BRIDGE_REQUIRED` até existir endpoint interno Node seguro para revisão.
- Segurança: identidade de revisor não vem de POST; hash deve ser derivado de `Session::getLoginUserID()` no servidor.
- Regressão: testes estáticos bloqueiam `$DB`, nome da tabela shadow no PHP e qualquer `reviewer_id` vindo do cliente.
- Produção V10, Meta API, WhatsApp real, envio automático, mutação de ticket/FSM/Redis e M6 permanecem bloqueados.
- UI: `ai.shadow.queue.php` persiste `review_decision`, `time_to_first_review_seconds`, bloco `m5_gate`, flags críticas em `safety_flags_json`.
- GO humano obrigatório (`human_go_required=true`); `m6_auto_release=false` em seed e agregados.
- M5-GATE gera recomendação (`hold` | `recommend_go` | `fail`); **nunca libera M6 automaticamente**.
- Reabertura 72h e CSAT: campos preparados (`pending_source` / `insufficient_sample`); sem payload bruto ou PII.
- Produção V10 permanece bloqueada.

### M5.2 HML deploy/smoke — 2026-06-21

Phase: `integaglpi_v10_m5_2_shadow_engine_ui_hml_deploy_smoke_001`.

- Status: `HML_PASS_WITH_RESSALVAS`.
- Commit runtime: `57f84b6`.
- Node HML: rebuild/recreate somente `glpi-integaglpi-integration`; `/health` `ok:true`; dist contém `ShadowModeQueueService`, `ShadowModeEngineService` e `PostgresShadowModeQueueRepository`.
- Plugin HML: publicado somente `front/ai.shadow.queue.php`; SHA256 webroot = workspace; `php -l` PASS no destino.
- PostgreSQL HML: tabela `public.glpi_plugin_integaglpi_shadow_queue` existente; smoke sintético metadata-only executado.
- Smoke Node: enqueue PASS, idempotência PASS, transições `approved/edited/rejected/expired` PASS, transição inválida bloqueada, métricas M5-GATE calculáveis, incident flags metadata-only.
- Smoke UI autenticado: rota disponível e fail-closed com `SHADOW_QUEUE_UI_GATE_CLOSED` porque as flags PHP da UI permanecem fechadas no webserver HML; sem envio/Meta/WhatsApp/ticket mutation.
- Segurança: produção, Meta API, WhatsApp real, autoenvio, Redis/FSM mutation, schema/migration e M6 permaneceram bloqueados.

---

## 18. M6.1 — Control Plane por Categoria (2026-06-21)

Phase: `integaglpi_v10_m6_1_control_plane_category_autonomy_001`.

- Status: `HML_PASS_WITH_RESSALVAS`.
- Commit: `7e5b354`.
- Arquivos: `AutonomyControlPlane.ts` (tipos), `AutonomyCategoryPolicyService.ts` (policy + config), `AutonomyRiskEngineService.ts` (risk engine).
- Testes: `v10M6CategoryControlPlane.test.ts` — **47/47 PASS**; `tsc --noEmit` limpo.
- Categorias reconhecidas: `password_reset`, `email_config`, `hardware_basic`, `software_installation`, `vpn_access`, `printer_config`, `ticket_status_query`, `kb_deflection_tier0`.
- `autonomous_categories=[]` por padrão; qualquer valor não reconhecido ou erro → `[]` (fail-closed).
- Kill switch `AI_AUTONOMY_KILL_SWITCH`: apenas `false`/`0`/`no`/`off` desativa; ausente ou inválido → ativo/bloqueado (fail-closed).
- Thresholds conservadores: approval_without_edit ≥ 0.90, accuracy ≥ 0.85, reopen ≤ 0.10, csat ≥ 4.5, critical_incident = 0, sample ≥ 40, reviewer_diversity ≥ 3.
- `autonomy_allowed: false` — tipo literal TypeScript; impossível retornar `true`.
- `human_go_required: true` — tipo literal TypeScript; impossível retornar `false`.
- `m6_auto_release: false` — tipo literal TypeScript; impossível retornar `true`.
- Deploy HML: `glpi-integaglpi-integration` rebuild/recreate somente em HML; `/health` `ok:true`; dist contém os três módulos M6.1.
- Smoke HML: flags default-off, `autonomous_categories=[]`, allowlist vazia, categoria fora da allowlist, kill switch ativo/missing/inválido, thresholds, incidente crítico, reviewer diversity, `eligible_for_human_go=true` sem autonomia, downgrade e repetição validados.
- Segurança HML: sem Meta API, sem WhatsApp real, sem autoenvio, sem ação externa, sem ticket/FSM/Redis mutation, sem migration/schema, sem produção, sem M6.2 e sem M7.
- Ressalva HML: flags M6.1 reais no container estão `unset` exceto `V10_PRODUCTION_ENABLED=false`; o runtime permanece fail-closed/default-off, com autonomia real desativada.
- `.env.example` atualizado com 7 flags M6.1 (todas default-off).
- Pré-requisitos para M6.2: M5-GATE `recommend_go` + GO humano granular por categoria + `eligible_for_human_go=true` em ≥1 categoria por ≥30d shadow mode.

---

## 19. M6.2 — Piloto Restrito por Categoria (2026-06-21)

Phase: `integaglpi_v10_m6_2_restricted_category_pilot_001`.

- Status: `HML_PASS`.
- Commit: `8735d71c6faed8d0dac8152a4177fc09a0c4ad55`.
- Arquivos: `RestrictedAutonomyPilot.ts` (tipos), `RestrictedAutonomyPilotService.ts` (piloto + config + métricas), `AutonomyPilotActionGuardService.ts` (guard central).
- Testes: `v10M6RestrictedPilot.test.ts` — **43/43 PASS**; `v10M6CategoryControlPlane.test.ts` 47/47 mantido; `tsc --noEmit` limpo.
- HML-first, sandbox-first; adapter fake/simulação é o default absoluto.
- Dependência obrigatória do control plane M6.1: `generateProposal` chama `AutonomyRiskEngineService.evaluate` antes de qualquer proposta.
- Categorias piloto vazias por padrão (`RESTRICTED_AUTONOMY_PILOT_CATEGORIES=[]`); fail-closed em valor não reconhecido.
- `real_execution_allowed: false` — tipo literal; impossível executar ação externa real.
- Mesmo após aprovação humana (`approve`/`edit`), execução continua simulada com sufixo `[MOCK_PILOT]` e `mock_execution_hash` determinístico.
- Guard bloqueia por padrão: exige HML/sandbox, kill switch não ativo, categoria allowlisted, control plane `eligible_for_human_go`, aprovação humana, supervisor confirmado, identificadores hash-only.
- Habilitar `RESTRICTED_AUTONOMY_PILOT_REAL_ACTIONS_ENABLED`/`META_API`/`WHATSAPP` fecha o gate (fail-safe).
- Métricas metadata-only: proposal_count, approval/rejection/edit rate, execution_block_rate, downgrade_count, critical_incident_count, time_to_human_approval, operator_diversity (por hash).
- Segurança: produção não tocada, sem deploy/migration/schema, sem Meta API real, sem WhatsApp real, sem autoenvio, sem ação externa real, sem mutação de ticket/Redis/FSM, sem M7, sem autonomia global, sem payload bruto/PII/credenciais, `audit_out/` não staged.
- `.env.example` atualizado com 9 flags M6.2 (todas seguras por padrão).
- UI: Node-only nesta fase; qualquer aprovação futura via UI vira contrato separado (Supervisor-only, read-only, sem produção).

### M6.2 HML deploy/smoke — 2026-06-21

Phase: `integaglpi_v10_m6_2_restricted_category_pilot_hml_deploy_smoke_001`.

- Node HML: rebuild/recreate somente `glpi-integaglpi-integration`; `docker-compose` usado porque o host não possui plugin `docker compose`; `--no-deps` manteve Postgres/Redis fora do recreate.
- Health HML: `/health` `ok:true`, PostgreSQL OK e Redis ready.
- Smoke HML: 25/25 checks PASS no runtime compilado em `/app/dist`.
- Checks PASS: flags default-off, categoria piloto vazia, categoria fora da allowlist bloqueada, control plane obrigatório, kill switch ativo bloqueia, kill switch inválido fail-closed, `eligible_for_human_go` sem autoexecução, aprovação humana obrigatória, reject bloqueia, edit/approve simulados, `[MOCK_PILOT]`, `mock_execution_hash`, `real_execution_allowed=false`, `simulationMode=true`, real actions flag bloqueia, downgrade to shadow, métricas metadata-only, sem Meta/WhatsApp/cloud/autoenvio/ação externa/ticket/Redis/FSM/payload bruto/PII/M7.
- Segurança HML: produção não tocada; sem deploy prod; sem migration/schema; sem chamada Meta/WhatsApp/cloud; sem ação externa real; sem autonomia global; categoria piloto default não populada.
- Ressalvas herdadas: metrics sem emitter runtime; guard confia no service para flags redundantes; untracked fora da fase permanecem fora de stage/commit.

---

## 20. M7 — Horizon/Stub de Autonomia por Classe de Serviço (2026-06-21)

Phase: `integaglpi_v10_m7_autonomy_horizon_stub_001`.

- Status: `HORIZON · STUB · NOT_PROMOTABLE · NO_RUNTIME · NO_PRODUCTION · NO_AUTONOMY_REAL · NO_META_WHATSAPP · NO_EXTERNAL_ACTION`.
- Docs-first e type-only; nenhuma promoção possível por design.
- Arquivos: `ServiceClassAutonomyStub.ts` (type-only), `v10M7ServiceClassAutonomyStub.test.ts` (16 testes estáticos), `docs/v10_hml_m7_autonomy_horizon_stub.md`.
- `tsc --noEmit` limpo; M7 16/16 PASS; regressão M6.1+M6.2 90/90 mantida.
- `service_class` definida como envelope de governança/risco ACIMA de category; conjuntos `SERVICE_CLASS_KEYS` e `AUTONOMY_CATEGORY_KEYS` disjuntos (testado).
- Fronteiras abstratas: `ServiceClassSlaTier` (sem horas reais), `ServiceClassEntityScopeToken` (token opaco, sem nome/id real), `ServiceClassRiskTier`.
- Allowlist de classes vazia por padrão (`DEFAULT_SERVICE_CLASS_ALLOWLIST=[]`).
- Literais invioláveis: `SERVICE_CLASS_AUTONOMY_ENABLED`, `SERVICE_CLASS_REAL_EXECUTION_ALLOWED`, `SERVICE_CLASS_PRODUCTION_ALLOWED`, `SERVICE_CLASS_GLOBAL_AUTONOMY_ALLOWED` todos `false`; `serviceClassAutonomyAllowed()` retorna `false` literal.
- Sem runtime/service/adapter/config loader/gate/repository/controller/endpoint; stub não importado por `buildDependencies.ts` nem por qualquer arquivo de `src` (testado).
- Sem migration/schema; qualquer schema futuro vira fase própria.
- Elegibilidade futura por classe = recomendação, nunca autonomia automática; exige M5-GATE `recommend_go` + maturidade M6.1/M6.2 + GO humano granular por classe + contrato próprio.
- Segurança: produção não tocada, sem deploy, sem Meta/WhatsApp/cloud, sem autoenvio, sem ação externa, sem ticket/Redis/FSM mutation, sem payload bruto/PII/credenciais, `audit_out/` não staged.

---

## 21. V10 HML Final Closure (2026-06-21)

Phase: `integaglpi_v10_hml_final_closure_001`.

- Status: `V10_HML_CLOSED_WITH_RESSALVAS`.
- Documento de fechamento: [`docs/v10_hml_final_closure.md`](v10_hml_final_closure.md).
- M5.2: `HML_PASS_WITH_RESSALVAS` — runtime `57f84b6`, docs/smoke `94c8885`; UI autenticada fail-closed por flags PHP fechadas.
- M6.1: `HML_PASS_WITH_RESSALVAS` — runtime `7e5b354`, docs/smoke `4fd8dd6`; `autonomy_allowed=false`, `m6_auto_release=false`, `human_go_required=true`.
- M6.2: `HML_PASS_WITH_RESSALVAS` — runtime `8735d71c6faed8d0dac8152a4177fc09a0c4ad55`, docs/smoke `ae585aa6ea50b7db17750065f7767c63b6cd10cb`; `[MOCK_PILOT]`, `mock_execution_hash`, `real_execution_allowed=false`.
- M7: `COMMITTED_NOT_PROMOTABLE` — `914a12ad821e9af97e71564a1a13affee0e5f836`; horizon/stub docs-first/type-only, sem runtime e sem deploy HML necessario.
- Produção V10 permanece bloqueada; nenhuma promoção é autorizada por este fechamento.
- M8 não existe no roadmap V10 atual e não foi criado.
- Qualquer produção, autonomia real, schema/migration futura ou ação real exige contrato próprio, GO humano e fase separada.
- Segurança desta fase: docs-only; sem runtime, deploy, migration/schema, Meta API, WhatsApp real, cloud call, autoenvio, ação externa, ticket/Redis/FSM mutation, payload bruto, PII ou credenciais.

---

## 22. V10 Full E2E Smoke HML (2026-06-21)

Phase: `integaglpi_v10_hml_full_e2e_human_simulation_smoke_001`.

- Status: `V10_FULL_E2E_SMOKE = HML_PASS_WITH_RESSALVAS`.
- Relatório: [`docs/v10_hml_full_e2e_smoke_report.md`](v10_hml_full_e2e_smoke_report.md).
- Ambiente HML read-only: `glpi-integaglpi-{integration,postgres,redis}` Up; `/health` `ok:true` (postgres 8ms, redis ready, webhook_guard configurado); produção `prod-*` não consultada/tocada.
- Testes service-level: `tsc` PASS + 5 suites V10 (`v10ShadowModeEngineUi`, `v10ShadowQueueMigrationStatic`, `v10M6CategoryControlPlane`, `v10M6RestrictedPilot`, `v10M7ServiceClassAutonomyStub`) = **189/189 PASS**.
- PostgreSQL HML: `glpi_plugin_integaglpi_shadow_queue` presente, 4 linhas sintéticas, estados `approved/edited/rejected/expired`, **0 colunas de PII**.
- `dist` HML contém os serviços M5.2/M6.1/M6.2; stub M7 ausente do `dist` (type-only, sem runtime) — evidência direta de `not_promotable`.
- Log scan (800 linhas): 0 CPF, 0 e-mail, 0 Meta/WhatsApp send, 0 cloud call, 0 erros; 34 "11 dígitos" classificados como **falso-positivo** (timestamps epoch-ms Pino), sem telefone real.
- Ressalvas: fluxos de UI humana ao vivo (webhook assinado, fila/entidade, ticket GLPI sintético, KB/Ajuda Inteligente via tela) **não acionados ao vivo** para evitar mutação FSM/Redis/ticket e risco Meta; validados em nível de serviço + estado HML read-only. Recomendado harness de webhook sintético assinado HML.
- Segurança: produção não tocada, sem deploy, sem migration/schema, sem runtime alterado, sem Meta/WhatsApp/cloud real, sem autoenvio, sem ação externa, sem autonomia real, sem M8, sem PII/credenciais; `audit_out/` não staged.

---

## 23. V10 HML Ressalvas Closure (2026-06-21)

Phase: `integaglpi_v10_hml_ressalvas_closure_001`.

- Status: `RESSALVAS_CLOSURE_READY_FOR_REVIEW`.
- Documento: [`docs/v10_hml_ressalvas_closure.md`](v10_hml_ressalvas_closure.md).
- M6.2 hardening: `RESTRICTED_AUTONOMY_PILOT_HML_ONLY` agora participa diretamente do gate; falso/inválido bloqueia.
- M6.2 hardening: `generateProposal` exige control plane M6.1 aberto e `AUTONOMY_CONTROL_PLANE_HML_ONLY=true` antes de qualquer proposta.
- M6.2 hardening: `AutonomyPilotActionGuardService` revalida flags redundantes (`simulationMode`, `realActionsEnabled`, `metaApiEnabled`, `whatsappEnabled`, `requireHumanApproval`, `pilotHmlOnly`) e fecha em caso inseguro.
- Testes M6.2 ampliados para control plane off/ausente/inválido, HML-only falso/inválido e guard fail-closed para ação real.
- M5.2 permanece documentado como fail-closed/copy-only quando UI flags estão fechadas.
- M6.1 default-off/unset permanece fail-closed.
- M7 permanece `HORIZON_STUB_NOT_PROMOTABLE`, sem runtime/wiring/schema/deploy.
- Produção V10 continua bloqueada; esta fase não executa deploy, migration, Meta API, WhatsApp real, cloud call, autoenvio, ação externa, ticket mutation, Redis/FSM mutation, payload bruto, PII ou credenciais.

### FIX documental do inventário — 2026-06-21

Phase: `integaglpi_v10_hml_ressalvas_closure_fix_001`.

- O documento de closure agora lista explicitamente as 10 ressalvas principais (`R1`–`R10`) com classificação formal.
- Itens administrativos como untracked fora de fase e `audit_out/` foram separados como `NAO_E_RESSALVA` e não entram no total principal.
- M8 segue ausente no roadmap atual e não foi criado.
- Fix docs-only: sem runtime, testes, deploy, migration/schema, `.env`, `.env.example`, `buildDependencies`, produção ou autonomia real.

---

## 24. V10 Full Live Synthetic Journey Smoke HML (2026-06-21)

Phase: `integaglpi_v10_hml_full_live_synthetic_journey_smoke_001`.

- Status: `V10_FULL_LIVE_SYNTHETIC_JOURNEY_SMOKE = HML_PASS_WITH_RESSALVAS`.
- Relatório: [`docs/v10_hml_full_live_synthetic_journey_smoke.md`](v10_hml_full_live_synthetic_journey_smoke.md).
- Correlation id sintético: `V10-LIVE-SYNTHETIC-20260621`.
- **LIVE PASS** (camada runtime/dados, com cleanup):
  - Shadow Queue M5.2: enqueue `suggested` → idempotência (`INSERT 0 0`) → transição `approved` (reviewer_hash server-side) → `DELETE` cleanup → total volta a baseline 4, resíduo 0.
  - FSM/Redis: chave sintética `v10:smoke:live:*` SET/GET/UNLINK; `exists=0`; `dbsize=96` baseline; resíduo 0.
  - KB local: busca read-only retornou 4 candidatos (Outlook/M365/senha), sem PII.
  - Control Plane M6.1 (in-container `dist`): `autonomy_allowed=false`, `eligible=true`, `human_go=true`, `m6_auto_release=false`, kill switch ausente → `downgrade_to_shadow=true`.
  - Piloto M6.2 (in-container `dist`): proposta `generated`; `approve` → simulado `[MOCK_PILOT]` `mock_execution_hash`(64), `real_execution_allowed=false`; `reject` → execução `null`.
  - M7: ausente do runtime `dist` (`NONE_M7_RUNTIME`) — not promotable.
  - Webhook guard: fail-closed live (`POST` não assinado `401`; `GET` verify token errado `403`).
- **NOT_RUN (justificado)**: inbound_message, queue_selection, entity_selection, ticket_hml_synthetic, smart_help — porta da frente atrás de assinatura Meta / token de API interna (`401`) / sessão GLPI autenticada; proibido extrair/expor segredo; UI não dirigível headless. Recomendado harness de webhook sintético assinado HML.
- Log scan (400 linhas): 0 CPF, 0 e-mail, 0 Meta send, 0 cloud, 0 erros.
- Segurança: produção não tocada (containers `prod-*` uptime inalterado), sem deploy/migration/schema, sem runtime alterado, sem Meta/WhatsApp/cloud real, sem autoenvio, sem ação externa, sem autonomia real, sem M8; dados sintéticos limpos; `audit_out/` não staged.

---

## 25. V10 HML Live Journey PoC Bypass Fix (2026-06-21)

Phase: `integaglpi_v10_hml_live_journey_poc_bypass_fix_and_resmoke_001`.

- Status: `FIX_IMPLEMENTED_RESMOKE_PENDING_OPERATOR_SEED`.
- Documento: [`docs/v10_hml_live_journey_poc_bypass_fix.md`](v10_hml_live_journey_poc_bypass_fix.md).
- Root cause: o marcador `[GLPI PoC]` é log amplo do `GlpiClient`; o bypass operacional estava no `InboundWebhookService`, porque a jornada viva HML podia ignorar opções resolvidas de roteamento quando o default seguro de triagem de cliente estava desligado, permitindo ticket/follow-up GLPI antes de uma conversa `awaiting_queue_selection`.
- Fix: `V10_HML_ENABLED=true` agora reabre o uso das opções resolvidas para a jornada viva HML; produção continua dependente de `WHATSAPP_CUSTOMER_TRIAGE_MENU_ENABLED`.
- Regressão adicionada: primeiro contato com entidade memorizada e opções de fila em HML não chama `createTicket`/`addFollowUp`; persiste conversa com `glpi_ticket_id=null`, `status=awaiting_queue_selection` e `conversation_id` no estado da mensagem.
- Deploy HML: rebuild/recreate somente `glpi-integaglpi-integration` com `--no-deps`; `/health ok:true`; sem migration/schema; produção não tocada.
- Validações: `tsc` local PASS; inbound webhook 97/97 PASS; regressão V10 M5.2/M6.1/M6.2/M7 190/190 PASS; Docker build HML PASS; `git diff --check` PASS com avisos LF/CRLF.
- Resmoke vivo: `NOT_RUN` porque não houve nova mensagem seed dos telefones autorizados durante a janela monitorada de 120s pós-deploy.
- Segurança: sem produção, sem envio Meta no teste, sem número não autorizado, sem raw payload/PII/credenciais, sem M7 runtime e sem M8.

---

## 26. V10 HML AI Full Journey + Prompt Tuning Smoke (2026-06-21)

Phase: `integaglpi_v10_hml_ai_full_journey_prompt_tuning_smoke_001`.

- Status: `V10_AI_FULL_JOURNEY_PROMPT_TUNING_SMOKE = HML_PASS_WITH_RESSALVAS`.
- Relatório: [`docs/v10_hml_ai_full_journey_prompt_tuning_smoke.md`](v10_hml_ai_full_journey_prompt_tuning_smoke.md).
- Relatório self-driven: [`docs/v10_hml_self_driven_full_e2e_ai_smoke.md`](v10_hml_self_driven_full_e2e_ai_smoke.md).
- Correlation id: `V10-AI-JOURNEY-SMOKE-20260621`.
- **LIVE PASS** (KB/IA/M5–M7 + outbound autorizado):
  - 4 cenários (Outlook, Impressora, Lentidão, VPN): KB search PASS; local AI (Ollama `gemma3:12b`) PASS; cloud path sanitizer/rewrite PASS, execução `provider_unavailable` (flag off).
  - Prompt tuning da rodada inicial: **0/3 ciclos** — sem fresh seed suficiente e
    sem tuning aplicado naquela execução.
  - M5.2: shadow queue enqueue/idempotência/approve/cleanup PASS (baseline 4).
  - M6.1: `autonomy_allowed=false`, `eligible_for_human_go=true` PASS.
  - M6.2: proposta + approve simulado `[MOCK_PILOT]`, `real_execution_allowed=false` PASS.
  - M7: `NONE_M7_RUNTIME` — not promotable.
  - Outbound: HTTP **201** `sent` para conv aberta de telefone autorizado (hash `fae97b3db809`); tentativa ticket sintético 409 `WINDOW_24H_CLOSED`.
- Jornada inbound/outbound fresh: PASS na reexecução controlada com quatro chamados sintéticos HML (`2112319481`–`2112319484`), `queue_id=3`, entidade `149`, status `open`, outbound HTTP 201.
- Validações locais: `tsc` PASS; vitest relevante **260/260** PASS; `git diff --check` PASS (LF/CRLF).
- Log scan (45 min): cpf=0, email=0, meta_send=0, cloud=0, errors=0.
- Harnesses executados localmente/HML como evidência operacional; scripts fora da
  allowlist deste commit permanecem untracked até contrato/review separado.
- Segurança: produção não tocada; sem commit; sem migration; token interno não exposto; telefones mascarados; sem M8.

### Reexecução pós-seed — 2026-06-21 23:21–23:31 UTC

- Status da rodada: `FIX`.
- Relatório atualizado: [`docs/v10_hml_ai_full_journey_prompt_tuning_smoke.md`](v10_hml_ai_full_journey_prompt_tuning_smoke.md).
- HML saudável: containers `glpi-integaglpi-{integration,postgres,redis}` ativos; `/health ok:true`; flags `V10_HML_ENABLED=true` e `WHATSAPP_CUSTOMER_TRIAGE_MENU_ENABLED=true`.
- Telefones autorizados observados somente mascarados por sufixo (`6562`, `4449`); conversas já estavam `open` e com ticket (`queue_id`/entidade presentes), portanto a rodada não comprovou first-contact `awaiting_queue_selection`.
- Monitor 10 min capturou webhooks/status/ações de solução em conversas existentes, mas não persistiu novas mensagens autorizadas dentro da janela e não executou os 4 cenários controlados.
- Marcador amplo `[GLPI PoC]` ainda aparece em chamadas GLPI REST legítimas do `GlpiClient`; requer ajuste de evidência/log antes de novo fechamento.
- Erro não fatal observado: tabela `glpi_plugin_integaglpi_contract_b_wait_log` ausente em log de SLA Contract B.
- Sem produção, deploy, migration/schema, M8, autonomia real, telefone fora da allowlist, raw payload, PII ou credenciais.

### Reexecução controlada self-driven — 2026-06-21

- Status da rodada: `HML_PASS_WITH_RESSALVAS`.
- Correlation id: `V10-SELF-DRIVEN-FULL-E2E-RERUN-20260621`.
- Evidência bruta sanitizada em HML: `/tmp/v10_self_driven_full_e2e_smoke_rerun.json`.
- Quatro cenários fresh controlados passaram via webhook assinado: Outlook (`2112319481`), Impressora (`2112319482`), Lentidão (`2112319483`) e VPN (`2112319484`).
- Cada cenário passou por seleção de fila, confirmação de perfil/entidade, criação de ticket HML e outbound HTTP 201.
- AI/gates: KB local PASS, SmartHelp PASS, IA local PASS, cloud path `provider_unavailable` seguro, M5.2/M6.1/M6.2/M7 PASS.
- Tuning self-driven final: **1 ciclo efetivo**. Ajuste aplicado no planner KB:
  domínio `network` agora permite tier_1 + tier_2 para não perder KBs de fornecedor
  em consultas VPN/Fortinet/Sophos.
- Validações finais: `tsc` PASS; vitest completo **162 arquivos / 2265 PASS / 1 skipped**; PHP lint plugin PASS; `git diff --check` PASS com avisos LF/CRLF.
- Ressalvas: cloud externa continua desligada/indisponível por desenho HML seguro; `[GLPI PoC]` segue como marcador amplo de log do `GlpiClient`, não como prova de bypass operacional nesta rodada.
- Sem produção, deploy adicional, migration/schema, M8, autonomia real, raw payload, PII ou credenciais.
- Escopo workspace: scripts/docs auxiliares untracked e `audit_out/` permanecem fora
  de stage/commit; eventual versionamento dessas evidências exige revisão própria.

---

## 27. V10 HML Self-driven Fresh-state AI Smoke (2026-06-21)

Phase: `integaglpi_v10_hml_self_driven_fresh_state_ai_smoke_001`.

- Status: `HML_PASS_WITH_RESSALVAS`.
- Relatório: [`docs/v10_hml_self_driven_fresh_state_ai_smoke.md`](v10_hml_self_driven_fresh_state_ai_smoke.md).
- Correlation id: `V10-FRESH-SELF-DRIVEN-20260621`.
- Harness: `integration-service/scripts/v10HmlSelfDrivenFreshStateAiSmoke.mjs` (webhook assinado in-container, sem seed manual).
- Fresh-state: `closed_total=2` conversas HML abertas dos telefones autorizados (`******66562`, `******34449`); `awaiting_queue_reached=true`.
- 4/4 cenários PASS: Outlook `2112319485`, Impressora `2112319486`, Lentidão `2112319487`, VPN `2112319488` — fila `3`, entidade/perfil OK, outbound HTTP 201 com prefixo `[HML TESTE V10]`.
- KB local USEFUL + IA local PASS (`gemma3:12b`); cloud `DISABLED` (`provider_unavailable` seguro).
- M5.2/M6.1/M7 PASS; M6.2 PASS com env explícito no harness (fail-closed runtime default-off documentado).
- Prompt tuning desta rodada fresh-state: 0/3. Patch anti-markdown em
  `KbRagCopilotService.ts` / `KbCustomResponseService.ts` está incluído no diff
  desta fase, validado localmente e pendente apenas de commit/deploy HML. O
  fechamento self-driven full e2e registrou depois 1 ciclo efetivo no planner KB
  `network`.
- Validações locais: `tsc` PASS; vitest inbound+V10 **287/287** PASS.
- Segurança: produção não tocada; sem migration/schema; sem segredo exposto; sem M8; sem autonomia real.

---

## 28. V10 HML Deep AI Evaluation & Prompt Tuning (2026-06-21)

Phase: `integaglpi_v10_hml_ai_deep_evaluation_prompt_tuning_001`.

- Status: `HML_PASS`.
- Relatório: [`docs/v10_hml_ai_deep_evaluation_prompt_tuning.md`](v10_hml_ai_deep_evaluation_prompt_tuning.md).
- Correlation id: `V10-AI-DEEP-EVAL-20260621`.
- Harness: `integration-service/scripts/v10HmlAiDeepEvaluation.mjs` — 24 casos sintéticos A–F in-container.
- Quality gates HML: KB USEFUL/PARTIAL **19/24** (alvo >=18); NOT_FOUND/fallback **5/24**; UNSAFE **0**; safety **24/24 @ 5**; avg usefulness **4.83**; sem PII para cloud (`EXTERNAL_RESEARCH_CLOUD_ENABLED=false`).
- Prompt tuning: **1/3 ciclos** — `stripPromptInjectionArtifacts()` em `KbSearchPlannerService.normalizeForPlan()` + correção de scoring UNSAFE no harness (output-only).
- Testes locais: `tsc` PASS; subset V10 **87/87** PASS (`v10AiDeepEvaluation`, `kbSearchPlanner`, `queryExpansion`, `aiCategoryClassificationStatic`).
- Cloud: DISABLED; sanitizer residual + bloqueio estrito por PII validados; HML retornou `provider_unavailable`; `local_vs_cloud.compared=false`.
- Segurança: HML only; sem commit/deploy prod; sem migration/schema/.env; telefones `******66562`/`******34449`; ticket `2112319360` intacto.

### Deploy/smoke HML pós-commit — 2026-06-21 BRT / 2026-06-22 UTC

- Commit runtime publicado: `2a293d9`.
- Deploy HML: rebuild/recreate somente de `glpi-integaglpi-integration` com `--no-deps`; sem migration/schema e sem produção. O aviso de órfãos `glpi-integaglpi-prod-*` foi observado, mas não houve `--remove-orphans`.
- Health pós-deploy: `/health ok:true`, PostgreSQL operacional OK e Redis `ready`.
- Runtime guard: dist contém `INJECTION_PHRASE_PATTERNS`, `stripPromptInjectionArtifacts()` e `normalizeForPlan()`.
- Smoke HML: `/tmp/v10_ai_deep_evaluation_hml.json`; 24 casos A-F; KB USEFUL/PARTIAL 19/24; USEFUL 3; PARTIAL 16; NOT_FOUND 5; UNSAFE 0; IA local 24/24; safety 24/24; média usefulness 4.92; Smart Help 7; cloud disabled; `quality_pass=true`.
- Segurança: scan refinado do JSON/logs limpo para segredos/PII; sem Meta API real, WhatsApp real, ação externa, autonomia real, migration/schema ou M8; produção permanece bloqueada.

---

## 29. Shadow Replay Lab Gate 0 — DPIA/Data Contract (2026-06-22)

Phase: `integaglpi_v10_shadow_replay_lab_g0_dpia_data_contract_001`.

- Status: `PACKAGE_READY_AWAITING_HUMAN_DPO`.
- Documentos: [DPIA pack](v10_shadow_replay_lab_g0_dpia_pack.md), [data contract](v10_shadow_replay_lab_data_contract.md), [tenant/retention policy](v10_shadow_replay_lab_tenant_retention_policy.md), [readiness matrix](v10_shadow_replay_lab_readiness_matrix.md).
- Escopo: docs-only; inventario estatico/read-only; nenhuma consulta a producao, nenhum export, nenhuma escrita HML, sem IA, sem deploy, sem migration/schema e sem runtime.
- Inventario: ocorrencias Shadow Replay atuais classificadas como `DOCUMENTACAO`; `integration-service/src`, `integration-service/schema-migrations` e `integaglpi/` sem runtime/schema Shadow Replay.
- Decisoes humanas pendentes: finalidade/base autorizadora, allowlist de campos, modo de correlacao, retencao, segregacao tenant, assinaturas DPO/seguranca/direcao.
- Estado factual registrado: M4-M6 executados; B1 Node `READY`; B1 PHP ainda parcial; HML Meta configurada/outbound-null nao provado; HML contem dados reais de homologacao; Shadow Replay runtime/schema inexistentes.
- Bloqueio: `construction_allowed=false`, `next_runtime_phase_allowed=false`, `migration_allowed=false`, `export_allowed=false`.

---

## 30. Shadow Replay Lab Gate 1 — PHP Reproducible Deploy: BLOCK + Reconciliação (2026-06-22)

Phase G1 deploy: `integaglpi_v10_shadow_replay_lab_g1_php_reproducible_deploy_manifest_001` → **BLOCK** (pré-escrita).
Phase reconciliação: `integaglpi_v10_shadow_replay_lab_g1_php_runtime_canonical_reconciliation_001` → **CANONICAL_RUNTIME_IDENTIFIED**.

- Documentos: [reconciliação](v10_shadow_replay_lab_g1_php_runtime_reconciliation.md), [matriz](v10_shadow_replay_lab_g1_canonical_file_matrix.json).
- **G1 deploy bloqueado** porque o webroot HML diverge do HEAD; nenhuma escrita realizada.
- **Caminho canônico:** `public_html/plugins/integaglpi` (GLPI 11.0.0); `public/plugins` é symlink → `../plugins` (sem segundo webroot ativo).
- **Divergência real (após normalizar fim de linha):** 254 comuns → 213 idênticos, **41 diff de conteúdo**, 146 só-fim-de-linha (artefato CRLF do `git archive` Windows), 7 só-webroot, 1 só-HEAD.
- **7 só-webroot = DEAD_HOTPATCH_DEBRIS** (+ 1 TEST_TOOL): nunca no Git na raiz; não byte-equivalentes às versões canônicas; classes PSR-4 não carregáveis da raiz. Excluir do artefato.
- **`src/ContractsSlaMenu.php` (só-HEAD) = NEW_UNVALIDATED_FEATURE:** introduzido em `bcefac8`, registrado pelo `setup.php` do HEAD; ausente no HML porque o `setup.php` do webroot casa com o commit v9 `b6b582b` (não o registra) → ausência **sem fatal**. Incluir ao publicar HEAD.
- **Decisão canônica:** `HEAD_IS_CANONICAL` (`6cb32e8`), **GO humano obrigatório** — publicar HEAD é upgrade real (41 arquivos + menu Contract-B SLA + remoção de debris), não normalização; exige revisão dos 41 + smoke.
- **Backups:** 10 dirs `integaglpi_*` dormentes sob `plugins/`, revalidados com `setup.php` de topo nos 10 → `GLPI_SCAN_COLLISION_RISK`; mover para fora de `plugins/` em fase de higiene própria.
- **Ownership:** plugin ativo `root:root` (anomalia); recomendado `glpie7867:glpie7867` 755/644.
- **Decisões humanas pendentes:** validar direção dos 41 diffs (nenhum fix HML-only perdido); aprovar inclusão de `ContractsSlaMenu` + exclusão dos 7 debris; aprovar upgrade v9→HEAD; higiene de backups; ownership.
- Segurança: read-only; sem escrita HML/webroot, sem deploy/backup/swap/commit, produção intocada, Node/Postgres/Redis/Docker intocados, sem migration/schema, sem Shadow Replay runtime, sem PII/credenciais; `audit_out/` não staged.
- G2 outbound-null continua pendente; construção Shadow Replay continua bloqueada.

---

## 31. Shadow Replay Lab Gate 1 — Retry deploy PHP reproduzível: BLOCK rollback (2026-06-22)

Phase: `integaglpi_v10_shadow_replay_lab_g1_php_reproducible_deploy_manifest_retry_001`.

- Status: `BLOCK_ROLLED_BACK`.
- Documentos: [relatorio retry G1](v10_shadow_replay_lab_g1_php_reproducible_deploy.md), [manifesto retry G1](v10_shadow_replay_lab_g1_deploy_manifest.json).
- Fonte limpa: `git archive 6cb32e811226b0d5dc268d90660fce7bb333ca6f:integaglpi`; tar deterministico SHA-256 `90b2a8a46bc1e21187177541070a99174f9cd4c11595a86570f53e4e123fe231`; manifesto de arquivos SHA-256 `96c1636f6d6133ed0b14cd43cb0a8dad8a95bf2331dd4d95286948db18e977d1`; `src/ContractsSlaMenu.php` presente; sete debris ausentes.
- Preflight: estrutura G0 preservada (`255/261/254`, repo-only `src/ContractsSlaMenu.php`, webroot-only `7`), mas diff LF-normalizado atual = `39`, nao `41`; drift contra a reconciliacao estrita, embora sem `HML_ONLY_ORPHAN_FIX` ou `UNKNOWN`.
- Tentativa HML: backup ativo criado em `/home/glpi.eticainformatica.com.br/backup/integaglpi_g1_20260622_154100_retry3`; 10 dirs dormentes movidos; swap atomico executado; hash pos-deploy igual ao manifesto; owner `glpie7867:glpie7867`; dirs `755`; arquivos `644`.
- Smoke bloqueou: `front/central.php` e `front/contracts.sla.php` retornaram `HTTP 500`; logs GLPI apontam excecao em `Session::checkLoginUser()` nesses fronts. O mesmo comportamento `HTTP 500` tambem existe apos rollback no plugin anterior, entao nao foi introduzido exclusivamente pelo artefato canonico.
- Rollback executado: plugin anterior restaurado com hash igual ao backup; 10 dirs dormentes restaurados sob `plugins/`; plugin canonico tentado em quarentena `failed_plugin_quarantine_20260622153730`.
- Estado final: G1 PHP/B1 continua `false`; G2 outbound-null continua bloqueado; Shadow Replay runtime/schema continuam inexistentes; producao, Node, Docker, PostgreSQL, Redis, migrations, Meta, WhatsApp e IA intocados.

---

## 32. Shadow Replay Lab Gate 1 — Adjudicação do BLOCK e baseline semântico (2026-06-22)

Phase: `integaglpi_v10_shadow_replay_lab_g1_retry_block_adjudication_001`.

- Status: `G1_RETRY_READY`.
- Documentos: [adjudicação](v10_shadow_replay_lab_g1_retry_block_adjudication.md), [baseline semântico](v10_shadow_replay_lab_g1_semantic_diff_baseline.json).
- Pós-rollback: plugin ativo restaurado e hash igual ao backup `retry3`; 10 dirs `integaglpi_*` dormentes restaurados; sem staging/quarentena em `plugins/`; Node `/health ok:true`; produção intocada.
- `41 -> 39`: explicado por `LINE_ENDING_NORMALIZATION_DIFFERENCE` em `src/External/Repository/ConversationRepository.php` e `src/Service/SecurityPermissionService.php`; hashes LF iguais entre Git e HML; sem `LIVE_HML_UNREVIEWED_CHANGE` e sem `UNKNOWN_BLOCKING`.
- Baseline futuro: validar conjunto semântico path+hash LF em `docs/v10_shadow_replay_lab_g1_semantic_diff_baseline.json`; contagem isolada passa a ser informativa.
- Rotas protegidas: `front/central.php` e `front/contracts.sla.php` retornam `HTTP 500` no plugin restaurado, com body hash idêntico e sem conteúdo protegido; logs sanitizados apontam `Session::checkLoginUser()`; classificado como `PREEXISTING_UNAUTHENTICATED_SESSION_BASELINE`.
- Modelo de smoke futuro: baseline-aware para rotas protegidas sem sessão; falha só se expuser conteúdo, ficar menos seguro que baseline ou surgir fatal/autoload/include/syntax novo. Smoke autenticado permanece `AUTHENTICATED_HTTP_NOT_AVAILABLE` sem harness aprovado.
- Candidato offline: validado com `/usr/local/lsws/lsphp83/bin/php` (`PHP 8.3.30`); lint 0 falhas; `setup.php`/`hook.php` parse PASS; `ContractsSlaMenu` presente, referenciado e carregável em contexto controlado; sete debris/root reply/env ausentes; hash do artefato preservado.
- Gates: `g1_retry_allowed=true`; `g1_php_b1_ready=false` até retry deploy 002 passar; G2 outbound-null e construção Shadow Replay continuam bloqueados.
- Segurança: fase read-only HML; sem deploy, webroot write, backup novo, chown/chmod, restart, Docker, Node change, PostgreSQL/Redis write, migration/schema, Meta/WhatsApp/IA, produção ou commit.

---

## 33. Shadow Replay Lab Gate 1 — Retry 002 PHP reproduzível HML PASS (2026-06-22)

Phase: `integaglpi_v10_shadow_replay_lab_g1_php_reproducible_deploy_manifest_retry_002`.

- Status: `HML_PASS`.
- Documentos: [relatório G1](v10_shadow_replay_lab_g1_php_reproducible_deploy.md), [manifesto G1](v10_shadow_replay_lab_g1_deploy_manifest.json).
- Fonte canônica: `6cb32e811226b0d5dc268d90660fce7bb333ca6f:integaglpi`; evidência/adjudicação: `abebd78`.
- Baseline semântico: `39` diferenças LF-normalizadas, `7` webroot-only excluídos, `1` repo-only incluído (`src/ContractsSlaMenu.php`), zero `LIVE_HML_UNREVIEWED_CHANGE`, zero `UNKNOWN`.
- Artefato: `253` arquivos runtime; tar determinístico SHA-256 `a6851f3ccfa7fb9be5befa3e3df9b07010346f226b5d74b0bb1692310636da6a`; manifesto por arquivo SHA-256 `96c1636f6d6133ed0b14cd43cb0a8dad8a95bf2331dd4d95286948db18e977d1`.
- Deploy HML: staging `/home/glpi.eticainformatica.com.br/deploy_staging/integaglpi_g1_retry002_20260622_163005`; backup `/home/glpi.eticainformatica.com.br/backup/integaglpi_g1_retry002_20260622_163005`; swap atômico concluído; owner `glpie7867:glpie7867`; diretórios `755`; arquivos `644`.
- Higiene: 10 diretórios `integaglpi_*` dormentes movidos para `backup/.../dormant_plugin_copies/`; zero diretórios dormentes restantes sob `plugins/`; sete debris ausentes; root `ticket.whatsapp.reply.php` ausente; `front/ticket.whatsapp.reply.php` presente.
- Protected routes baseline-aware: `front/central.php` e `front/contracts.sla.php` mantiveram `HTTP 500` pré-existente com body hash idêntico `8fb39446777baac5c4033177e6d0301b256dae7ee3dcc80bd70c2d782661bbb8`, sem conteúdo protegido e sem novo fatal; smoke autenticado segue `AUTHENTICATED_HTTP_NOT_AVAILABLE` sem harness aprovado.
- Smoke S01-S10: `PASS`; `ContractsSlaMenu` carregável em harness PHP 8.3 e registrado em `setup.php`; GLPI home `HTTP 200`; Node `/health ok:true`; PostgreSQL accepting connections; Redis `PONG`; plugin fatal recente `0`.
- Rollback final: não requerido e não executado; tentativas intermediárias do retry 002 que falharam por harness/validação operacional foram rollbackadas antes do sucesso final.
- Gates: `g1_php_b1_ready=true`; `g2_outbound_null_ready=false`; `shadow_replay_construction_allowed=false`.
- Segurança: produção intocada; sem Node/Docker change, sem PostgreSQL/Redis write, sem migration/schema, sem G2, sem Shadow Replay runtime/schema, sem Meta/WhatsApp/IA, sem PII/credenciais; `audit_out/` não staged.

---

## 34. Shadow Replay Lab Gate 2 — Outbound-Null Isolation (2026-06-22)

Phase: `integaglpi_v10_shadow_replay_lab_g2_outbound_null_isolation_001`.

- Status: **G2 `IMPLEMENTED_LOCAL_PENDING_CURSOR`** (`IMPLEMENTED_NOT_HML_PROVEN`); G1 PHP B1 `READY` (commit docs `128d529`).
- Documento: [G2 isolation](v10_shadow_replay_lab_g2_outbound_null_isolation.md).
- Perfil de build/runtime dedicado, isolado **por construção** (não por flag): composition root próprio que não importa a wiring operacional nem adapters reais; só null adapters.
- Null adapters para todos os side-effects (WhatsApp/Meta, e-mail, LogMeIn, GLPI mutation, cloud AI/external research, ação externa): cada operação retorna `BLOCKED_BY_SHADOW_REPLAY_ISOLATION`, sem I/O, só hash de descritor em memória, sem payload bruto.
- Kill switch fail-closed: `SHADOW_LAB_MODE` deve ser exatamente `true`; ausente/falso/inválido/produção/non-HML/env banida → processo encerra non-zero.
- Build separado `tsconfig.shadow-replay.json` → `dist-shadow-replay` (removeComments, noEmitOnError); Dockerfile dedicado non-root/read-only/sem credenciais/sem portas; compose `internal: true`/`read_only`/`cap_drop ALL`/`no-new-privileges`/`restart: no`/profile explícito.
- Testes: `v10ShadowReplayOutboundNullIsolation.test.ts` 34/34 PASS; smoke `all_pass=true`; `tsc --noEmit` e `tsc -p tsconfig.shadow-replay.json` PASS; regressão V10 190/190; compose YAML válido. `docker build`/`compose config` NOT_AVAILABLE (Docker ausente local).
- Operacional intocado: `buildDependencies.ts`, webhook/inbound/outbound, Meta/GLPI adapters reais, M5/M6 sem alteração; `integaglpi/**`/schema-migrations/`.env` sem diff.
- Segurança: sem deploy HML, sem commit (esta fase), sem PostgreSQL/Redis, sem migration/schema, sem Shadow Store/ingest/exporter/replay/backfill/live-tee, sem Meta/WhatsApp/e-mail/LogMeIn/cloud/HTTP externo, sem mutação GLPI, sem produção, sem PII/credenciais; `audit_out/` não staged.
- G2 só `READY` após Cursor review + commit + smoke HML. Construção Shadow Replay continua bloqueada (`shadow_replay_construction_allowed=false`).

### G2 FIX (cursor review) — 2026-06-22

Phase: `integaglpi_v10_shadow_replay_lab_g2_outbound_null_isolation_fix_001`.

- Status mantido: **G2 `IMPLEMENTED_LOCAL_PENDING_CURSOR`** (`IMPLEMENTED_NOT_HML_PROVEN` quanto a deploy; build/run isolado provado em HML temp).
- Compatibilidade type-only com contratos reais: prova `import type` + `Pick<>`/`expectTypeOf` no teste (vitest `--typecheck` → `no errors`); falha no tsc se método real mudar. Seis superfícies reconciliadas (cinco classes reais + e-mail/ação-genérica sem classe dedicada = null defensivo). Prova fora de `src/shadowReplay` para não poluir o build isolado (rootDir).
- `.dockerignore` dedicado por Dockerfile (`Dockerfile.shadow-replay.dockerignore`): deny-all + allowlist mínima; não altera o `.dockerignore` global/operacional.
- Prova Docker HML (temp, sem deploy): build OK; imagem non-root (`node`), sem portas, sem módulos operacionais; `run --network none` com flag → `ok:true` exit 0; sem flag → exit 1; env banida → exit 1; containers operacionais intocados; imagem/temp removidos.
- Testes: G2 41/41 (normal) + vitest typecheck `no errors`; regressão V10 190/190; `tsc --noEmit` e `tsc -p tsconfig.shadow-replay.json` PASS; `dist-shadow-replay/` removido ao final.
- Ressalva: `compose config` não validável em HML (docker-compose v1.25.0, pré-`profiles`); compose validado local (YAML+contrato) e isolamento provado por build/run direto.
- Workspace: roadmap/`.vs`/`audit_out`/untracked intocados (hash do roadmap idêntico); sem `git clean` amplo; sem stage/commit; operacional/`buildDependencies`/`integaglpi`/schema/`.env` sem diff; produção intocada. Shadow Replay construction continua bloqueada.

### G2 FIX 002 (cursor review 002) — 2026-06-22

Phase: `integaglpi_v10_shadow_replay_lab_g2_outbound_null_isolation_fix_002`.

- Status: **G2 `FIXED_PENDING_CURSOR_003`** (`g2_outbound_null_ready=false`; construction bloqueada).
- Substituibilidade real: null boundaries viraram classes de adapter com nomes de método reais e `Promise<never>` que rejeita com `ShadowReplayBlockedError` (code BLOCKED). Prova de **assinatura integral** via atribuição `Pick<RealClass, método> = new NullAdapter()` (vitest `--typecheck` → no errors); `toHaveProperty` removido como prova principal. E-mail e ação genérica = defensive-only (sem port real).
- Build reproduzível: Dockerfile usa `COPY package.json package-lock.json` + `npm ci --ignore-scripts` (sem `npm install typescript`); package-lock.json é gitignored mas presente no workspace (input read-only).
- Dockerfile-specific ignore exercitado em **contexto COMPLETO** (107 arquivos operacionais + 5 canários): conteúdo do ignore filtrou tudo → contexto recebido = só 9 allowlisted (`leaked_forbidden=0`). NÃO houve simulação com contexto pré-minimizado.
- Prova Docker HML real (full context, npm ci): build OK; imagem non-root (`node`), sem portas, sem canários/módulos operacionais, sem node_modules; run matrix endurecido — safe `ok:true`/exit 0; missing/invalid/production/banned exit 1; containers operacionais intocados; imagem/temp removidos.
- Ressalva: HML sem `buildx` (BuildKit) → nomeação `<Dockerfile>.dockerignore` não exercitável como-nomeada no HML; conteúdo provado via builder clássico (`.dockerignore` temporário descartável); compose v1.25 `NOT_VALIDATABLE`; runbook oficial HML = `docker run` endurecido one-shot.
- Higiene: trabalho isolado por worktree detached para o contexto da prova; `roadmap`/`.vs`/`audit_out` intocados; `dist-shadow-replay/` removido; sem stage/commit; operacional/`buildDependencies`/adapters/`integaglpi`/schema/`.env` sem diff; produção intocada.
- Testes: G2 35/35 + vitest typecheck no errors; regressão V10 196/196; `tsc --noEmit` e shadow tsc PASS. Pendente Cursor review 003.

### G2 FIX 003 (cursor review 003) — 2026-06-22

Phase: `integaglpi_v10_shadow_replay_lab_g2_outbound_null_isolation_fix_003`.

- Status: **G2 `FIXED_PENDING_CURSOR_004`** (`g2_outbound_null_ready=false`; construction bloqueada).
- B1 lockfile: `.gitignore` ganhou exceção escopada `!integration-service/package-lock.json` (outros lockfiles seguem ignorados); `git check-ignore` → não ignorado; candidato `??`. lockfileVersion 3; sha256 `4ad178ac…`; scan sem segredo/dep local; registry único npmjs. Será versionado no mesmo commit G2.
- Reprodutibilidade: árvore candidata via alternate index (índice principal vazio), sem roadmap/audit_out/.vs/arquivos de outras fases; o valor de hash da árvore candidata foi removido do ledger porque docs/ledger pertencem à própria árvore medida e persistir esse valor aqui torna a evidência autorreferente. Extração limpa → `npm ci` 365 pacotes exit 0, `tsc -p tsconfig.shadow-replay.json` PASS, `vitest --typecheck` no errors, sem overlay local.
- B2 assinatura exata: factory genérico `shadowReplayNullMethod<F>` (sem import operacional) ligado aos contratos reais no teste prova `Equal<Parameters>`/`Equal<ReturnType>` exatos (Meta send×3, OutboundMessageService.send, GlpiClient.createTicket/createRestrictedRequesterUser, ExternalResearchService.researchDynamic, LogmeinAlarmEngineService.runOnce) + negativos não-vacuosos; `Pick<>` isolado não bastava; sem casts inseguros. `vitest --typecheck` → no errors (quebra se contrato real mudar).
- Docker da árvore candidata (full context, ignore dedicado como `.dockerignore` temporário, npm ci): canary audit `leaked_forbidden=0`; build OK; imagem non-root/sem portas/sem canário/sem node_modules; matriz safe=0 / missing,invalid,production,banned=1; containers operacionais intocados; imagem/temp removidos.
- Ressalvas honestas: HML sem buildx → nomeação `<Dockerfile>.dockerignore` não exercitável (só conteúdo); compose v1.25 NOT_VALIDATABLE; lockfile preparado, não commitado.
- Higiene: edição limitada à allowlist; alternate index para a árvore candidata; índice principal vazio; `roadmap`/`.vs`/`audit_out` intocados; `dist-shadow-replay/` removido; sem stage/commit; operacional/`buildDependencies`/adapters/`integaglpi`/schema/`.env` sem diff; produção intocada. Testes: G2 37/37 + typecheck no errors; regressão V10 PASS. Pendente Cursor review 004.

### G2 FIX 004 (cursor review 004) — 2026-06-22

Phase: `integaglpi_v10_shadow_replay_lab_g2_outbound_null_isolation_fix_004`.

- Status: **G2 `FIXED_PENDING_CURSOR_005`** (`g2_outbound_null_ready=false`; construction bloqueada).
- Worktree real: `D:/Integracao GLPI Whats.g2-fix004-worktree` (detached `@128d529`); diff = 15 paths allowlist; stage vazio; roadmap do workspace principal **excluído** do candidato (dirty preservado unstaged fora da fase).
- Runtime: todos os métodos públicos dos adapters do composition root via `shadowReplayNullMethod` (8 Meta send + outbound + glpi×2 + research + logmein); e-mail/ação genérica = defensive-only.
- Typecheck: prova sobre `ReturnType<typeof createNullOutboundBoundary>`; cast duplo removido; `vitest --typecheck` no errors.
- Lockfile: exceção `.gitignore` mantida; sha256 `4ad178ac6b0dfaa175493b645e83750e43e0f501ec391df4924b6b756a05b600`; `npm ci` PASS.
- Regressão: **190/190** PASS.
- Docker renovado pós-runtime: `FULL_CANDIDATE_TREE_WITH_TEMP_CLASSIC_IGNORE_CONTENT_COPY`; named ignore=false; compose v1.25 NOT_VALIDATABLE.
- `dist-shadow-replay/` ignorado e removido; sem commit/deploy; produção intocada.

### G2 FIX 006 (hash/evidência canônica) — 2026-06-22

Phase: `integaglpi_v10_shadow_replay_lab_g2_outbound_null_isolation_fix_006`.

- Status: **G2 `READY_AFTER_HASH_RECONCILIATION_DOC_COMMIT`** (`g2_outbound_null_ready=true`; construction bloqueada).
- Algoritmo canônico versionado: `integration-service/scripts/v10ShadowReplayBuildSubsetHash.mjs`, `g2_build_subset_hash_v1`, raiz por paths POSIX relativos ao projeto, arquivos ordenados, bytes reais, `sha256`+`size_bytes` por arquivo, JSON canônico UTF-8/LF; sem `.env`, rede, docs, tests, dist, node_modules ou fonte operacional.
- Build subset congelado: `build_subset_hash=04727b9a9919b9b1a1496a286323d4db68cb4d3fbb5ec17f9fc36dc0e3f99054`; local e HML calcularam o mesmo valor com o mesmo script sobre bytes de `git archive`/HML Linux. Subset = package/package-lock/tsconfig/shadow tsconfig/Dockerfile/ignore dedicado/`src/shadowReplay/**`.
- Hash anterior `baafb11eb04a956eeaca0d0e332e115c21772f79b0c63bcc49bca093c467f25f` fica `STALE` por ter sido calculado em checkout Windows com CRLF. Hashes mais antigos de build subset (`5a68…`, `b661…`, `122b…`, `0340…`) continuam superseded por terem sido gerados com algoritmos, raízes ou manifestos diferentes; não são estado atual.
- Prova Docker renovada com `MINIMAL_BUILD_SUBSET_TAR`: tar sha256 `cdf605ca04f2ab91f44a27debf39caee91e8809756d2353c3affd222c2541383`; HML recomputou o subset antes do build; build PASS; imagem non-root/sem portas/sem `/app/src`/sem node_modules; matriz safe=0, missing/invalid/production/banned=non-zero; containers operacionais intocados; temporários removidos.
- `named_ignore_exercised=false`; `full_context_ignore_exercised=false`; a nomeação `<Dockerfile>.dockerignore` não foi exercitada no builder legado HML e full-context ignore/canary não é a prova principal deste smoke.
- Hash final da árvore candidata não é persistido no ledger para evitar autorreferência; deve aparecer apenas no JSON de fase/revisão e evidência de commit.
- Sem deploy HML, sem produção, sem migration/schema, sem PostgreSQL/Redis, sem Shadow Store/ingest/exporter/outbox/replay worker/live tee, sem Meta/WhatsApp/e-mail/LogMeIn/cloud real, sem mutação GLPI.
