# Release Runbook - IntegraGLPI V7

Phase: `integaglpi_v7_m5_enterprise_controlado_001`
Updated: 2026-06-03

## Purpose

Este runbook fecha o V7 como operação controlada. Ele não autoriza deploy automático, rsync, aplicação de migration em produção, alteração de `.env` ou envio WhatsApp real.

## Release Gates

1. Workspace limpo antes do pacote:
   - `git status --short`
   - `git diff --check`
2. Validações técnicas:
   - `cd integration-service && npx tsc --noEmit`
   - `cd integration-service && npx vitest run`
   - `find integaglpi -name "*.php" -exec php -l {} \;`
   - `composer test` somente se vendor/PHPUnit estiver disponível; não instalar dependência durante release.
3. Cursor review:
   - `CLOSE` ou `CLOSE_COM_RESSALVAS` para diff real.
4. Commit manual:
   - `git add` explícito por arquivo.
   - Nunca `git add .`.
5. Deploy manual:
   - janela aprovada;
   - backup confirmado;
   - rollback pronto;
   - sem execução automática de migration.
6. Smoke pós-deploy:
   - WhatsApp inbound/outbound em modo aprovado;
   - Central;
   - ticket tab;
   - RBAC/CSRF;
   - IA read-only;
   - LogMeIn OFF por padrão.

## Pre-release Checklist

| Item | Owner | Evidence |
| --- | --- | --- |
| Cursor review aprovado | Tech lead | Veredito anexado ao pacote |
| `npx vitest run` PASS | Backend owner | Log de teste |
| `php -l` PASS | Plugin owner | Log de lint |
| `.env` sem alteração no git | Infra owner | `git diff --name-only` |
| Migrations revisadas | DBA | Lista e comando manual |
| Rollback revisado | Infra owner | Plano abaixo |
| Flags revisadas | Segurança/Admin | `docs/feature_flags_matrix.md` |
| LGPD/PII revisado | DPO/Segurança | checklist |

## Manual Deployment Outline

1. Confirmar commit alvo.
2. Criar backup do plugin atual e banco conforme procedimento operacional.
3. Atualizar código do plugin e integration-service pelo método aprovado da empresa.
4. Rebuild/restart somente se houver alteração Node/ambiente que exija.
5. Não alterar `.env` sem ticket operacional separado.
6. Aplicar migration apenas se houver autorização humana e em janela própria.
7. Rodar smoke curto.
8. Registrar resultado.

## Rollback Manual

1. Parar tráfego operacional conforme janela.
2. Restaurar artefato anterior do plugin/integration-service.
3. Reiniciar serviços necessários.
4. Confirmar health endpoints.
5. Se migration aditiva de índice tiver sido aplicada, rollback normalmente não exige remoção imediata. Remover índice apenas com DBA e análise.
6. Manter dados operacionais; não executar delete/truncate como rollback.

## Critical Abort Conditions

- `.env` alterado no diff.
- Migration destrutiva.
- Falha em CSRF/RBAC.
- `OUTBOUND_SEND_MODE=real` em TESTE.
- Log ou UI com token/secret/PII bruta.
- IA enviando WhatsApp.
- IA mutando ticket.
- KB publicada automaticamente.
- LogMeIn criando sessão remota ou chamando endpoint de ação.
- Node acessando MariaDB GLPI.
- Produção sem gate humano.

## Final Smoke V7

Executar os smokes em `docs/smoke_tests.md`, seção `V7 Final - Enterprise Controlado`.

## Known Release Notes

- LogMeIn permanece read-only e opcional.
- Cloud permanece desabilitada por padrão.
- Problem management é assistivo/read-only.
- Coaching é não punitivo e agregado.
- Retenção LGPD precisa de owner humano antes de qualquer expurgo automático.
