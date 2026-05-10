# Security Baseline

## Meta webhook

- Todo webhook deve passar por validacao de `X-Hub-Signature-256`.
- O algoritmo obrigatorio e `HMAC-SHA256` com `META_APP_SECRET`.
- Requisicoes invalidas devem ser rejeitadas e auditadas por log estruturado.

## GLPI REST tokens

- O acesso ao GLPI deve usar `GLPI_APP_TOKEN` e `GLPI_USER_TOKEN` via headers HTTP.
- Os tokens devem entrar exclusivamente por variaveis de ambiente.
- Integracoes com o GLPI devem manter timeout, retry controlado e tratamento explicito de erro.

## Infra

- Redis e obrigatorio para cache de contatos e sessao de conversas.
- Secrets devem entrar exclusivamente por variaveis de ambiente.
- Integracoes externas devem usar timeout e retry controlado.
