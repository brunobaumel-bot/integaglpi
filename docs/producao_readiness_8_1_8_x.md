# Readiness de Producao 8.1-8.x

Status: pacote operacional para promocao manual TESTE -> PRODUCAO.  
Este documento nao autoriza deploy automatico, migration automatica, commit automatico ou alteracao direta em producao.

## Gates obrigatorios

- [ ] Aprovacao humana registrada para a janela de promocao.
- [ ] Smoke completo em TESTE aprovado e evidenciado.
- [ ] Pacote revisado no dev local com Git.
- [ ] Cloud/producao tratado apenas como ambiente de execucao e smoke: nao depende de Git no servidor.
- [ ] Nenhum `.env` real, token, senha, dump, log, certificado privado ou `.ovpn` incluido no pacote.
- [ ] Backups feitos e restaurabilidade confirmada antes de qualquer troca.
- [ ] IA Supervisora mantida desligada por padrao em PRODUCAO.
- [ ] Webhook Guard P0 mantido com allowlist distinta entre TESTE e PRODUCAO.

## Separacao TESTE vs PRODUCAO

TESTE:

- Pode manter dados e numeros de homologacao.
- Pode usar IA Supervisora local/Ollama quando explicitamente habilitada para teste.
- Pode executar smokes completos antes do pacote final.
- Deve ter `ALLOWED_META_PHONE_NUMBER_IDS` diferente de PRODUCAO.

PRODUCAO:

- Promocao manual somente.
- `.env` real fica apenas no servidor de producao.
- Meta tokens, GLPI tokens, senha PostgreSQL, certificados e VPN nao entram no pacote.
- `AI_SUPERVISOR_ENABLED=false` e `AI_SUPERVISOR_DRY_RUN=true` por padrao.
- Nao usar numero Meta de TESTE na allowlist de PRODUCAO.
- Nao aplicar migration sem backup e operador humano.

## Git local vs cloud

- Git existe e deve ser usado somente no dev local para diff, status, commit e tag.
- O servidor cloud/producao nao precisa de Git.
- Validacao em cloud deve usar UI, health endpoints, logs sanitizados e queries read-only.
- Nao executar `git add`, `git commit`, `git push` ou deploy automatico a partir deste pacote.

## Arquivos e pastas do pacote manual

Incluir somente arquivos aprovados e revisados. Excluir `node_modules`, caches, logs, dumps, backups e `.env` real.

### Plugin GLPI `integaglpi`

- `integaglpi/front/*.php`
- `integaglpi/inc/right.class.php`
- `integaglpi/setup.php`
- `integaglpi/hook.php`
- `integaglpi/src/**/*.php`
- `integaglpi/templates/**/*.php`

### Integration-service Node

- `integration-service/src/**`
- `integration-service/tests/**` apenas no pacote de auditoria/dev, nao necessario no runtime de producao.
- `integration-service/init-db.sql`
- `integration-service/schema-migrations/*.sql`
- `integration-service/package.json`
- `integration-service/package-lock.json`
- `integration-service/tsconfig.json`
- `integration-service/.env.example`
- `integration-service/.env.production.example`, se usado como modelo sem segredos.

### Docs operacionais

- `docs/producao_readiness_8_1_8_x.md`
- `docs/producao_deploy_playbook.md`
- `docs/producao_rollback_playbook.md`
- `docs/producao_smoke_checklist.md`
- `docs/configuration_matrix.md`
- `docs/database-bootstrap.md`

## Arquivos alterados por fase

Lista de alto nivel para empacotamento e revisao. A lista definitiva deve ser gerada no dev local com `git status --short` e revisada por fase antes do pacote.

### Webhook Guard P0

- `integration-service/src/controllers/createMetaWebhookPostController.ts`
- `integration-service/src/adapters/meta/metaWebhookTypes.ts`
- `integration-service/src/adapters/meta/parseMetaWebhookPayload.ts`
- `integration-service/src/config/env.ts`
- `integration-service/tests/metaWebhookRoutes.integration.test.ts`
- `integration-service/.env.example`

### Central, entidade real, memoria e reconciliacao

