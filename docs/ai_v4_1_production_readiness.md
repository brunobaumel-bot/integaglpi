# Production Readiness IA V4.1

Estado alvo antes de producao:
- Roadmap fechado por revisao humana.
- Homologacao concluida em TESTE.
- Feature flags documentadas e default-safe.
- Rollback testado.
- Incidente LGPD documentado.
- Smoke manual executado e registrado.

Bloqueios de promocao:
- Qualquer flag cloud/embedding ativa sem DPO e direcao.
- Qualquer caminho de IA que envie WhatsApp ou template automaticamente.
- Qualquer mutacao de ticket, prioridade, status ou KB pela IA.
- Qualquer auditoria sem source em eventos IA.
- Qualquer teste critico falhando.
- Qualquer PII/segredo em docs, logs ou payload persistido.

Retencao:
- Retencao automatica nao e parte do deploy.
- Limpeza real deve ser comando manual, dry-run primeiro, aprovacao humana e evidencias preservadas.
- Tabelas de piloto cloud/embedding devem ter revisao mais curta que logs operacionais.

Performance:
- Migration 037 adiciona indices `created_at` para leitura de dashboards, auditoria e historico IA.
- Render de dashboard/coaching/pesquisa nao deve chamar IA, mineracao ou geracao de candidatos.
- Consultas devem usar limites e agregacoes.

