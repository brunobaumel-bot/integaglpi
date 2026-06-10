# Roadmap V9 — Ressalvas de Fechamento (registro formal)

PHASE: `integaglpi_v9_closure_ressalvas_cleanup_001` — Updated: 2026-06-10

Este documento registra as ressalvas técnicas aceitas no fechamento do Roadmap V9,
seu tratamento e o que permanece como obrigação operacional. **Não existe Fase 8**:
itens remanescentes são manutenção/backlog, nunca fase nova do V9.

---

## R1 — Workspace fora de escopo (RESOLVIDA)

- `SmartHelpService.php` e `KbSearchPlannerService.ts` apareciam modificados fora de
  escopo desde o Gate 0. As alterações originais foram preservadas em
  `stash@{0}: pre-v9-hml-close-out-of-scope-local-files` e **nunca entraram em commit**.
- As mudanças legítimas equivalentes (D11) foram reimplementadas e revisadas dentro da
  fase `integaglpi_v9_hml_operational_defects_fix_001` (commit `912a825`).
- `docs/eval_reports/ragas_2026-06-09.json` e `reranker_benchmark_2026-06-09.json`
  permanecem **untracked por decisão**: são artefatos de avaliação da Fase 2A e não
  entram em commit/deploy sem autorização explícita.

## R2 — Flags V9 fora do env tipado (RESOLVIDA)

As 4 flags V9 agora são tipadas em `integration-service/src/config/env.ts`
(zod, default `false`, transform booleano), e os serviços consomem `env.<FLAG>`:

| Flag | Default | Consumidor |
| --- | --- | --- |
| `CENTRAL_HUB_ENABLED` | `false` | `CentralHubAggregatorService` |
| `ALARM_CORRELATION_ENABLED` | `false` | `LogmeinAlarmCorrelationService` |
| `CONTROLLED_AUTOMATION_ENABLED` | `false` | `ControlledAutomationService` |
| `INVENTORY_RECONCILIATION_ENABLED` | `false` | `LogmeinAssetMatchingService` |

Nenhuma flag foi ativada. Ativação exige gate humano + smoke HML (ver
`docs/feature_flags_matrix.md`).

## R3 — Guard do menu Central Hub (RESOLVIDA)

O item `central_hub` do `SupervisaoGroupMenu` agora é adicionado somente quando
`CentralHubMenu::canView()` (== `Plugin::canSupervisorRead()`) — o mesmo predicado
que a página `front/central_hub.php` impõe via `Plugin::requireSupervisorRead()`.
Antes, o item ficava visível para perfis que a página depois bloqueava.

## R4 — phpSolutionNotificationStatic (RESOLVIDA)

A falha era **ambiental, não funcional**: a expectativa estática usava `\n` literal
e o checkout Windows materializa os PHP com CRLF. A asserção foi tornada agnóstica
a line-ending (`\r?\n`). Nenhuma regra de notificação foi alterada; nenhum WhatsApp
real é exercitado pelo teste (asserções estáticas sobre o fonte).

## R5 — Exceção procedural: commit multi-fase 591cf49 (REGISTRADA)

O commit `591cf49` agrupou o fechamento das ressalvas F2B, a Fase 4 (Alarm
Correlation) e a Fase 5 (Controlled Automation) num único changeset. O Cursor
classificou a quebra de gate como **procedural, não material** (F5 é advisory-only,
sem dependência funcional de F4; F4 foi aprovada na mesma auditoria) e aceitou com
ressalva. **Regra daqui em diante: 1 fase = 1 commit.** Commits multi-fase não são
padrão e exigirão BLOCK em auditorias futuras, salvo exceção explícita pré-acordada.

## Obrigações operacionais remanescentes (não bloqueiam código)

1. **Smoke HML visual/runtime contínuo**: validações de UI (menu LogMeIn persistente,
   picker de alvos de alarme, resumo multi-problema do Smart Help, Central Hub por
   perfil) exigem operador humano logado no GLPI HML.
2. **Produção permanece BLOQUEADA**: promoção exige gate humano + smoke HML completo
   + aprovação Cursor. Deploy sempre manual.
3. **Disco HML ~87%**: agendar limpeza de imagens docker antigas (nunca
   `docker system prune -a`).
4. **Backlog pós-V9** (manutenção, sem Fase 8): curto-circuito opcional dos serviços
   F4/F6 com flag false; limpeza cosmética `buildReason`; reavaliação de vector
   search somente pelos critérios do ADR-004.
