# Fechamento Geral 8.1 a 8.5

Status: pronto para pacote controlado e deploy manual, sem promocao automatica.

## Escopo Fechado

### 8.1 - WhatsApp + GLPI

- Webhook Meta com isolamento por `META_PHONE_NUMBER_ID`.
- Conversas, mensagens, midias e anexos WhatsApp integrados ao GLPI.
- Selecao de entidade, memoria ativa de entidade e contexto WhatsApp no ticket.
- Auditoria operacional e tratamento de erros sem payload bruto.

### 8.2 - Experiencia, CSAT e Inatividade

- Humanizacao de mensagens principais.
- Cadastro base do contato, email opcional e vinculo/criacao segura de usuario GLPI.
- CSAT antes do fechamento no fluxo normal de solucao.
- Regua de inatividade com lembretes e encerramento por falta de resposta.

### 8.3 - Backoffice Supervisor

- Painel supervisor read-only.
- Indicadores operacionais, qualidade, CSAT, inatividade e chamados em risco.
- Respeito a permissoes GLPI, entidades ativas e mascaramento LGPD.

### 8.4 - Contratos e Banco de Horas

- Contratos operacionais por entidade.
- Consumo consultivo por `glpi_tickettasks.actiontime` e ajustes manuais auditados.
- Sem faturamento automatico, sem bloqueio automatico e sem alerta WhatsApp/email.

### 8.5 - IA Supervisora

- IA supervisora read-only, local/Ollama, sob demanda.
- Sem conversa com cliente, sem envio WhatsApp, sem alteracao de ticket, CSAT, contrato ou horas.
- Saida JSON estruturada, PII mascarada e feedback do supervisor.
- Producao deve permanecer com IA desabilitada.

## Ressalvas Aceitas

- O workspace contem changeset amplo das fases 8.1 a 8.5 e deve ser empacotado manualmente com revisao humana.
- TESTE pode manter IA habilitada para smoke controlado.
- Producao deve iniciar com `AI_SUPERVISOR_ENABLED=false` e UI PHP da IA desligada.
- Segredos expostos ou compartilhados durante testes devem ser rotacionados antes da producao.
- Para o `integration-service`, a fonte da verdade dos nomes de variaveis e `integration-service/src/config/env.ts`.
- A configuracao PHP/GLPI da IA usa o checkbox persistido do plugin e tambem deve ficar desligada em producao.

## Pacote de Producao

Entram no pacote manual:

- `integaglpi/**`
- `integration-service/src/**`
- `integration-service/package.json`
- `integration-service/package-lock.json`
- `integration-service/schema-migrations/**`
- `integration-service/init-db.sql`
- `integration-service/.env.example`
- `integration-service/.env.production.example`
- `docs/**`

Nao entram no pacote:

- `.env`
- `.env.*` com valores reais; exemplos sanitizados como `.env.example` e `.env.production.example` podem entrar
- arquivos `.ovpn`, certificados, chaves privadas ou perfis VPN
- backups, dumps e exports de banco
- logs
- `node_modules`
- `dist` gerado localmente, salvo estrategia manual aprovada
- tar/zip temporario
- tokens, senhas, API keys e payloads reais

## Plano de Rotacao de Segredos

Antes do deploy em producao, rotacionar e registrar em cofre seguro:

- `GLPI_APP_TOKEN`
- `GLPI_USER_TOKEN`
- `META_ACCESS_TOKEN`
- `META_APP_SECRET`, se usado
- `META_VERIFY_TOKEN`
- `INTEGRATION_SERVICE_API_KEY`
- `DB_PASSWORD`
- credenciais VPN, se algum perfil foi usado em TESTE

Os novos valores devem ser aplicados apenas no servidor, nunca no repositorio ou em docs.

## Gate Humano

Antes da producao:

1. Revisar diff final.
2. Confirmar pacote sem segredos.
3. Fazer backup.
4. Aplicar migrations manualmente.
5. Reiniciar servicos manualmente.
6. Executar smoke de producao.
7. Manter rollback preparado.
