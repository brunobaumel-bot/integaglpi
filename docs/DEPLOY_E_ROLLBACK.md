# Deploy e Rollback - Baseline 8.x

## Deploy/rebuild oficial

Na raiz do repositorio:

```powershell
docker compose -f docker-compose.dev.yml build --no-cache integration-service
docker compose -f docker-compose.dev.yml up -d --force-recreate integration-service
```

Verificar containers:

```powershell
docker ps
docker logs --tail=200 glpi-integaglpi-integration
```

Verificar codigo dentro do container:

```powershell
docker exec glpi-integaglpi-integration sh -lc "grep -RniE 'MediaProcessingService|sendReplyButtons|solution_actions|DOWNLOAD_STREAM_UNSUPPORTED' /app 2>/dev/null | head -100"
docker exec glpi-integaglpi-integration sh -lc "ls -la /app/schema-migrations && ls -la /app/init-db.sql"
docker exec glpi-integaglpi-integration sh -lc "grep -Rni 'solution_actions\|media_info' /app/schema-migrations /app/init-db.sql /app/dist 2>/dev/null | head -100"
```

## Politica de restart

`docker-compose.dev.yml` usa `restart: unless-stopped` em:

- `postgres`
- `redis`
- `integration-service`
- `ai-service`

## Healthcheck

```powershell
curl http://localhost:3001/health
```

Esperado:

- HTTP 200 se Postgres estiver OK.
- HTTP 503 se Postgres estiver indisponivel.

## Rollback de imagem

Antes de deploy produtivo, marcar/taguear a imagem estavel 8.x:

```powershell
docker tag glpi-whats-integration-service:latest glpi-whats-integration-service:baseline-8x
```

Rollback:

```powershell
docker tag glpi-whats-integration-service:baseline-8x glpi-whats-integration-service:latest
docker compose -f docker-compose.dev.yml up -d --force-recreate integration-service
```

Se o ambiente usar registry, usar a tag equivalente publicada no registry.

## Backup antes de mudancas

PostgreSQL externo:

```powershell
docker exec glpi-integaglpi-postgres pg_dump -U <DB_USER> <DB_NAME> > backup_integaglpi_postgres.sql
```

MariaDB/GLPI:

```powershell
mysqldump -u <USER> -p <GLPI_DB_NAME> > backup_glpi_mariadb.sql
```

Nao commitar backups com dados reais.

## Validacao de schema apos deploy

No PostgreSQL externo:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'glpi_plugin_integaglpi_messages'
  AND column_name = 'media_info';

SELECT to_regclass('public.glpi_plugin_integaglpi_solution_actions');

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'glpi_plugin_integaglpi_solution_actions'
ORDER BY indexname;
```

Se `/app/schema-migrations` nao existir dentro do container, a imagem esta
antiga ou foi construida com Dockerfile incorreto. Rebuildar com `--no-cache` e
recriar o container antes de qualquer teste funcional.

## Desabilitar botoes interativos

Nao existe feature flag implementada para desabilitar botoes interativos. Se for
necessario rollback operacional rapido, usar rollback de imagem para versao
anterior ao deploy dos botoes ou reduzir `routing_options`/mensagens conforme
procedimento operacional aprovado.

Melhoria futura recomendada: feature flag para forcar menu textual.

## Voltar para menu textual

Sem feature flag, opcoes operacionais:

- rollback de imagem;
- configurar mais de 3 filas ativas para forcar fallback textual, se fizer sentido operacional;
- alterar temporariamente o envio interativo em codigo somente em hotfix controlado.

## Plugin PHP

Para interromper notificacoes do plugin sem alterar core GLPI:

- desabilitar o plugin pela UI de plugins do GLPI; ou
- remover temporariamente configuracao do integration-service na tela do plugin, se o objetivo for bloquear apenas envios outbound.

Nao editar core GLPI.

## Plano de contingencia rapido

- Confirmar incidente nos logs.
- Parar integration-service se o problema for outbound/Meta.
- Manter GLPI operacional.
- Restaurar imagem baseline anterior.
- Validar `/health`.
- Executar checklist minimo: criar ticket inbound, reply manual, midia open, solve/approve/reopen.