- `integaglpi/front/central.php`
- `integaglpi/front/central.refresh.php`
- `integaglpi/front/central.action.php`
- `integaglpi/templates/central.php`
- `integaglpi/src/Service/AttendanceCenterService.php`
- `integaglpi/src/Service/IntegrationServiceClient.php`
- `integaglpi/src/External/Repository/ConversationRepository.php`
- `integration-service/src/controllers/createConversationEntityController.ts`
- `integration-service/src/domain/services/EntitySelectionService.ts`
- `integration-service/src/adapters/glpi/GlpiClient.ts`
- `integration-service/src/repositories/postgres/PostgresConversationRepository.ts`
- `integration-service/schema-migrations/006_entity_selection_attempts.sql`
- `integration-service/schema-migrations/007_contact_entity_memory.sql`
- `integration-service/schema-migrations/019_conversation_entity_columns.sql`
- `integration-service/schema-migrations/020_entity_selection_attempts_idempotency_key.sql`
- `integration-service/schema-migrations/023_entity_selection_attempt_finished_at.sql`

### Perfil, experiencia, CSAT e reabertura

- `integration-service/src/domain/services/ContactProfileService.ts`
- `integration-service/src/domain/services/CustomerExperienceService.ts`
- `integration-service/src/domain/services/InboundWebhookService.ts`
- `integration-service/src/domain/services/OutboundMessageService.ts`
- `integration-service/src/repositories/postgres/PostgresSolutionActionRepository.ts`
- `integration-service/schema-migrations/008_contact_profile.sql`
- `integration-service/schema-migrations/009_conversation_profile_snapshot.sql`
- `integration-service/schema-migrations/013_customer_experience_glpi_user_csat.sql`
- `integration-service/schema-migrations/014_customer_experience_schema_alignment.sql`

### Delivery, janela 24h, templates locais e mensagens configuraveis

- `integration-service/src/domain/services/MessageConfigurationService.ts`
- `integration-service/src/domain/services/BusinessHoursService.ts`
- `integration-service/src/domain/services/InactivityAutomationService.ts`
- `integration-service/src/repositories/postgres/PostgresMessageFlowRepository.ts`
- `integration-service/src/repositories/postgres/PostgresMessageRepository.ts`
- `integration-service/schema-migrations/018_message_delivery_status.sql`
- `integration-service/schema-migrations/021_configurable_message_flows.sql`
- `integration-service/schema-migrations/022_inactivity_job_diagnostics.sql`
- `integaglpi/front/config.form.php`
- `integaglpi/templates/config.php`
- `integaglpi/src/Service/PluginConfigService.php`

### Contratos/Horas e auditoria operacional

- `integaglpi/front/contracts.hours.php`
- `integaglpi/templates/contracts_hours.php`
- `integaglpi/src/Service/ContractHoursService.php`
- `integaglpi/src/External/Repository/ContractHoursRepository.php`
- `integaglpi/src/Renderer/ContractHoursRenderer.php`
- `integaglpi/src/ContractsHoursMenu.php`
- `integration-service/schema-migrations/016_contract_hours.sql`

### Console 2.0, supervisor, diagnostico e dashboard

- `integaglpi/front/quality.dashboard.php`
- `integaglpi/src/Service/QualityDashboardService.php`
- `integaglpi/src/Renderer/QualityDashboardRenderer.php`
- `integaglpi/templates/quality_dashboard.php`
- `integaglpi/src/QualityDashboardMenu.php`
- `integaglpi/front/supervisor.php`
- `integaglpi/src/Service/SupervisorBackofficeService.php`
- `integaglpi/src/Renderer/SupervisorBackofficeRenderer.php`
- `integration-service/src/controllers/createQualityDashboardController.ts`
- `integration-service/src/services/QualityDashboardService.ts`
- `integration-service/src/domain/services/AiSupervisorService.ts`
- `integration-service/schema-migrations/017_ai_quality_analyses.sql`

## Migrations esperadas

O bootstrap do `integration-service` executa `init-db.sql` e depois todos os arquivos em `integration-service/schema-migrations/*.sql` em ordem lexicografica. As migrations sao idempotentes; nao ha tabela de historico obrigatoria neste baseline.

Arquivos esperados no pacote:

- `001_messages_idempotency.sql`
- `002_routing_queues.sql`
- `003_messages_media_info.sql`
- `004_solution_actions.sql`
- `005_audit_events.sql`
- `006_entity_selection_attempts.sql`
- `007_contact_entity_memory.sql`
- `008_contact_profile.sql`
- `009_conversation_profile_snapshot.sql`
- `010_dead_letter.sql`
- `011_runtime_configs.sql`
- `012_profile_collection_state.sql`
- `013_customer_experience_glpi_user_csat.sql`
- `014_customer_experience_schema_alignment.sql`
- `015_inactivity_tracking.sql`
- `016_contract_hours.sql`
- `017_ai_quality_analyses.sql`
- `018_message_delivery_status.sql`
- `019_conversation_entity_columns.sql`
- `020_entity_selection_attempts_idempotency_key.sql`
- `021_configurable_message_flows.sql`
- `022_inactivity_job_diagnostics.sql`
- `023_entity_selection_attempt_finished_at.sql`

