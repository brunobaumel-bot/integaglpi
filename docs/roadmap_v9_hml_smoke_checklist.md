# Roadmap V9 — Checklist de Smoke HML Final

PHASE: `integaglpi_v9_final_ressalvas_cleanup_001` — Updated: 2026-06-12

Checklist operacional para o smoke HML final do V9 antes do fechamento
`DONE_COM_RESSALVAS`. Execução **manual**, somente em HOMOLOGAÇÃO
(`glpi-integaglpi-*`; NUNCA `prod-*`). Nenhum item deste checklist autoriza
deploy em produção, alteração de `.env` permanente ou publicação de KB.

**Fechamento M0 documental:** `DONE_COM_RESSALVAS` em 2026-06-12. O deploy formal
HML foi executado a partir de fonte Git-backed em `18e16f2`; o smoke RAG real
registrou `postgres_hml_real`, 10/10 queries, 10/10 top-1 e 0 falhas. S1-S5
permanecem como ressalvas operacionais aceitas porque não foram reexecutados
nesta fase documental. V10-1 continua bloqueado até GO manual do operador.

**Regras gerais do smoke:**

- Ambiente: HML (`http://127.0.0.1:3001` / containers `glpi-integaglpi-*`).
- Dados autorizados: tickets de teste `2112319362`/`2112319363`, phone `41988334449`.
  Ticket real `2112319360` = NUNCA usar/mutar.
- Flags são ativadas **somente durante o smoke**, no ambiente do processo HML,
  com registro de quem ativou e quando.
- **OBRIGATÓRIO ao final: restaurar TODAS as flags para `false` e validar
  `/health` + boot limpo do container.** Smoke sem restauração = smoke reprovado.
- Evidência: print/screenshot por cenário + saída de curl quando aplicável.

---

## S1 — D08: Saúde Técnica com e sem direito (R5)

Valida o fallback `Session::haveRight('config', UPDATE)` aceito na revisão D01–D11.
Nenhuma alteração de permissão é autorizada por este checklist — apenas validação.

| # | Cenário | Passos | Resultado esperado |
| --- | --- | --- | --- |
| S1.1 | Perfil autorizado | Logar com perfil que possui `config UPDATE` (ex.: Super-Admin) → abrir **Saúde Técnica** (`front/technical.health.php`) | Página abre; flags exibidas read-only; nenhuma ação de mutação disponível |
| S1.2 | Perfil sem direito | Logar com perfil SEM `config UPDATE` (ex.: Technician padrão) → acessar a mesma URL diretamente | Acesso negado (tela de permissão GLPI) — sem erro 500, sem vazamento de configuração |
| S1.3 | Menu | Com o perfil sem direito, verificar menu Supervisão/plugin | Entrada de Saúde Técnica ausente ou inerte; nenhuma URL exposta com dados |

Critério de aprovação: S1.1–S1.3 verdes sem alteração de código/permissão.
Se houver bug comprovado, abrir contrato próprio (NUNCA hotfix dentro do smoke).

---

## S2 — Smart Help UI V9 (flag off — comportamento legado)

Pré-condição: `CUSTOM_RESPONSE_ENABLED=false` (default), `FEEDBACK_RANKING_ENABLED=false`,
`RERANKER_ENABLED=false`.

| # | Cenário | Passos | Resultado esperado |
| --- | --- | --- | --- |
| S2.1 | Painel legado intacto | Abrir ticket de teste → Ajuda Inteligente → Resumo → Busca local | Artigos, checklist, perguntas e playbook como antes; **NENHUM** bloco "Sugestão IA contextualizada" |
| S2.2 | Seções aditivas | Mesmo fluxo | `kbCoverage`/perfil por problema podem aparecer (read-only, aditivos); KB original sempre visível |
| S2.3 | Widget KB RAG | Página Smart Help KB (`kb.smart_help_page.php`) → consulta "micromed nao abre" | Playbook + KBs Recuperadas como antes; sem bloco customResponse |

