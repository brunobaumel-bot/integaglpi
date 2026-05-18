# Checklist de pacote para TESTE - IntegaGLPI

Use este checklist antes de copiar o pacote para o ambiente de TESTE.

## Escopo

- TESTE apenas.
- Producao permanece bloqueada ate smoke final.
- Nao incluir segredos reais no pacote.
- Nao alterar core GLPI.
- Nao usar `git add`, `git commit` ou deploy automatico durante revisao.

## Validacoes locais

### PHP

```bash
php -l integaglpi/setup.php
php -l integaglpi/front/config.form.php
php -l integaglpi/front/routing.options.form.php
php -l integaglpi/src/Service/PluginConfigService.php
php -l integaglpi/src/Renderer/ConfigPageRenderer.php
php -l integaglpi/src/Renderer/TicketTabRenderer.php
find integaglpi -name "*.php" -not -path "*/vendor/*" -print0 | xargs -0 -n1 php -l
```

### Node

```bash
cd integration-service
npm run build
npm test
cd ..
```

### Git

```bash
git diff --check
git diff --name-only
git status --short --untracked-files=all
```

## Greps obrigatorios

```bash
grep -RniE "TicketConversation|AuditMenu|RoutingSafetyMenu|RoutingSafetyService" integaglpi --exclude-dir=vendor
grep -RniE "registerClass|registerStandardTab" integaglpi/setup.php integaglpi/inc integaglpi/src --exclude-dir=vendor

grep -RniE "entity_selection_attempts|\\bstate\\b|\\bstatus\\b" integration-service/init-db.sql integration-service/schema-migrations/006_entity_selection_attempts.sql integration-service/src integration-service/tests
grep -RniE "contact_entity_memory|glpi_intega_contact_entity_mem_phone_uq|glpi_intega_contact_entity_mem_phone_active_uq" integration-service/init-db.sql integration-service/schema-migrations/007_contact_entity_memory.sql integration-service/src integration-service/tests
grep -RniE "dead_letter|source_kind|source_payload|operation_type|failure_type|payload_json" integration-service/init-db.sql integration-service/schema-migrations/010_dead_letter.sql integration-service/src integration-service/tests
grep -RniE "snapshot_json" integaglpi integration-service/init-db.sql integration-service/schema-migrations/009_conversation_profile_snapshot.sql --exclude-dir=vendor

grep -RniE "DROP TABLE|TRUNCATE|DELETE FROM" integration-service/init-db.sql integration-service/schema-migrations integaglpi --exclude-dir=vendor
grep -RniE "x-api-key|access_token|Phone Number ID" integaglpi integration-service/src integration-service/tests --exclude-dir=vendor
```

## Criterios esperados

- `setup.php` nao registra classe inexistente.
- Aba WhatsApp segue registrada por `PluginIntegaglpiTicketRuntime`.
- Menu do plugin mantem Central, Filas, Opcoes de roteamento e Configuracao.
- `config.form.php` abre mesmo com PostgreSQL externo indisponivel e permite salvar nova conexao.
- `entity_selection_attempts` usa `status`, nao `state`.
- `contact_entity_memory` nao tem UNIQUE global em `phone_e164`; usa indice parcial em memoria ativa.
- `dead_letter` usa `operation_type`, `failure_type` e `payload_json`; nao cria indice em `source_kind`.
- Nenhum `DROP TABLE`, `TRUNCATE` ou `DELETE FROM`.

## Aplicacao em TESTE

Depois de copiar o pacote para TESTE:

```bash
rsync -av --delete /home/azureuser/projeto/integaglpi/ /home/glpi.eticainformatica.com.br/public_html/plugins/integaglpi/
chown -R glpie7867:glpie7867 /home/glpi.eticainformatica.com.br/public_html/plugins/integaglpi
systemctl restart lsws
rm -rf /home/glpi.eticainformatica.com.br/public_html/files/_cache/*

cd /home/azureuser/projeto/integration-service
docker-compose -f docker-compose.dev.yml build --no-cache integration-service
docker-compose -f docker-compose.dev.yml up -d --force-recreate integration-service
```

Use `docker-compose`, nao `docker compose`, se este for o padrao disponivel no servidor.
