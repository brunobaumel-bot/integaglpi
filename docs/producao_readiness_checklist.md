# Checklist TESTE para PRODUÇÃO

Promoção manual apenas. Não executar deploy automático.

## Pré-pacote

- Confirmar que `package_manifest.json` está presente.
- Confirmar `build_id` e `package_id`.
- Confirmar `git diff --name-only` no dev local.
- Confirmar que cloud não depende de Git.
- Confirmar que `.env` real não está no pacote.
- Confirmar que não há arquivos temporários, logs, payloads ou dumps no pacote.

## Backup

- Backup do diretório atual do plugin `integaglpi`.
- Backup do banco GLPI.
- Backup do banco PostgreSQL do `integration-service`.
- Backup do `.env` real, mantido fora do pacote.
- Backup do `docker-compose` ou serviço equivalente.
- Backup/registro de certificados TLS e renovação.

## Readiness em TESTE

- Abrir Diagnóstico Operacional.
- Conferir `build_id` e `package_id` no plugin.
- Conferir `build_id` e `package_id` do Node.
- Confirmar que não há `runtime_mismatch`.
- Confirmar PostgreSQL, Redis, GLPI API e Meta configurados.
- Confirmar migrations esperadas.
- Rodar smoke completo em TESTE.

## Promoção manual

- Copiar pacote manual para cloud/produção.
- Aplicar migrations manualmente apenas se aprovadas e necessárias.
- Reiniciar serviço Node.
- Reiniciar PHP-FPM/LSWS ou invalidar OPcache.
- Abrir Diagnóstico Operacional em produção.
- Validar `build_id` e `package_id`.
- Rodar smoke produção mínimo.

## Pós-deploy

- Monitorar erros PHP/Node sanitizados.
- Monitorar delivery failed.
- Monitorar inatividade/autoclose.
- Monitorar Contratos/Horas read-only.
- Monitorar reabertura com motivo.
- Confirmar IA Supervisora read-only e sem IA Copiloto.
