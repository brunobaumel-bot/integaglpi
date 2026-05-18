# Matriz de Configuração IntegraGLPI

Status: operacional, sem deploy automatico.

## Configuração pelo plugin GLPI

Use a interface do plugin para parâmetros operacionais sem segredo:

- catálogo de mensagens automáticas;
- horário comercial e cooldowns;
- templates locais aprovados manualmente;
- filas e opções de roteamento visíveis;
- entidades padrão ou entidade de triagem, quando aplicável;
- limites e modos operacionais de inatividade;
- flags de UI;
- modelo nominal da IA Supervisora quando não for segredo;
- habilitação visual da IA Supervisora no GLPI, mantendo produção desligada por padrão.

O plugin pode exibir status e valores mascarados, mas não deve revelar segredo completo.

## Configuração por `.env`

Mantenha no `.env` do `integration-service` ou do ambiente de execução:

- `DB_PASSWORD`;
- `POSTGRES_PASSWORD`;
- `META_ACCESS_TOKEN`;
- `META_APP_SECRET`;
- `META_VERIFY_TOKEN`;
- `GLPI_APP_TOKEN`;
- `GLPI_USER_TOKEN`;
- `INTEGRATION_SERVICE_API_KEY`;
- tokens Bearer ou x-api-key;
- certificados, VPN e credenciais de infraestrutura.

O plugin GLPI nao edita `.env`, nao grava token Meta e nao deve imprimir segredo em tela ou log.

## Produção

- IA Supervisora permanece desligada por padrão em produção.
- Alterações de `.env`, migrations, deploy e smoke são gates humanos.
- Configuração operacional pode ser ajustada no plugin apenas por perfil autorizado.