## Validacao de `.env.example`

- [ ] `integration-service/.env.example` revisado no dev local.
- [ ] Nao contem token real, senha real, Bearer, App Token, User Token, certificado, VPN ou DSN real.
- [ ] Phone Number ID e display phone usam placeholders.
- [ ] `AI_SUPERVISOR_ENABLED=false` por padrao.
- [ ] `INACTIVITY_AUTOCLOSE_ENABLED=false` por padrao, salvo decisao manual posterior.
- [ ] `GLPI_TICKET_CREATE_TIMEOUT_MS=45000` documentado como timeout especifico de criacao de ticket.

Comando local read-only:

```bash
grep -RniE "token|password|secret|bearer|app_token|user_token|access_token" integration-service/.env.example integration-service/.env.production.example
```

Se houver valor real, parar o pacote.

## Checklist de backup

Antes de qualquer promocao:

- [ ] Backup do diretorio atual do plugin `integaglpi`.
- [ ] Backup do diretorio atual do `integration-service`.
- [ ] Backup do banco GLPI/MariaDB.
- [ ] Backup do PostgreSQL do integration-service.
- [ ] Backup do `.env` real em cofre/servidor seguro, nunca no pacote.
- [ ] Backup do `docker-compose.yml` real e overrides.
- [ ] Backup de certificados e renovacao documentada.
- [ ] Validacao de restauracao ou, no minimo, teste de leitura dos arquivos gerados.

Modelos manuais com placeholders:

```bash
# GLPI/MariaDB - executar manualmente no servidor correto.
mysqldump --single-transaction --routines --triggers -u <GLPI_DB_USER> -p <GLPI_DB_NAME> > <SECURE_BACKUP_DIR>/glpi_<YYYYMMDDHHMM>.sql

# PostgreSQL IntegraGLPI - executar manualmente no servidor correto.
pg_dump -h <PG_HOST> -p <PG_PORT> -U <PG_USER> -d <PG_DB> -Fc -f <SECURE_BACKUP_DIR>/integaglpi_<YYYYMMDDHHMM>.dump

# Arquivos - executar manualmente no servidor correto.
tar -czf <SECURE_BACKUP_DIR>/integaglpi_plugin_<YYYYMMDDHHMM>.tgz <GLPI_PLUGINS_DIR>/integaglpi
tar -czf <SECURE_BACKUP_DIR>/integration_service_<YYYYMMDDHHMM>.tgz <INTEGRATION_SERVICE_DIR>
```

## Checklist de rollback

- [ ] Definir responsavel humano pelo rollback antes do deploy.
- [ ] Registrar versao/pacote anterior.
- [ ] Registrar migrations aplicadas na janela.
- [ ] Se smoke falhar em webhook, ticket, envio, entidade ou permissao, parar promocao.
- [ ] Restaurar arquivos anteriores do plugin.
- [ ] Restaurar arquivos anteriores do integration-service.
- [ ] Restaurar `.env` anterior somente no servidor seguro, se foi alterado manualmente.
- [ ] Se migration causou falha, preferir restaurar backup integral do PostgreSQL feito antes da janela.
- [ ] Nao apagar tickets, conversas ou contratos manualmente sem decisao humana documentada.
- [ ] Rodar smoke reduzido apos rollback.

## Smoke de PRODUCAO

Executar manualmente e registrar evidencias sanitizadas:

