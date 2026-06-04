# Deploy e Rollback Manual

Fase: `integaglpi_post_production_baseline_001`

Este documento contém exemplos manuais com placeholders. Nenhum comando deve ser executado automaticamente.

## Pré-Deploy Checklist

- [ ] Backup do plugin pronto.
- [ ] Backup do banco GLPI pronto.
- [ ] Backup do PostgreSQL do integration-service pronto.
- [ ] Backup do `.env` real fora do repositório pronto.
- [ ] Reconciliacao manual pre-producao revisada conforme `docs/pre_prod_manual_state_reconciliation.md`.
- [ ] Backup local de PRODUCAO para `glpi_documenttypes` pronto, se tipos audio/video forem ajustados.
- [ ] Rollback preparado e testado em TESTE.
- [ ] Smoke em TESTE aprovado.
- [ ] Diff real revisado.
- [ ] Cursor aprovou o diff real.
- [ ] Pacote não contém `.env`, `.ovpn`, logs, dumps, backups ou segredos.
- [ ] IA permanece OFF em produção.

## Exemplo Manual de Sync TESTE para PRODUÇÃO

Exemplo ilustrativo. Ajustar variaveis conforme procedimento aprovado; nao colar placeholders com `<` ou `>` no shell.

```bash
PACKAGE_SOURCE="/caminho/do/pacote/"
PROD_TARGET="usuario@host-producao:/caminho/destino/"

rsync -avz \
  --exclude=.env \
  --exclude=.ovpn \
  --exclude=*.log \
  --exclude=*.sql \
  --exclude=*.dump \
  --exclude=node_modules \
  --exclude=vendor \
  --exclude=.git \
  "$PACKAGE_SOURCE" "$PROD_TARGET"
```

Este exemplo não deve usar `--delete`. Cleanup, quando necessário, é manual, revisado e autorizado por humano.

## Pós-Deploy Smoke Curto

- Abrir health/readiness.
- Confirmar build/pacote esperado.
- Confirmar Console/Central.
- Confirmar inbound.
- Confirmar outbound manual.
- Confirmar criação/follow-up GLPI.
- Confirmar delivery/read/failed.
- Confirmar reabertura com motivo.
- Confirmar CSAT.
- Confirmar IA OFF em produção.

## Rollback Manual Curto

- Bloquear novas mudanças.
- Registrar horário, operador, build/pacote e motivo.
- Restaurar plugin do backup aprovado.
- Restaurar pacote Node do backup aprovado.
- Restaurar vhost/PHP do backup aprovado se limites PHP precisarem voltar.
- Restaurar `glpi_documenttypes` a partir do backup local de PRODUCAO se o ajuste de tipos precisar voltar.
- Usar `scripts/ops/rollback_glpi_documenttypes.sh` em dry-run antes de qualquer `--execute`.
- Usar `GLPI_PROD_DB`, `MYSQL_DEFAULTS_FILE`, `BACKUP_TABLE` e `ARCHIVE_SUFFIX` como variaveis revisadas; nao colar placeholders com `<` ou `>` no shell.
- Preservar `.env` real de produção.
- Reiniciar serviços somente conforme procedimento operacional autorizado.
- Rodar smoke curto.
- Registrar resultado.

Exemplo manual para rollback de `glpi_documenttypes`, usando apenas backup criado na propria PRODUCAO:

```sql
RENAME TABLE glpi_documenttypes TO glpi_documenttypes_after_reconciliation_YYYYMMDDHHMMSS;
RENAME TABLE glpi_documenttypes_backup_YYYYMMDDHHMMSS TO glpi_documenttypes;
```

Nao apagar documentos ja criados e nao alterar `glpi_documents_items` manualmente.

## Cleanup Manual

- Não executar cleanup automático.
- Não usar comandos destrutivos sem revisão humana.
- Remover arquivos temporários somente após conferência do pacote e aprovação.
- Nunca remover backups antes do fechamento da janela de rollback.

## Segurança Documental

Nunca versionar, copiar ou colar em documentação: .env real, .ovpn, tokens, Bearer tokens, PSK, Phone Number ID real, senhas, dumps SQL, backups reais, payloads brutos sensíveis ou dados pessoais desnecessários.

## V8 Final — Manual Release Gate

Antes de qualquer promoção:

- [ ] Homologação aprovada com smoke final V8.
- [ ] Backup do plugin, Node, GLPI DB, PostgreSQL e configurações externas validado.
- [ ] Rollback manual testado ou revisado.
- [ ] Feature flags revisadas com defaults seguros.
- [ ] LGPD owner/DPO definido ou produção bloqueada.
- [ ] Logs/UI verificados contra PII, segredo e payload bruto.
- [ ] Go/no-go assinado por responsáveis.

Não há deploy automático, promoção automática, migration automática ou expurgo automático neste procedimento.
