# Matriz de Eventos de Auditoria IA V4.1

Todos os eventos novos de IA devem ter `source` explicito, payload sanitizado, sem prompt bruto, sem PII e sem segredo.

| Familia | Eventos principais | Source esperado | Payload permitido |
| --- | --- | --- | --- |
| P1 IA Supervisora | `AI_SUPERVISOR_ANALYSIS_*` | `AiSupervisorService` | analysis id, ticket id, conversation id, status, hashes, contagens |
| P3 Candidatos KB | `KB_CANDIDATE_*` | `KbCandidateGenerator` ou `PluginKbCandidate` | candidate id, status, confidence, ids de origem |
| P5 Copiloto | `COPILOT_DRAFT_*`, `COPILOT_FEEDBACK_RECORDED` | `CopilotDraftService` | draft hash, tom, contagens, feedback |
| P6 Risco | `RISK_SCORE_GENERATED`, `RISK_SCORE_FEEDBACK_RECORDED` | `RiskScoringService` ou `RiskScoreService` | score id, risco, confidence, model version |
| P7 Piloto Cloud | `AI_CLOUD_PILOT_*`, `AI_EMBEDDING_PILOT_*`, `AI_PILOT_*` | `AiPilotService` | provider, model, custo, hashes, motivo bloqueio |
| P8 Coaching | `COACHING_*` | `CoachingService` | recommendation id, rating, status, input hash |
| P9 Pesquisa externa | `EXTERNAL_RESEARCH_*` | `ExternalResearchService` | request id, source ids, provider, custo, hashes, confidence |

Regras:
- `source` nunca pode ser nulo em eventos IA.
- Eventos bloqueados devem usar status `blocked`, `ignored` ou equivalente seguro.
- Hashes substituem prompt bruto.
- Se houver suspeita de vazamento, registrar incidente sem reproduzir payload.

