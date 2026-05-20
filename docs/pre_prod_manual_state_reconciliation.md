# Reconciliacao Manual Pre-Producao

Fase: `integaglpi_pre_prod_manual_state_reconciliation_001`

Objetivo: transformar os ajustes manuais validados em TESTE em um procedimento manual, idempotente e auditavel para PRODUCAO. Este documento nao executa deploy, nao executa migration e nao altera producao automaticamente.

## Regras de Seguranca

- Executar somente por operador autorizado e dentro de janela aprovada.
- Usar placeholders; nunca colar senhas, tokens ou headers reais neste documento.
- Criar backup proprio em PRODUCAO antes de alterar `glpi_documenttypes`.
- Nao copiar tabela de backup de TESTE para PRODUCAO.
- Nao alterar `glpi_documents_items` manualmente.
- Nao alterar core GLPI.
- Nao executar `DROP`, `TRUNCATE` ou `DELETE`.
- Nao executar deploy automatico.
- Nao colar exemplos com `<...>` diretamente no shell; definir variaveis com valores reais revisados.
- Usar `--backup-suffix` unico por janela. Reutilizar o mesmo sufixo deve abortar em `--execute`.

Nunca versionar, copiar ou colar em documentacao: .env real, .ovpn, tokens, Bearer tokens, PSK, Phone Number ID real, senhas, dumps SQL, backups reais, payloads brutos sensiveis ou dados pessoais desnecessarios.

## Valores Esperados

### PHP Web do GLPI

- `upload_max_filesize=64M`
- `post_max_size=96M`
- `memory_limit=512M`
- `max_execution_time=120`
- `max_input_time=120`

### Tipos GLPI para Audio/Video

| Extensao | MIME |
| --- | --- |
| `ogg` | `audio/ogg` |
| `oga` | `audio/ogg` |
| `mp3` | `audio/mpeg` |
| `m4a` | `audio/mp4` |
| `aac` | `audio/aac` |
| `webm` | `audio/webm` |
| `mp4` | `video/mp4` |
| `3gp` | `video/3gpp` |

## Precheck de PRODUCAO

1. Confirmar pacote aprovado e `build_id/package_id`.
2. Confirmar backup completo do plugin GLPI, banco GLPI, PostgreSQL da integracao, `.env` real fora do repo, docker-compose e certificados/configs.
3. Confirmar que o operador tem acesso ao banco GLPI de PRODUCAO e ao PostgreSQL da integracao.
4. Confirmar que nao ha deploy automatico ou script agendado para esta etapa.
5. Confirmar que o Webhook Guard esta ativo.
6. Confirmar que IA permanece OFF em PRODUCAO.
7. Confirmar janela de rollback aberta.

## Checagem Manual dos Limites PHP via Web

Preferir uma pagina de diagnostico ja existente e autorizada pelo operador. Se o ambiente nao expuser os limites por diagnostico existente, usar uma sonda temporaria manual, fora do repositorio, removida imediatamente apos a leitura.

Exemplo de conteudo da sonda temporaria:

```php
<?php
header('Content-Type: application/json');
echo json_encode([
    'upload_max_filesize' => ini_get('upload_max_filesize'),
    'post_max_size' => ini_get('post_max_size'),
    'memory_limit' => ini_get('memory_limit'),
    'max_execution_time' => ini_get('max_execution_time'),
    'max_input_time' => ini_get('max_input_time'),
], JSON_PRETTY_PRINT);
```

Exemplo manual com placeholders:

```bash
# Copiar manualmente a sonda para <glpi-public-root>/_integaglpi_php_limits_probe.php
scripts/ops/check_php_limits.sh --url https://<glpi-host>/_integaglpi_php_limits_probe.php --dry-run
scripts/ops/check_php_limits.sh --url https://<glpi-host>/_integaglpi_php_limits_probe.php
# Remover manualmente <glpi-public-root>/_integaglpi_php_limits_probe.php apos validar
```

Resultado esperado:

```json
{
  "upload_max_filesize": "64M",
  "post_max_size": "96M",
  "memory_limit": "512M",
  "max_execution_time": "120",
  "max_input_time": "120"
}
```

Se qualquer valor divergir, ajustar o vhost/PHP do ambiente conforme runbook local, reiniciar LSWS/PHP conforme procedimento aprovado e repetir a checagem. Nao alterar arquivos do repositorio para isso.

## Backup Manual de `glpi_documenttypes`

Antes de qualquer upsert, criar backup local em PRODUCAO. Usar timestamp da janela.

### Defaults-file MySQL fora do repositorio

Criar o arquivo de credenciais do cliente MySQL a partir do `config_db.php` real do GLPI. O script mostra apenas host, banco e usuario; a senha nao e impressa.

