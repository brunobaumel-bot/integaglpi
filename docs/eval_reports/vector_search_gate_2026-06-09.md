# Vector Search Gate — Relatório de Avaliação

**Data:** 2026-06-09
**Phase:** integaglpi_v9_vector_search_gate_001
**Decisão:** KEEP_CURRENT_SEARCH
**ADR:** docs/architecture/adr_004_vector_search_decision.md

---

## Resumo Executivo

A avaliação do gate vetorial foi concluída. O stack atual de busca KB (FTS + Search Planner + KB Ranking + KB Reranker) atinge métricas satisfatórias para o volume atual. A adoção de pgvector, Qdrant ou embeddings cloud não é justificada neste momento.

**Decisão:** KEEP_CURRENT_SEARCH — nenhuma ação de instalação/migração autorizada.

---

## Baseline de Métricas (baseline.json — NÃO AUTO-MODIFICAR)

| Métrica | Valor | Interpretação |
| --- | --- | --- |
| `product_detection_rate` | **0.86** | 86% das consultas identificam produto/sistema corretamente |
| `tier_coverage_rate` | **1.0** | 100% das categorias tier-1/tier-2 cobertas |
| `total_queries` | **50** | Tamanho da amostra de avaliação |

> Baseline gerado e versionado manualmente. Qualquer atualização exige commit manual revisado após smoke HML aprovado.

---

## Avaliação de Alternativas

### 1. pgvector (PostgreSQL extension)

| Critério | Avaliação |
| --- | --- |
| Ganho projetado | +0.02–0.05 em product_detection (estimativa; dentro da margem de ruído para N=50) |
| Custo de implementação | Alto: migration, embedding batch, index HNSW, manutenção contínua |
| Risco de regressão | Médio: mudança de modelo de embedding quebra espaço vetorial existente |
| Gate necessário | Infra + Cursor review + smoke + migration aprovada |
| Decisão | **NÃO JUSTIFICADO agora** |

Critério de reavaliação: product_detection < 0.75 em smoke HML com N≥100 E gap identificado que FTS não resolve.

### 2. Qdrant / Weaviate (vector DB dedicado)

| Critério | Avaliação |
| --- | --- |
| Ganho projetado | Similar ao pgvector; latência potencialmente menor |
| Custo de implementação | Muito alto: novo serviço, sincronização, infra adicional |
| Risco arquitetural | Alto: dado replicado fora do PostgreSQL principal; sync Node → MariaDB proibido |
| Gate necessário | Máximo: infra + segurança + Cursor + dados |
| Decisão | **BLOQUEADO** |

### 3. Cloud Embeddings (OpenAI, Cohere, etc.)

| Critério | Avaliação |
| --- | --- |
| Qualidade de embedding | Alta (modelos grandes) |
| Custo operacional | Recorrente por consulta |
| Risco LGPD | Alto: dados técnicos saem do perímetro mesmo sanitizados |
| Gate necessário | DPO + direção + admin + incidentAck (gate máximo) |
| Decisão | **BLOQUEADO — sem aprovação DPO + direção** |

### 4. KEEP_CURRENT_SEARCH (escolhida)

| Critério | Avaliação |
| --- | --- |
| Baseline atual | product_detection=0.86, tier_coverage=1.0 — SATISFATÓRIO |
| Custo incremental | Zero |
| Risco | Zero (sem nova infra, sem migration, sem dependência externa) |
| Melhorias futuras disponíveis | KB Reranker Ollama (RERANKER_ENABLED=false, disponível sob gate) |
| Decisão | **APROVADO — DECISÃO FINAL** |

---

## Stack Atual — Inventário

| Componente | Arquivo | Status |
| --- | --- | --- |
| FTS PostgreSQL | PostgreSQL nativo | Ativo |
| KbSearchPlannerService | integration-service/src/domain/services/KbSearchPlannerService.ts | Ativo |
| KbRankingService | integration-service/src/domain/services/KbRankingService.ts | Ativo (FEEDBACK_RANKING_ENABLED=false default) |
| KbRerankerService | integration-service/src/domain/services/KbRerankerService.ts | Disponível (RERANKER_ENABLED=false default) |
| SmartHelpService | integaglpi/src/Service/SmartHelpService.php | Ativo |

---

## Restrições Técnicas Absolutas (hardcoded neste gate)

```
no_pgvector_install: true
  → Proibido CREATE EXTENSION vector sem gate completo aprovado.

no_qdrant: true
  → Proibido container Qdrant, Weaviate ou qualquer vector DB dedicado.

no_cloud_embeddings: true
  → Proibido embedding via OpenAI, Cohere, Anthropic ou qualquer API externa
    sem DPO + direção + admin + incidentAck.

baseline_no_auto_modify: true
  → docs/eval_reports/baseline.json NUNCA é modificado por automação.
    Atualização exige commit manual revisado após smoke HML aprovado.

documentation_decision_only: true
  → Este gate é documentação de decisão, não feature operacional.
    Nenhuma flag de runtime é introduzida.
```

---

## Critérios para Reavaliação

A decisão KEEP_CURRENT_SEARCH pode ser revisada somente quando **TODOS** os critérios abaixo forem atendidos simultaneamente:

1. `product_detection_rate < 0.75` em smoke HML com N≥100 consultas reais.
2. Um gap específico identificado e documentado que FTS + KbSearchPlanner + KbReranker não resolve.
3. Gate completo aprovado:
   - pgvector: infra + migration + Cursor review + smoke HML verde.
   - cloud embeddings: DPO + direção + admin + incidentAck + PII Guard + audit.
   - Qdrant: infra + segurança + dados + Cursor review.
4. `baseline.json` atualizado via commit manual revisado após smoke HML aprovado.

---

## Teste Estático de Gate

Testes que bloqueiam instalação de pgvector/qdrant/cloud embeddings:
- `integration-service/tests/vectorSearchGateStatic.test.ts`

Estes testes verificam:
- Ausência de imports `pgvector`, `qdrant-client`, `@qdrant/js-client-rest`, `openai` em arquivos de KB search.
- Ausência de `CREATE EXTENSION vector` em scripts de migration.
- Ausência de `cloud_embeddings_enabled: true` hardcoded.
- Presença do campo `product_detection_rate` em `baseline.json`.
- Presença do campo `tier_coverage_rate` em `baseline.json`.

---

## Histórico de Decisão

| Data | Decisão | Motivo |
| --- | --- | --- |
| 2026-06-09 | KEEP_CURRENT_SEARCH | Baseline satisfatório (0.86/1.0); custo/risco de alternativas não justificado |
