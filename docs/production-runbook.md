# Runbook de produção IntegaGLPI

Este runbook registra os passos necessários para subir GLPI 11 + plugin IntegaGLPI + integration-service sem hotfix manual. Não cole tokens reais no repositório; use os arquivos `.env.production` locais do servidor.

## Pré-flight

- Copie `.env.production.example` para `.env.production` no servidor e preencha segredos fora do Git.
- Gere `INTEGRATION_SERVICE_API_KEY` com pelo menos 32 caracteres e configure a mesma chave na tela do plugin.
- Mantenha `OUTBOUND_SEND_MODE=mock` até validar inbound, criação de chamado e roteamento.
- Ajuste Redis no host:

```bash
sudo sysctl vm.overcommit_memory=1
echo 'vm.overcommit_memory=1' | sudo tee /etc/sysctl.d/99-redis-overcommit.conf
```

## Docker produção

Use `docker-compose.prod.example.yml` como base:

- integration-service: `127.0.0.1:3002:3002`
- PostgreSQL: `127.0.0.1:5433:5432`
- Redis: sem porta pública
- ai-service opcional: `127.0.0.1:4001:4001`

Comandos típicos:

```bash
cp .env.production.example .env.production
docker compose -f docker-compose.prod.example.yml --env-file .env.production up -d postgres-prod redis-prod integration-service-prod
curl http://127.0.0.1:3002/health
```

## GLPI 11 / OpenLiteSpeed

- O DocumentRoot do vhost GLPI deve apontar para `public`, por exemplo `/home/sistema.example.com.br/public_html/public`.
- Habilite rewrite/roteamento do GLPI 11 no vhost.
- Não exponha a porta `3002` diretamente na internet.
- Configure o vhost público do webhook como proxy para `127.0.0.1:3002`.

Exemplo conceitual de proxy OpenLiteSpeed/CyberPanel:

```text
webhook.example.com.br -> 127.0.0.1:3002
Context / {
  type proxy
  URI /
  address 127.0.0.1:3002
}
```

Valide:

```bash
curl https://webhook.example.com.br/health
curl "https://webhook.example.com.br/webhook/meta?hub.mode=subscribe&hub.verify_token=<verify-token>&hub.challenge=ok"
```

## Upgrade GLPI 11

Executar manualmente em janela controlada, sem automatizar no deploy:

```bash
php bin/console db:update --allow-superuser
php bin/console system:check_requirements
php bin/console migration:utf8mb4
php bin/console migration:unsigned_keys
```

Após troca de senha do banco GLPI, revisar `config/config_db.php`. Em HTTPS, revisar `session.cookie_secure`. Diferenças de schema legado não bloqueantes devem ir para uma janela própria.

## Plugin IntegaGLPI

Na configuração do plugin:

- PostgreSQL externo: host do ponto de vista do GLPI/PHP.
- Integration-service URL em produção: `http://127.0.0.1:3002`.
- Integration auth key: mesmo valor de `INTEGRATION_SERVICE_API_KEY`.

O plugin chama o Node com:

```text
Authorization: Bearer <integration_auth_key>
```

Não use `x-api-key`.

## Meta Cloud API

Checklist:

- App Secret configurado no `.env.production`.
- Token permanente configurado fora do Git.
- Phone Number ID preenchido.
- Verify token igual ao configurado no webhook Meta.
- App inscrito em `subscribed_apps`.
- Campo `messages` habilitado.
- Templates aguardam aprovação `APPROVED`; não assuma envio real enquanto estiver `PENDING`.

## Validação controlada

1. `curl http://127.0.0.1:3002/health`
2. `curl https://webhook.example.com.br/health`
3. GET verify token do webhook Meta.
4. Enviar mensagem inbound real.
5. Confirmar `signature_valid=true` e `processing_status=processed`.
6. Confirmar menu de roteamento.
7. Clicar opção configurada e confirmar ticket criado no GLPI.
8. Confirmar `queue_id` preenchido em `conversations`.
9. Só depois alterar `OUTBOUND_SEND_MODE=real` em teste controlado e reiniciar o container.
10. Responder pelo GLPI e confirmar WhatsApp recebido.

Rollback operacional: volte `OUTBOUND_SEND_MODE=mock`, reinicie o integration-service e preserve logs para análise.

## Segurança

- Nunca versionar `.env.production`.
- Mascarar tokens e senhas em logs.
- Não usar `NODE_TLS_REJECT_UNAUTHORIZED=0` em produção. Se for necessário como exceção temporária, documente o incidente e corrija a cadeia de certificado.