```bash
GLPI_CONFIG_DB="/caminho/seguro/do/glpi/config/config_db.php"
MYSQL_DEFAULTS_FILE="/root/.my-prod.cnf"

scripts/ops/create_mysql_defaults_from_glpi_config.sh \
  --config "$GLPI_CONFIG_DB" \
  --output "$MYSQL_DEFAULTS_FILE"
```

Escrita manual, somente apos revisao:

```bash
scripts/ops/create_mysql_defaults_from_glpi_config.sh \
  --config "$GLPI_CONFIG_DB" \
  --output "$MYSQL_DEFAULTS_FILE" \
  --execute
```

O arquivo gerado deve ficar fora do repositorio, com permissao `0600`, e nao deve ser versionado, copiado para pacote ou colado em documentacao.

O script versionado abaixo gera SQL em dry-run por padrao. Ele so aplica quando `--execute` e informado e o operador digita a confirmacao solicitada.

```bash
GLPI_PROD_DB="sist_glpi"
MYSQL_DEFAULTS_FILE="/root/.my-prod.cnf"
BACKUP_SUFFIX="$(date +%Y%m%d%H%M%S)"

scripts/ops/apply_glpi_documenttypes.sh \
  --defaults-file "$MYSQL_DEFAULTS_FILE" \
  --database "$GLPI_PROD_DB" \
  --backup-suffix "$BACKUP_SUFFIX"
```

Aplicacao manual, somente apos revisao:

```bash
scripts/ops/apply_glpi_documenttypes.sh \
  --defaults-file "$MYSQL_DEFAULTS_FILE" \
  --database "$GLPI_PROD_DB" \
  --backup-suffix "$BACKUP_SUFFIX" \
  --execute
```

O SQL conceitual gerado inclui backup antes de qualquer upsert:

```sql
CREATE TABLE glpi_documenttypes_backup_YYYYMMDDHHMMSS AS
SELECT *
FROM glpi_documenttypes;
```

Validar o backup substituindo o sufixo pela variavel da janela:

```sql
SELECT COUNT(*) AS source_count
FROM glpi_documenttypes;

SELECT COUNT(*) AS backup_count
FROM glpi_documenttypes_backup_YYYYMMDDHHMMSS;
```

O backup e local de PRODUCAO e nao deve entrar no pacote de deploy.

## Upsert Idempotente de Tipos de Documento

Antes do upsert, confirmar os nomes reais das colunas:

```sql
SELECT COLUMN_NAME, DATA_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'glpi_documenttypes'
ORDER BY ORDINAL_POSITION;
```

O modelo abaixo assume colunas `ext`, `mime` e `name`, comuns em GLPI. Se o schema local tiver nomes diferentes, adaptar manualmente com revisao humana antes de executar.

```sql
UPDATE glpi_documenttypes SET mime = 'audio/ogg', name = 'ogg' WHERE ext = 'ogg';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT 'ogg', 'ogg', 'audio/ogg', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = 'ogg');

UPDATE glpi_documenttypes SET mime = 'audio/ogg', name = 'oga' WHERE ext = 'oga';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT 'oga', 'oga', 'audio/ogg', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = 'oga');

UPDATE glpi_documenttypes SET mime = 'audio/mpeg', name = 'mp3' WHERE ext = 'mp3';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT 'mp3', 'mp3', 'audio/mpeg', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = 'mp3');

UPDATE glpi_documenttypes SET mime = 'audio/mp4', name = 'm4a' WHERE ext = 'm4a';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT 'm4a', 'm4a', 'audio/mp4', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = 'm4a');

UPDATE glpi_documenttypes SET mime = 'audio/aac', name = 'aac' WHERE ext = 'aac';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT 'aac', 'aac', 'audio/aac', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = 'aac');

UPDATE glpi_documenttypes SET mime = 'audio/webm', name = 'webm' WHERE ext = 'webm';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT 'webm', 'webm', 'audio/webm', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = 'webm');

UPDATE glpi_documenttypes SET mime = 'video/mp4', name = 'mp4' WHERE ext = 'mp4';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT 'mp4', 'mp4', 'video/mp4', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = 'mp4');

UPDATE glpi_documenttypes SET mime = 'video/3gpp', name = '3gp' WHERE ext = '3gp';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT '3gp', '3gp', 'video/3gpp', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = '3gp');
```

Validacao read-only:

```sql
SELECT ext, mime, is_uploadable
FROM glpi_documenttypes
WHERE ext IN ('ogg', 'oga', 'mp3', 'm4a', 'aac', 'webm', 'mp4', '3gp')
ORDER BY ext;
```

## Validacao Read-Only do PostgreSQL da Integracao

Nao criar tabelas manualmente se houver migration esperada. Usar apenas leitura para confirmar estado.

Usar o script versionado:

