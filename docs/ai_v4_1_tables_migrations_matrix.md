# Matriz de Tabelas e Migrations IA V4.1

Todas as migrations IA V4.1 sao aditivas. Nao usar `DROP`, `TRUNCATE` ou `DELETE` em deploy automatico.

| Fase | Migration | Tabelas principais | Politica de dados | Retencao recomendada |
| --- | --- | --- | --- | --- |
| P1 | 017 | `glpi_plugin_integaglpi_ai_quality_analyses` | `result_json` validado, sem prompt bruto | Revisao periodica por janela de auditoria |
| P2 | 029 | `hist_mining_runs`, `hist_patterns`, `hist_insights`, `hist_evidence` | Dataset offline sanitizado | Evidencias anonimizadas por prazo definido pelo DPO |
| P3 | 030 | `kb_candidates`, `kb_candidate_reviews` | Candidatos revisaveis, sem auto publish | Manter historico de revisao conforme governanca KB |
| P6 | 033 | `risk_scores`, `risk_score_feedback` | Score explicavel, feedback humano | Retencao reduzida se score perder utilidade |
| P7 | 034 | `ai_pilot_usage`, `ai_pilot_embeddings` | Hashes, custos, embeddings sanitizados | Retencao curta para piloto e auditoria LGPD |
| P8 | 035 | `coaching_recommendations`, `coaching_feedback` | Recomendacoes anti-punitivas | Arquivar recomendacoes antigas, sem texto bruto |
| P9 | 036 | `external_source_catalog`, `external_research_*` | Prompt anonimizado, fontes citadas | Revisar por validade da fonte e incidente |
| Hardening | 037 | Indices `created_at` | Performance de leitura | Sem retencao automatica |

Politica de retencao:
- `audit_events`: manter conforme requisito de auditoria; limpeza somente manual, dry-run e aprovada.
- `risk_scores`: reter enquanto explicar decisao humana recente; arquivar ou expurgar manualmente depois do prazo definido.
- `ai_pilot_usage`: reter custos e hashes pelo periodo de auditoria do piloto.
- `ai_pilot_embeddings`: remover manualmente se fonte for revogada, suspeita de dado sensivel ou fim do piloto.
- `external_research` logs: manter para rastreabilidade de fonte, custo e incidente.
- `coaching_feedback` e `kb_candidate_reviews`: manter como historico de governanca, sem texto bruto.

Migration 037:
- Apenas `CREATE INDEX IF NOT EXISTS`.
- Sem alteracao em tabelas operacionais.
- Sem GLPI core.

