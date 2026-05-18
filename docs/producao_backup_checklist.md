# Checklist de Backup Producao

Backup e manual e deve acontecer antes de copiar pacote ou aplicar migration.

## Plugin GLPI

- [ ] Backup do diretorio atual `plugins/integaglpi`.
- [ ] Registrar versao atual do plugin.
- [ ] Registrar `build_id`/`package_id` atual, se existir.
- [ ] Validar tamanho do arquivo compactado.
- [ ] Gerar checksum do backup.

Exemplo sem segredo:

```bash
sha256sum integaglpi-backup-YYYYMMDD-HHMM.tar.gz
```

## Banco GLPI

- [ ] Backup do banco GLPI por ferramenta aprovada do ambiente.
- [ ] Validar tamanho do dump/backup.
- [ ] Gerar checksum.
- [ ] Armazenar fora do pacote da aplicacao.

## PostgreSQL Integration-Service

- [ ] Backup do banco externo do integration-service.
- [ ] Validar que backup inclui tabelas `glpi_plugin_integaglpi_*`.
- [ ] Gerar checksum.
- [ ] Armazenar fora do pacote da aplicacao.

## Configuracoes

- [ ] Backup do `.env` real, fora do repo e fora do pacote.
- [ ] Backup do `docker-compose` ou unidade de servico.
- [ ] Backup de configs de proxy/webserver.
- [ ] Backup de certificados/configs TLS sem publicar chave privada.

## Validacao

- [ ] Checksums registrados.
- [ ] Caminho de restauracao conhecido.
- [ ] Responsavel pelo rollback tem acesso aos backups.
- [ ] Backup nao contem arquivos temporarios ou payloads reais desnecessarios.

## Regras

- Nao anexar backup ao pacote de deploy.
- Nao commitar backup.
- Nao compartilhar `.env`, tokens, dumps ou certificados privados em chat.
