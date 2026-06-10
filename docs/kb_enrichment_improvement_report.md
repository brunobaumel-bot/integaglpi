# Relatório — Enriquecimento de KB e Melhorias Futuras

PHASE: `integaglpi_v9_kb_enrichment_and_search_optimization_001` (adendo de aplicação autorizada)
Data: 2026-06-10 · Autorização do operador para migration 052 + aplicação real registrada nesta data.

---

## 1. O que está implantado agora

| Capacidade | Estado | Como usar |
| --- | --- | --- |
| Enriquecimento real dos KBs existentes (IA local melhora sintomas, causas, passos, validação, triagem, rollback, prevenção e contexto) | ATIVO via CLI | `node dist/kbEnrichment/cli.js --limit N --apply` (com `KB_ENRICHMENT_ENABLED=true` no processo) |
| Backup automático + rollback por candidato | ATIVO | original completo em `structured_draft_json.original_backup`; `--rollback <id>` reverte |
| Rastreabilidade | ATIVO | `source_kb_id`, `original_hash`, `enriched_hash`, `enrichment_version`, `enriched_at` (migration 052) |
| Criação de candidatos por lacuna (gap analysis) | ATIVO via CLI | `--gaps --window-days 30` → `draft_gap_candidate` (nunca aparece na busca local; revisão humana) |
| Resposta customizada ao técnico baseada em KB | ATIVO (flag) | `CUSTOM_RESPONSE_ENABLED=true`; gate < 0.60 nunca chama Ollama |
| Busca local por problema + anti-falso-positivo produto-cruzado | ATIVO | sem flag (determinístico) |
| Dry-run seguro | ATIVO | `--dry-run` gera drafts sem gravar nada |

Garantias mantidas: KB nativa do GLPI nunca é publicada automaticamente; original sempre
recuperável; lote limitado a 50 por execução; sem cloud no enriquecimento; PII Guard em
todos os prompts.

## 2. Execução recomendada (HML)

1. `--dry-run --limit 5` para inspecionar drafts e lacunas detectadas.
2. `--apply --limit 10` em lotes, validando 2-3 artigos no painel após cada lote.
3. `--gaps` semanal para alimentar a fila de redação de novos KBs.
4. Conferir resultado na Ajuda Inteligente com as queries de teste
   (micromed/AD/synology/backup/office/impressão).

## 3. Melhorias identificadas para implantação posterior

### Alta prioridade
1. **UI de revisão do enriquecimento no plugin** — tela listando candidatos
   `enrichment_version IS NOT NULL` com diff original × enriquecido (os hashes e o
   backup já existem), botões Aprovar/Rollback. Hoje o rollback é só via CLI.
2. **Re-indexação/reponderação pós-enriquecimento** — o FTS já cobre os campos
   atualizados, mas os `aliases` gerados entram apenas em `tags_json`; promover
   aliases a um campo de busca de peso A melhoraria recall (precisa de coluna
   dedicada ou peso extra no tsvector).
3. **Worker agendado de enriquecimento incremental** — hoje a execução é manual.
   Um job opcional (flag própria, lote pequeno, horário ocioso) manteria novos
   candidatos sempre enriquecidos.

### Média prioridade
4. **Enriquecimento dos artigos nativos do GLPI (knowbaseitems)** — o pipeline
   atual cobre apenas `kb_candidates`. Para a KB nativa seria via PHP (GLPI API),
   com o mesmo padrão draft+aprovação — nunca tocar `glpi_knowbaseitems` via Node.
5. **Métrica de qualidade pós-enriquecimento** — comparar `helpful_ratio` e
   `KB_INSUFFICIENT` por artigo antes/depois (dados já existem em
   `kb_article_helpfulness` + `rag_audit`); fecharia o ciclo de avaliação.
6. **Golden set ampliado** — incluir as 8 queries de teste da fase no
   `kbGoldenSetFixtures` com expectativa pós-enriquecimento (exige recalibrar
   baseline com aprovação manual — regra do ADR-004 de não auto-modificar).
7. **Gap candidates com contexto de query** — hoje a lacuna registra apenas
   `produto:intent` (sem PII). Guardar os top termos técnicos agregados (k-anonimizados)
   tornaria a redação do novo KB mais direta.

### Baixa prioridade / oportunista
8. **Endpoint HTTP para enriquecimento sob demanda** — botão "Enriquecer este KB"
   na UI do candidato (precisa de rota em `app.ts` + RBAC supervisor + CSRF).
9. **Versões múltiplas de enriquecimento** — hoje `enrichment_version` para em 1
   por design (elegibilidade `IS NULL`); permitir re-enriquecimento v2+ com
   histórico em tabela própria se houver demanda.
10. **Modelo dedicado** — `aya-expanse:8b` funciona; avaliar `qwen2.5:14b` (se
    GPU permitir) apenas para o batch de enriquecimento, onde latência não importa.

## 4. Riscos residuais aceitos

- Conteúdo gerado por IA local pode conter imprecisões técnicas → mitigado por
  backup/rollback + nota visível "Enriquecido por IA local" no markdown + revisão
  humana recomendada (item 1 acima formaliza isso em UI).
- Timeout do Ollama em lote grande → CLI usa timeout 60s/candidato e segue para o
  próximo; itens com falha ficam elegíveis para nova execução.
