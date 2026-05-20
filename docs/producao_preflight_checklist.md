# Preflight de Producao

Executar antes de qualquer promocao TESTE -> PRODUCAO.

## Pacote

- [ ] `package_manifest.json` presente.
- [ ] `build_id` confere com o pacote aprovado.
- [ ] `package_id` confere com o pacote aprovado.
- [ ] Lista de arquivos criticos revisada.
- [ ] Sem arquivos `??` inesperados no dev local.
- [ ] Sem `.env` real no pacote.
- [ ] Sem dumps, backups, `.ovpn`, certificados privados ou tokens.
- [ ] Documentos de rollback e smoke presentes.

## Ambiente

- [ ] TESTE e PRODUCAO usam bancos separados.
- [ ] Redis de TESTE e PRODUCAO separados.
- [ ] Meta Phone Number ID de producao revisado sem expor valor completo.
- [ ] Webhook Guard configurado para producao.
- [ ] URL GLPI API de producao validada por operador autorizado.
- [ ] TLS valido.
- [ ] Cloud sem Git: pacote sera copiado manualmente.
- [ ] Reconciliacao manual pre-producao concluida conforme `docs/pre_prod_manual_state_reconciliation.md`.
- [ ] Limites PHP web do GLPI conferidos e registrados.
- [ ] `scripts/ops/check_php_limits.sh` executado contra sonda autorizada ou diagnostico equivalente.
- [ ] Backup local de PRODUCAO para `glpi_documenttypes` criado antes de qualquer ajuste.
- [ ] `scripts/ops/apply_glpi_documenttypes.sh` revisado em dry-run antes de qualquer `--execute`.
- [ ] Tipos de documento audio/video conferidos por consulta read-only.
- [ ] Tabelas PostgreSQL criticas da integracao validadas por consulta read-only.
- [ ] `scripts/ops/check_integaglpi_postgres_tables.sh` executado em modo read-only ou dry-run revisado.

## Node

- [ ] `integration-service` buildado no pacote.
- [ ] `/health` responde.
- [ ] `/internal/glpi/diagnostics` responde via plugin.
- [ ] PostgreSQL ok.
- [ ] Redis configurado.
- [ ] GLPI API ok.
- [ ] Meta configurado.

## Plugin GLPI

- [ ] Plugin copiado no caminho correto.
- [ ] Permissoes de perfil revisadas.
- [ ] Diagnostico Operacional acessivel para supervisor/admin.
- [ ] Console abre.
- [ ] Dashboard abre.
- [ ] Contratos/Horas abre.

## IA

- [ ] IA Supervisora permanece read-only.
- [ ] IA Copiloto nao iniciada.
- [ ] Flag de IA customer-facing desligada.
- [ ] Nenhum prompt/modelo sera chamado no smoke de producao.

## Gate Humano

- [ ] Backup aprovado.
- [ ] Migration aprovada, se houver.
- [ ] Rollback aprovado.
- [ ] Janela de manutencao confirmada.
- [ ] Responsavel autorizou continuar.
