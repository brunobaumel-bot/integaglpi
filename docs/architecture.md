# Architecture Notes

## Clean architecture baseline

- `controllers`: recebem HTTP e traduzem requests/responses.
- `domain/services`: hospedam servicos de aplicacao e contratos de dominio.
- `adapters`: encapsulam comunicacao com GLPI, Meta e provedores externos.
- `middleware`: seguranca transversal, como validacao de webhook.
- `infra`: banco, Redis, autenticacao REST do GLPI, configuracao e observabilidade.

## Security baseline

- Assinatura Meta obrigatoria em todo webhook.
- Secrets apenas por ambiente.
- Timeouts e retries concentrados em adaptadores.
- Logs estruturados para auditoria de eventos sensiveis.

## Database naming

Todas as tabelas e artefatos persistentes devem respeitar o prefixo:

`glpi_plugin_integaglpi_`
