# Matriz TESTE vs PRODUCAO

Nao preencher valores secretos neste documento. Usar apenas nomes logicos, status e referencias mascaradas.

| Item | TESTE | PRODUCAO | Regra |
| --- | --- | --- | --- |
| GLPI URL | `<glpi-teste-url>` | `<glpi-producao-url>` | Separadas |
| Plugin path | `plugins/integaglpi` | `plugins/integaglpi` | Pacote manual |
| Integration-service URL | `<node-teste-url>` | `<node-producao-url>` | Separadas |
| PostgreSQL host | `<postgres-teste>` | `<postgres-producao>` | Bancos separados |
| PostgreSQL database | `<db-teste>` | `<db-producao>` | Sem compartilhamento |
| Redis | `<redis-teste>` | `<redis-producao>` | Separado por ambiente |
| Meta Phone Number ID | mascarado | mascarado | Nunca registrar completo |
| Meta Webhook Guard | ativo | ativo obrigatorio | Nao enfraquecer |
| META_ACCESS_TOKEN | `.env` TESTE | `.env` PRODUCAO | Nunca no plugin |
| GLPI_APP_TOKEN | `.env` TESTE | `.env` PRODUCAO | Nunca no plugin |
| GLPI_USER_TOKEN | `.env` TESTE | `.env` PRODUCAO | Nunca no plugin |
| INTEGRATION_SERVICE_API_KEY | `.env` TESTE | `.env` PRODUCAO | Nunca em docs |
| IA Supervisora | read-only | off/read-only | Sem IA Copiloto |
| IA Copiloto | off | off | Fora do rollout |
| Cloud Git | opcional local | ausente | Pacote manual |
| OPcache | conforme ambiente | reiniciar/invalidate | Pos-pacote |

## Flags de IA

- Producao deve iniciar com IA customer-facing desligada.
- IA Supervisora, se visivel, deve ser read-only.
- Nao acionar Ollama/modelo durante smoke de producao.

## Isolamento Obrigatorio

- TESTE nao pode apontar para banco de PRODUCAO.
- PRODUCAO nao pode usar Redis de TESTE.
- Meta de PRODUCAO deve ter allowlist/Webhook Guard revisado.
- Tokens nunca saem do `.env` real do ambiente.