```bash
PG_HOST="postgres-host"
PG_PORT="5432"
PG_DB="integration_service"
PG_USER="integration_readonly_user"

scripts/ops/check_integaglpi_postgres_tables.sh \
  --host "$PG_HOST" \
  --port "$PG_PORT" \
  --database "$PG_DB" \
  --user "$PG_USER" \
  --dry-run
```

Execucao read-only manual:

```bash
scripts/ops/check_integaglpi_postgres_tables.sh \
  --host "$PG_HOST" \
  --port "$PG_PORT" \
  --database "$PG_DB" \
  --user "$PG_USER"
```

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'glpi_plugin_integaglpi_conversations',
    'glpi_plugin_integaglpi_messages',
    'glpi_plugin_integaglpi_audit_events',
    'glpi_plugin_integaglpi_entity_selection_attempts',
    'glpi_plugin_integaglpi_configs',
    'glpi_plugin_integaglpi_message_delivery_status',
    'glpi_plugin_integaglpi_inactivity_job_events'
  )
ORDER BY table_name;
```

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'glpi_plugin_integaglpi_conversations',
    'glpi_plugin_integaglpi_messages',
    'glpi_plugin_integaglpi_audit_events',
    'glpi_plugin_integaglpi_entity_selection_attempts',
    'glpi_plugin_integaglpi_configs'
  )
ORDER BY table_name, ordinal_position;
```

## Cache GLPI e Restart LSWS

Executar somente apos backup e alteracoes aprovadas. Exemplos com placeholders:

```bash
# Limpar cache GLPI conforme caminho real do ambiente.
php <glpi-root>/bin/console cache:clear

# Reiniciar LSWS conforme padrao operacional do servidor.
sudo systemctl restart lsws
```

Se o ambiente usa comando diferente para OpenLiteSpeed/CyberPanel, usar o runbook local aprovado. Registrar horario, operador e resultado.

## Checklist Pos-Aplicacao

1. Validar limites PHP via web.
2. Validar `glpi_documenttypes` por consulta read-only.
3. Validar migrations/tabelas PostgreSQL por consulta read-only.
4. Reiniciar/invalidar cache conforme procedimento aprovado.
5. Enviar imagem, PDF/documento, audio e video em TESTE/PRODUCAO autorizados.
6. Confirmar `GLPI_DOCUMENT_UPLOAD_OK` e `GLPI_DOCUMENT_ITEM_LINK_OK`.
7. Confirmar ausencia de `DOCUMENT_UPLOADED_UNLINKED`.
8. Confirmar que `glpi_documents_items` recebeu vinculo para audio/video.

## Rollback Manual

1. Bloquear novas mudancas e registrar horario/motivo.
2. Restaurar backup de vhost/PHP se limites precisarem voltar.
3. Restaurar `glpi_documenttypes` a partir do backup local criado na mesma PRODUCAO.
4. Limpar cache GLPI.
5. Reiniciar LSWS/PHP conforme runbook local.
6. Rodar smoke curto.
7. Nao apagar documentos ja criados e nao alterar `glpi_documents_items` manualmente.

Exemplo de restauracao por backup local, somente com aprovacao humana:

```bash
GLPI_PROD_DB="sist_glpi"
MYSQL_DEFAULTS_FILE="/root/.my-prod.cnf"
BACKUP_TABLE="glpi_documenttypes_backup_20260520152216"
ARCHIVE_SUFFIX="$(date +%Y%m%d%H%M%S)"

scripts/ops/rollback_glpi_documenttypes.sh \
  --defaults-file "$MYSQL_DEFAULTS_FILE" \
  --database "$GLPI_PROD_DB" \
  --backup-table "$BACKUP_TABLE" \
  --archive-suffix "$ARCHIVE_SUFFIX"
```

Execucao manual, somente apos revisao:

```bash
scripts/ops/rollback_glpi_documenttypes.sh \
  --defaults-file "$MYSQL_DEFAULTS_FILE" \
  --database "$GLPI_PROD_DB" \
  --backup-table "$BACKUP_TABLE" \
  --archive-suffix "$ARCHIVE_SUFFIX" \
  --execute
```

```sql
RENAME TABLE glpi_documenttypes TO glpi_documenttypes_after_reconciliation_YYYYMMDDHHMMSS;
RENAME TABLE glpi_documenttypes_backup_YYYYMMDDHHMMSS TO glpi_documenttypes;
```

## Evidencias Obrigatorias

- Ambiente e data/hora.
- Operador responsavel.
- Resultado da checagem PHP.
- Nome da tabela `glpi_documenttypes_backup_<timestamp>`.
- Resultado read-only dos tipos audio/video.
- Resultado read-only das tabelas PostgreSQL.
- Logs sanitizados de upload/link.
- Resultado do smoke de audio/video.