- [ ] Health do `integration-service` OK.
- [ ] Webhook Meta GET verify preservado.
- [ ] Inbound WhatsApp do numero de PRODUCAO cria/continua conversa correta.
- [ ] Payload de numero nao autorizado e descartado com HTTP 200 sem processamento interno.
- [ ] Outbound GLPI -> WhatsApp chega ao cliente.
- [ ] Criacao de ticket por selecao de entidade real funciona.
- [ ] Contato com memoria ativa usa entidade correta.
- [ ] Entidade `0`/fora de escopo e bloqueada.
- [ ] Midia inbound anexa ao ticket ou falha com erro visivel.
- [ ] Delivery `sent/delivered/read/failed` aparece na timeline/Console.
- [ ] Reabrir solucao pede motivo.
- [ ] Motivo de reabertura vira follow-up no GLPI.
- [ ] Confirmacao WhatsApp pos-reabertura e enviada.
- [ ] CSAT apos aprovacao funciona.
- [ ] Contratos/Horas abre, salva ativo/inativo e bloqueia entidade fora de escopo.
- [ ] Dashboard de Qualidade abre para perfil autorizado.
- [ ] Dashboard mascara telefone e nao exibe texto de mensagens.
- [ ] Inatividade registra checked/eligible/skipped/planned/sent/failed.
- [ ] Fora de 24h sem template nao envia texto livre.
- [ ] Horario comercial aplica cooldown.
- [ ] IA Supervisora desligada por padrao e sem chamada a Ollama/cloud.
- [ ] Usuario tecnico restrito nao ve entidade fora do escopo.
- [ ] Supervisor/admin ve somente entidades permitidas pelo GLPI.

## Comandos read-only de validacao

Executar somente em ambiente correto, com credenciais do operador e sem colar segredos em tickets/logs.

### Dev local

```bash
git status --short
git diff --name-only
git diff --check
cd integration-service && npx tsc --noEmit
cd integration-service && npm test
php -l integaglpi/front/quality.dashboard.php
php -l integaglpi/src/Service/QualityDashboardService.php
php -l integaglpi/templates/quality_dashboard.php
```

### Container/runtime

```bash
docker exec <integration_container> sh -lc 'ls -1 /app/schema-migrations | sort'
docker exec <integration_container> sh -lc 'test -f /app/schema-migrations/023_entity_selection_attempt_finished_at.sql && echo OK'
docker exec <integration_container> sh -lc 'node -e "console.log(process.env.AI_SUPERVISOR_ENABLED || \"false\")"'
```

### PostgreSQL IntegraGLPI

```sql
SELECT current_database(), now();

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'glpi_plugin_integaglpi_conversations',
    'glpi_plugin_integaglpi_messages',
    'glpi_plugin_integaglpi_entity_selection_attempts',
    'glpi_plugin_integaglpi_contact_entity_memory',
    'glpi_plugin_integaglpi_message_delivery_status',
    'glpi_plugin_integaglpi_message_catalog',
    'glpi_plugin_integaglpi_business_hours',
    'glpi_plugin_integaglpi_entity_contracts',
    'glpi_plugin_integaglpi_hour_adjustments',
    'glpi_plugin_integaglpi_ai_quality_analyses'
  )
ORDER BY table_name;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'glpi_plugin_integaglpi_conversations'
  AND column_name IN ('glpi_entity_id', 'glpi_entity_name', 'profile_collection_state')
ORDER BY column_name;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'glpi_plugin_integaglpi_entity_selection_attempts'
  AND column_name IN ('idempotency_key', 'finished_at', 'glpi_ticket_id', 'status')
ORDER BY column_name;

SELECT status, count(*)
FROM glpi_plugin_integaglpi_entity_selection_attempts
GROUP BY status
ORDER BY status;

SELECT delivery_status, count(*)
FROM glpi_plugin_integaglpi_messages
WHERE direction = 'outbound'
GROUP BY delivery_status
ORDER BY delivery_status;
```

### GLPI/MariaDB

```sql
SELECT id, name, completename
FROM glpi_entities
ORDER BY id
LIMIT 20;

SELECT id, name
FROM glpi_profiles
ORDER BY id
LIMIT 20;
```

## Stop conditions

Parar promocao se ocorrer qualquer item:

- segredo encontrado no pacote;
- `.env` real incluído no pacote;
- comando destrutivo necessario;
- migration falha;
- webhook guard alterado ou allowlist incorreta;
- IA ativa em producao;
- ticket criado sem entidade valida;
- resposta ao cliente sem `glpi_ticket_id`;
- Dashboard expondo telefone completo ou texto de mensagens;
- Contratos/Horas permitindo cross-entity;
- smoke de inbound/outbound/ticket falha.

## Evidencias obrigatorias

Registrar fora do repositorio:

- operador;
- data/hora de inicio e fim;
- hash/identificador do pacote;
- lista de arquivos implantados;
- lista de migrations aplicadas;
- resultado dos backups;
- resultado dos smokes;
- decisao final: manter, rollback ou bloquear.