---

## S3 — Smart Help UI V9 (CUSTOM_RESPONSE_ENABLED=true)

Ativar `CUSTOM_RESPONSE_ENABLED=true` SOMENTE no processo Node HML durante o smoke.

| # | Cenário | Passos | Resultado esperado |
| --- | --- | --- | --- |
| S3.1 | 1 problema, KB_FOUND | Ticket de teste com problema único coberto por KB (ex.: "micromed não abre") → Busca local | Bloco **Sugestão IA contextualizada** com badge vermelho **"Revise antes de aplicar"**, guidance, confiança e **KBs fonte visíveis**; KB original/playbook continuam acima; bloco compacto "Detalhe RAG do problema" presente |
| S3.2 | Multi-problema | Ticket de teste com 2 problemas distintos (ex.: "micromed não abre e o backup synology falhou") | Seção "Perfil por problema" (2 cards); "Cobertura de KB por problema" com badge por problema; "Resultado RAG por problema" com 2 entradas |
| S3.3 | KB_INSUFFICIENT | Consulta sem cobertura local (ex.: produto inexistente) | Badge **KB_INSUFFICIENT** amarelo; mensagem de coleta de dados; NENHUMA solução inventada; customResponse ausente ou em modo determinístico com gate_message "Contexto insuficiente para personalização" |
| S3.4 | Gate de confiança | Consulta vaga (ex.: "sistema lento") | `nivel_de_confianca < 0.60` → modo determinístico + gate_message; **sem chamada Ollama para personalização** (verificar logs Node) |
| S3.5 | Nada ao cliente | Em todos os cenários | Nenhuma mensagem WhatsApp enviada; nenhum ticket alterado; verificação: timeline do ticket intacta |
| S3.6 | Widget irmão | Widget KB RAG com customResponse presente | Bloco aparece como card IRMÃO (não aninhado) após o card do playbook |

---

## S4 — Feedback bias (FEEDBACK_RANKING_ENABLED=true)

Ativar SOMENTE durante o smoke. Pré-requisito: ≥3 votos no mesmo candidato de teste.

| # | Cenário | Passos | Resultado esperado |
| --- | --- | --- | --- |
| S4.1 | Sem votos suficientes | Buscar KB com candidato de <3 votos | Ranking idêntico ao flag off (bias não aplicado) |
| S4.2 | Com votos | Votar "Ajudou" 3x (técnicos/tickets distintos) num candidato → repetir busca | Candidato sobe de forma sutil (multiplicador ≤1.2); NUNCA artigo eliminado |
| S4.3 | Voto negativo isolado | 1 voto "Não ajudou" num candidato sem outros votos | NENHUMA penalização (threshold 3 votos) |
| S4.4 | Sem identidade | Inspecionar payload/logs | Nenhum technician_id em payload de ranking/bias |
| S4.5 | Performance | Logs Node durante busca com flag on | UMA query bulk de helpfulness (sem N+1 de 10+ SELECTs) |

---

## S5 — Reranker (RERANKER_ENABLED=true)

Pré-requisito: Ollama HML acessível (socat → 10.8.0.10:11434 ativo). Ativar SOMENTE durante o smoke.

| # | Cenário | Passos | Resultado esperado |
| --- | --- | --- | --- |
| S5.1 | Rerank ativo | Busca com 2+ KBs candidatas | Payload contém `reranker.applied=true`, `reranker.model` e `maxInferenceMs`; `kbsScoreBreakdown[].rerankerScore` presente nos avaliados |
| S5.2 | Fallback Ollama off | Derrubar socat/Ollama → repetir busca | Resposta normal com ordem original; `reranker.applied=false` + note de fallback; latência sem travamento (timeout 1500ms/inferência) |
| S5.3 | KB_INSUFFICIENT intacto | Consulta com confiança abaixo do mínimo | KB_INSUFFICIENT idêntico ao flag off (reranker NÃO interfere no gate) |
| S5.4 | Flag off | Restaurar `RERANKER_ENABLED=false` → repetir busca | Campo `reranker` AUSENTE do payload (legado byte-idêntico) |

