# Runtime Manifest e Readiness

Fase: `integaglpi_operational_hardening_and_production_readiness_001`

Este documento define o controle mínimo de consistência entre pacote local, plugin GLPI e `integration-service`.

## Objetivo

- Confirmar `build_id` e `package_id` antes de promover TESTE para PRODUÇÃO.
- Detectar pacote incompleto ou runtime divergente sem escrever em banco.
- Exibir apenas diagnóstico sanitizado para operadores autorizados.

## Manifesto

O arquivo `package_manifest.json` deve acompanhar o pacote manual. Ele contém:

- `build_id`;
- `package_id`;
- `phase_ids`;
- arquivos críticos;
- hashes SHA-256;
- migrations esperadas;
- política de não incluir segredos.

O manifesto não deve conter `.env`, tokens, senhas, DSN completo, payloads reais ou caminhos absolutos sensíveis.

## Diagnóstico do Plugin

A tela `Diagnóstico Operacional` é read-only e mostra:

- versão do plugin;
- `build_id` e `package_id` locais;
- status do manifesto;
- readiness do Node;
- alerta `runtime_mismatch` quando plugin e Node divergem;
- dica de OPcache/cache para cloud sem Git.

Ela não executa comandos de servidor e não altera tickets, contratos ou mensagens.

## Readiness do Node

O endpoint interno `/internal/glpi/diagnostics` expõe somente dados sanitizados:

- PostgreSQL: `ok` e latência;
- Redis: configurado e status do cliente;
- GLPI API: configurado, `ok`, latência e estágio de erro sanitizado;
- Meta: configurado e allowlist;
- schema/migrations essenciais;
- `build_id`/`package_id`;
- categorias de diagnóstico.

## Categorias Padronizadas

- `connection`
- `permission`
- `schema`
- `query`
- `timeout`
- `runtime_mismatch`
- `package_incomplete`
- `config_missing`
- `external_api`
- `validation`
- `php_runtime_error`

## Critério de Go/No-Go

Não promover se:

- manifesto ausente;
- `package_incomplete`;
- `runtime_mismatch`;
- readiness sem PostgreSQL;
- GLPI API indisponível;
- segredos aparecendo no diagnóstico;
- OPcache/cache não reiniciado após troca manual do pacote.
