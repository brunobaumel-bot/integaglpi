# Matriz de Feature Flags IA V4.1

Escopo: fechamento operacional do roadmap IA V4.1. Nenhuma flag deve ser habilitada em producao sem revisao humana, smoke em TESTE e aprovacao formal.

| Flag | Default seguro | Ambiente permitido | Gate humano | Condicao para producao |
| --- | --- | --- | --- | --- |
| AI_SUPERVISOR_ENABLED | false | TESTE/HOMOLOGACAO | Supervisor tecnico | Habilitar gradualmente com dry-run validado |
| AI_SUPERVISOR_DRY_RUN | true | Todos | Supervisor tecnico | false somente apos smoke e rollback pronto |
| AI_SUPERVISOR_PROVIDER | disabled | TESTE/HOMOLOGACAO | Supervisor tecnico | disabled por padrao |
| COPILOT_ENABLED | pendente controlada se ausente | TESTE/HOMOLOGACAO | Supervisor tecnico | false por padrao |
| COPILOT_PROVIDER | disabled | TESTE/HOMOLOGACAO | Supervisor tecnico | disabled por padrao |
| COPILOT_DRY_RUN | true | TESTE/HOMOLOGACAO | Supervisor tecnico | true inicialmente |
| AI_PILOT_CLOUD_ENABLED | false | TESTE/HOMOLOGACAO | Admin, DPO e direcao | false em producao por padrao |
| AI_PILOT_EMBEDDINGS_ENABLED | false | TESTE/HOMOLOGACAO | Admin, DPO e direcao | false em producao por padrao |
| AI_PILOT_PROVIDER | disabled | TESTE/HOMOLOGACAO | Admin, DPO e direcao | disabled por padrao |
| AI_PILOT_DPO_APPROVED | false | TESTE/HOMOLOGACAO | DPO/LGPD | Obrigatorio antes de cloud |
| AI_PILOT_DIRECTOR_APPROVED | false | TESTE/HOMOLOGACAO | Direcao | Obrigatorio antes de cloud |
| AI_PILOT_ADMIN_OPT_IN | false | TESTE/HOMOLOGACAO | Admin | Obrigatorio antes de cloud |
| AI_PILOT_INCIDENT_ACK | false | TESTE/HOMOLOGACAO | Admin/DPO | Obrigatorio antes de cloud |
| AI_PILOT_HARD_BUDGET_BLOCK | true | Todos | Admin | Nunca desabilitar em producao |
| EXTERNAL_RESEARCH_ENABLED | pendente controlada se ausente | TESTE/HOMOLOGACAO | Supervisor/admin | false por padrao |
| EXTERNAL_RESEARCH_CLOUD_ENABLED | false ou ausente | TESTE/HOMOLOGACAO | Admin, DPO e direcao | false em producao |
| EXTERNAL_RESEARCH_DPO_APPROVED | false ou ausente | TESTE/HOMOLOGACAO | DPO/LGPD | Obrigatorio para cloud |
| EXTERNAL_RESEARCH_DIRECTOR_APPROVED | false ou ausente | TESTE/HOMOLOGACAO | Direcao | Obrigatorio para cloud |

Regras de promocao:
- Toda flag nova de IA deve nascer disabled ou dry-run.
- Cloud e embeddings exigem opt-in explicito, budget hard-block, DPO e direcao.
- Nenhuma flag pode permitir WhatsApp automatico, template Meta, update de ticket ou escrita na KB.
- Mudanca em `.env` real nao faz parte deste fechamento e deve ser manual.