---

## S6 — Encerramento do smoke (OBRIGATÓRIO)

| # | Item | Verificação |
| --- | --- | --- |
| S6.1 | Restaurar flags | `CUSTOM_RESPONSE_ENABLED=false`, `FEEDBACK_RANKING_ENABLED=false`, `RERANKER_ENABLED=false` no ambiente HML |
| S6.2 | Health | `curl -s http://127.0.0.1:3001/health` → `ok=true` |
| S6.3 | Boot limpo | Restart do container integration → sem crash loop, migrations idempotentes OK |
| S6.4 | Sem resíduo | Nenhum ticket real tocado; nenhuma KB publicada; nenhuma mensagem enviada |
| S6.5 | Evidências | Prints/saídas anexados ao registro de fechamento V9 |

---

## S7 — KB operational search (needs_review preview + smoke real)

Flag temporária: `KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY=true` (somente HML; produção nunca inclui `needs_review`).

| # | Cenário | Passos | Resultado esperado |
| --- | --- | --- | --- |
| S7.1 | Simulação local | `npm test -- tests/kbOperationalSearchSmoke.test.ts` (bloco SIMULATION) | PASS; relatório `tmp/kb_operational_search_simulation.yaml` com `source=mock_simulation` |
| S7.2 | Smoke real HML | Deploy dist fix002 no container `glpi-integaglpi-integration`; `env KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY=true AI_PILOT_ENVIRONMENT=homologation node /tmp/kbOperationalSearchSmokeReal.mjs` (ou `npx tsx scripts/kbOperationalSearchSmokeReal.ts` com Postgres HML) | Relatório `tmp/kb_operational_search_smoke_real.yaml` com `source=postgres_hml_real`; 10 queries; top-3 validado |
| S7.3 | Restaurar flag | `KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY=false` + restart integration | Busca volta a `approved`+`candidate` apenas |

---

## Resultado

| Bloco | Status | Executor | Data | Evidência |
| --- | --- | --- | --- | --- |
| S1 (D08) | RESSALVA ACEITA | Codex M0 documental | 2026-06-12 | Não reexecutado nesta fase documental; sem autorização para alterar permissões/runtime |
| S2 (flag off) | RESSALVA ACEITA | Codex M0 documental | 2026-06-12 | Não reexecutado nesta fase documental; flags permanentes preservadas |
| S3 (customResponse) | RESSALVA ACEITA | Codex M0 documental | 2026-06-12 | Não reexecutado nesta fase documental; sem envio WhatsApp/ticket mutation |
| S4 (feedback bias) | RESSALVA ACEITA | Codex M0 documental | 2026-06-12 | Não reexecutado nesta fase documental; sem alteração de ranking/runtime |
| S5 (reranker) | RESSALVA ACEITA | Codex M0 documental | 2026-06-12 | Não reexecutado nesta fase documental; sem alteração de provider/Ollama |
| S6 (encerramento) | PASS PARCIAL M0 | Codex M0 formal deploy | 2026-06-12 | Health OK pós-restart; flag `KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY` OFF em repouso; produção intocada |
| S7 (KB search smoke) | PASS (10/10 top1 pós-deploy formal) | Codex M0 formal deploy | 2026-06-12 | `docs/eval_reports/kb_operational_search_smoke_real_2026-06-12.yaml` |

Fechamento `DONE_COM_RESSALVAS` do V9 foi declarado no M0 documental com S1-S5
como ressalvas aceitas, S6 parcial no escopo de flags/health/boot e S7 PASS real.
V10-1 exige GO manual explícito do operador.
