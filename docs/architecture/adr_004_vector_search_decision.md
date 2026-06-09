# ADR-004 — Decisão de Busca Vetorial: KEEP_CURRENT_SEARCH

**Status:** Accepted
**Date:** 2026-06-09
**Phase:** integaglpi_v9_vector_search_gate_001
**Deciders:** Arquitetura IntegraGLPI
**Reviewed by:** Cursor (gate F7)

---

## Contexto

O sistema de busca KB do IntegraGLPI usa atualmente:
- **FTS (Full-Text Search)** PostgreSQL com tsvector/tsquery
- **Search Planner** (`KbSearchPlannerService`) para orquestração e scoring de intenção
- **KB Ranking** (`KbRankingService`) com multiplier por feedback Laplace-smoothed
- **KB Reranker** (`KbRerankerService`) com cross-encoder Ollama local (opcional, RERANKER_ENABLED=false por padrão)

A questão avaliada neste ADR é: **vale adotar busca vetorial (embeddings + similarity search) como substituto ou complemento ao stack atual?**

---

## Opções Avaliadas

### Opção A: pgvector (PostgreSQL extension)
- Adiciona extensão pgvector ao PostgreSQL existente.
- Requer migration + embedding de todos os artigos KB existentes.
- Embeddings gerados via Ollama local ou cloud API.
- Similarity search (`<->`, `<=>`, `<#>`) substituiria/complementaria tsvector.

### Opção B: Qdrant / Weaviate (banco vetorial dedicado)
- Serviço externo ou container dedicado ao vector DB.
- Requer connector Node.js + sincronização unilateral de artigos KB.
- Infra nova, dependency nova, dado replicado fora do PostgreSQL principal.

### Opção C: Cloud Embeddings (OpenAI text-embedding, Cohere, etc.)
- API externa para geração de embeddings por consulta/artigo.
- Requer DPO + direção + admin + incidentAck + auditoria LGPD.
- Todo texto de consulta (contexto técnico sanitizado) vai para cloud.

### Opção D: KEEP_CURRENT_SEARCH (stack atual preservado)
- FTS + Search Planner + KB Ranking + KB Reranker.
- Zero custo de infra novo, zero risco de migration, zero dependência externa nova.
- Cross-encoder Ollama local como camada opcional de re-ranking.

---

## Baseline Atual (docs/eval_reports/baseline.json)

```json
{
  "product_detection_rate": 0.86,
  "tier_coverage_rate": 1.0,
  "total_queries": 50
}
```

**Interpretação:**
- `product_detection_rate = 0.86`: 86% das 50 consultas de avaliação identificaram corretamente o produto/sistema alvo.
- `tier_coverage_rate = 1.0`: 100% das tier-1 e tier-2 (categorias críticas) foram cobertas por ao menos um artigo relevante.
- Amostra de 50 consultas é representativa para o volume atual de uso assistivo KB.

> **NOTA CRÍTICA:** `baseline.json` NUNCA é modificado por automação.
> Atualização exige commit manual revisado após smoke HML aprovado e aprovação Cursor.

---

## Análise por Opção

### Opção A — pgvector
**Prós:**
- Sem novo serviço externo; usa PostgreSQL existente.
- Potencial melhoria de recall semântico para termos técnicos raros.

**Contras:**
- Requer migration + nova coluna/índice em tabela KB.
- Embedding de todos os artigos: custo de inferência Ollama em batch (lento para >1000 artigos).
- Ganho projetado: estimativa +0.02–0.05 em product_detection (dentro da margem de ruído para N=50).
- Manutenção: embedding deve ser re-gerado a cada artigo novo/atualizado.
- Risco de regressão se modelo de embedding mudar (incompatibilidade de espaço vetorial).
- Gate alto: infra + migration + smoke + Cursor review.

**Veredicto:** Custo/benefício desfavorável no volume atual. Não justificado agora.

### Opção B — Qdrant
**Prós:**
- Busca vetorial especializada, HNSW index, latência baixa.

**Contras:**
- Novo container/serviço na stack — dependency externa nova.
- Dado replicado (artigos KB fora do PostgreSQL principal).
- Sincronização bidirecional complexa (GLPI MariaDB → PostgreSQL → Qdrant).
- Node nunca acessa MariaDB: a cadeia de sync aumentaria risco arquitetural.
- Gate máximo: infra + segurança + Cursor + aprovação de dados.

**Veredicto:** BLOQUEADO. Infra desnecessária, risco alto, sem ROI justificado.

### Opção C — Cloud Embeddings
**Prós:**
- Embeddings de alta qualidade (modelos grandes).

**Contras:**
- Dados técnicos sanitizados ainda saem para API externa.
- Exige DPO + direção + admin + incidentAck — gate máximo.
- Custo recorrente por consulta.
- LGPD: risco residual mesmo com sanitização.
- Viola o princípio `no_cloud_default`.

**Veredicto:** BLOQUEADO. Sem aprovação DPO + direção, é proibido.

### Opção D — KEEP_CURRENT_SEARCH ✓ (ESCOLHIDA)
**Prós:**
- Baseline atual suficiente: product_detection=0.86, tier_coverage=1.0.
- Zero migration, zero infra nova, zero dependency externa nova.
- Stack auditada, entendida, com fallback determinístico.
- KB Reranker (Ollama cross-encoder) já disponível como camada opcional futura.
- Nenhum dado sai para cloud.

**Contras:**
- Recall semântico limitado para termos técnicos com variantes ortográficas.
- FTS depende de quality de tsvector e INTENT_BOOST_TERMS manuais.

**Veredicto:** APROVADO. Melhorias marginais não justificam o custo e risco das alternativas.

---

## Decisão

**KEEP_CURRENT_SEARCH**

O stack FTS + Search Planner + KB Ranking + KB Reranker é suficiente para o volume e qualidade atuais de uso. Pgvector, Qdrant e cloud embeddings ficam bloqueados até que:

1. `product_detection_rate` caia abaixo de 0.75 em smoke HML com N≥100 consultas, **E**
2. Um gap específico seja identificado que FTS + Reranker não resolve, **E**
3. Gate completo (infra + DPO se cloud + Cursor review + commit manual) seja aprovado.

---

## Consequências

### Positivas
- Nenhuma migration de schema.
- Nenhum serviço externo novo.
- Custo de manutenção zero incremental.
- LGPD: nenhum dado novo sai do perímetro.

### Negativas / Aceitas
- Recall semântico limitado para sinônimos raros.
- Dependência de INTENT_BOOST_TERMS bem mantidos.

### Restrições Técnicas (Absolutas)
- `no_pgvector_install: true` — nenhum `CREATE EXTENSION vector` sem gate aprovado.
- `no_qdrant: true` — nenhum container Qdrant/Weaviate.
- `no_cloud_embeddings: true` — sem DPO + direção + admin + incidentAck.
- `baseline.json` NUNCA é auto-modificado.
- Revisão desta decisão exige smoke HML + N≥100 + commit manual.

---

## Referências

- `docs/eval_reports/baseline.json` — métricas atuais (não auto-modificar)
- `docs/eval_reports/vector_search_gate_2026-06-09.md` — relatório de avaliação detalhado
- `docs/feature_flags_matrix.md` — seção V9 F7
- `integration-service/tests/vectorSearchGateStatic.test.ts` — testes estáticos de gate
- ADR-001: LogMeIn read-only (análogo em design conservador)
- ADR-002: Cloud Pilot gate (LGPD)
- ADR-003: KB Quality Pipeline (ranking não-punitivo)
