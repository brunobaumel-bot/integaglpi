# Fechamento documental - Fase 8.2.1

PHASE_ID: `integaglpi_8_2_1_customer_experience_glpi_user_csat`

STATUS: `FUNCIONAL_EM_TESTE`

## 1. Resumo da fase

A Fase 8.2.1 entregou a camada de experiencia do cliente para o fluxo WhatsApp + GLPI:

- humanizacao dos textos principais de atendimento;
- cadastro base do contato com telefone, nome, empresa, e-mail e etiqueta/patrimonio;
- validacao de e-mail sem bloquear atendimento quando ausente ou invalido;
- vinculo seguro com usuario GLPI por e-mail unico e ativo;
- criacao controlada de usuario GLPI somente apos entidade definida;
- pesquisa de satisfacao via WhatsApp antes do fechamento final;
- exposicao dos dados da fase no Contexto WhatsApp do chamado.

O smoke operacional em TESTE foi aprovado pelo operador apos a correcao de schema descrita abaixo.

## 2. Escopo entregue

- Telefone vem do WhatsApp.
- Nome, empresa, etiqueta/patrimonio e motivo seguem o fluxo da Recepcao Inteligente.
- Etiqueta/patrimonio permanece com regra de 4 digitos ou opcao "Nao sei".
- E-mail e normalizado em lowercase/trim quando informado.
- E-mail ausente ou invalido nao bloqueia atendimento.
- Usuario GLPI existente e vinculado automaticamente apenas quando ha exatamente 1 usuario ativo por e-mail.
- Ambiguidade, usuario inativo ou ausencia de e-mail caem para fallback manual/operacional.
- Usuario GLPI novo so pode ser criado apos entidade real definida.
- Usuario criado pela integracao nao recebe perfil administrativo, senha, login automatico ou e-mail de boas-vindas.
- CSAT usa 3 opcoes: Muito satisfeito, Satisfeito e Insatisfeito.
- Muito satisfeito/Satisfeito seguem o fluxo de aprovacao/fechamento existente.
- Insatisfeito nao fecha automaticamente e sinaliza revisao/supervisao.

## 3. Correcao de schema aplicada

Durante o smoke em TESTE foi identificado o erro:

```text
column "email_address" does not exist
```

Impacto observado:

- `InboundWebhookService` falhava ao acessar campos de cadastro/e-mail;
- conversas ficavam sem criacao correta de ticket;
- o atendimento permanecia preso em fluxo pre-ticket.

Correcao aplicada:

- alinhamento do schema com a coluna canonica `email_address`;
- inclusao dos campos de e-mail, usuario GLPI e origem de vinculo em `glpi_plugin_integaglpi_contact_profile`;
- inclusao dos campos de CSAT em `glpi_plugin_integaglpi_solution_actions`;
- criacao da migration corretiva `014_customer_experience_schema_alignment.sql`;
- alinhamento do `integration-service/init-db.sql` para ambientes novos;
- restart do `integration-service` em TESTE apos aplicacao manual da correcao.

## 4. Migrations envolvidas

- `integration-service/schema-migrations/013_customer_experience_glpi_user_csat.sql`
  - adiciona campos da Fase 8.2.1 em `contact_profile` e `solution_actions`;
  - cria indice por `email_address`;
  - cria indice por `ticket_id, csat_rating`.

- `integration-service/schema-migrations/014_customer_experience_schema_alignment.sql`
  - migration corretiva, aditiva e idempotente;
  - usa apenas `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`;
  - reforca a existencia de `email_address`, campos de usuario GLPI e campos CSAT;
  - nao executa `DROP`, `TRUNCATE` ou `DELETE`.

## 5. Comandos SQL/PostgreSQL de validacao

```bash
docker exec -it glpi-integaglpi-postgres psql -U glpi_integaglpi -d glpi_integaglpi -c "
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'glpi_plugin_integaglpi_contact_profile'
      AND column_name IN (
        'email_address',
        'email_status',
        'email_validation_status',
        'email_validated_at',
        'glpi_user_id',
        'glpi_user_name',
        'glpi_user_source',
        'glpi_user_linked_at'
      )
    )
    OR
    (table_name = 'glpi_plugin_integaglpi_solution_actions'
      AND column_name IN (
        'csat_rating',
        'csat_comment',
        'supervisor_review_required',
        'supervisor_review_reason'
      )
    )
  )
ORDER BY table_name, column_name;
"

docker exec -it glpi-integaglpi-postgres psql -U glpi_integaglpi -d glpi_integaglpi -c "
SELECT
  id,
  phone_e164,
  status,
  queue_id,
  glpi_ticket_id,
  updated_at
FROM glpi_plugin_integaglpi_conversations
ORDER BY updated_at DESC
LIMIT 20;
"

docker exec -it glpi-integaglpi-postgres psql -U glpi_integaglpi -d glpi_integaglpi -c "
SELECT
  c.id AS conversation_id,
  c.phone_e164,
  c.status,
  c.glpi_ticket_id,
  p.requester_name,
  p.company_name_raw,
  p.email_address,
  p.email_status,
  p.glpi_user_id,
  m.glpi_entity_id,
  m.glpi_entity_name,
  m.is_active AS memory_active
FROM glpi_plugin_integaglpi_conversations c
LEFT JOIN glpi_plugin_integaglpi_contact_profile p
  ON p.phone_e164 = c.phone_e164
 AND p.is_active = TRUE
LEFT JOIN glpi_plugin_integaglpi_contact_entity_memory m
  ON m.phone_e164 = c.phone_e164
 AND m.is_active = TRUE
WHERE c.glpi_ticket_id IN (
  2112319219,
  2112319220,
  2112319221,
  2112319222,
  2112319223
)
ORDER BY c.updated_at DESC;
"

docker exec -it glpi-integaglpi-postgres psql -U glpi_integaglpi -d glpi_integaglpi -c "
SELECT
  id,
  ticket_id,
  conversation_id,
  phone_e164,
  action,
  status,
  csat_rating,
  supervisor_review_required,
  error_code,
  error_message,
  created_at,
  updated_at
FROM glpi_plugin_integaglpi_solution_actions
WHERE ticket_id IN (
  2112319219,
  2112319220,
  2112319221,
  2112319222,
  2112319223
)
ORDER BY created_at DESC;
"
```

## 6. Evidencias de smoke

Resultado informado pelo operador:

- correcao de schema resolveu o erro;
- Fase 8.2.1 funcional em TESTE;
- testes e smoke OK;
- `email_address` existe em `glpi_plugin_integaglpi_contact_profile`;
- colunas CSAT existem em `glpi_plugin_integaglpi_solution_actions`;
- e-mail nao informado nao bloqueou atendimento;
- vinculo de usuario GLPI validado no smoke.

## 7. Tickets e conversas de teste

Tickets criados no smoke:

- `2112319219`
- `2112319220`
- `2112319221`
- `2112319222`
- `2112319223`

Vinculo validado:

- telefone `+554199166562`;
- `glpi_user_id = 121`.

Conversa antiga:

- `9cb60d7d-bfc6-491e-bc5a-863aad10fa1c`;
- classificada como residuo pre-fix;
- nao deve ser tratada como falha da Fase 8.2.1.

## 8. Validacoes tecnicas registradas

Validações executadas durante a correcao de schema:

```bash
npx vitest run tests/schemaBootstrap.test.ts tests/contactProfileRepository.test.ts tests/contactProfileService.test.ts tests/customerExperienceService.test.ts tests/inboundWebhookService.test.ts
npx tsc --noEmit
npm test
git diff --check
git diff --name-only
git status --short
```

Resultados registrados:

- testes especificos: OK;
- `npx tsc --noEmit`: OK;
- `npm test`: OK, 37 arquivos / 291 testes;
- `git diff --check`: OK, com avisos CRLF do Git;
- sem deploy automatico;
- sem commit automatico;
- sem alteracao de producao.

## 9. Ressalvas aceitas

- Cursor retornou `CLOSE_COM_RESSALVAS` antes do fechamento documental.
- A correcao de schema foi validada em TESTE, mas producao exige gate proprio.
- O workspace possui changeset amplo das fases 8.1/8.2.1; o pacote Git deve ser revisado manualmente.
- A conversa `9cb60d7d-bfc6-491e-bc5a-863aad10fa1c` e residuo pre-fix.
- A promocao para producao nao esta autorizada por este documento.

## 10. Producao: checklist manual obrigatorio

Antes de qualquer promocao para producao:

- confirmar aprovacao humana formal;
- executar backup do PostgreSQL externo;
- executar backup do plugin GLPI;
- confirmar plano de rollback;
- revisar diff final com `git diff --name-only` e `git diff --stat`;
- revisar migrations 013 e 014;
- aplicar migrations manualmente em janela controlada;
- reiniciar servicos manualmente;
- executar smoke minimo em producao;
- confirmar que nao ha alteracao automatica de tickets antigos;
- confirmar que usuario GLPI nao recebe senha, perfil administrativo ou login automatico;
- confirmar que insatisfacao no CSAT nao fecha chamado.

## 11. Proxima fase recomendada

Proxima fase sugerida:

- `integaglpi_8_2_2_contact_agenda_email_safe_link_central_ux`

Escopo recomendado para a proxima fase:

- refinamento operacional da agenda de contatos;
- UX minima na Central para visualizar/corrigir dados de cadastro;
- revisao de campos de e-mail e vinculo GLPI no plugin;
- sem iniciar backoffice completo, IA, contratos, LogMeIn ou CRM.

## 12. Pacote Git sugerido para fechamento manual

Comandos de auditoria:

```bash
git status --short
git diff --name-only
git diff --stat
git diff --check
```

Pacote manual sugerido:

```bash
git add docs/fase_8_2_1_fechamento.md
git add integration-service/schema-migrations/013_customer_experience_glpi_user_csat.sql
git add integration-service/schema-migrations/014_customer_experience_schema_alignment.sql
git add integration-service/init-db.sql
git add integration-service/src/domain/services/CustomerExperienceService.ts
git add integration-service/src/domain/services/InboundWebhookService.ts
git add integration-service/src/domain/services/OutboundMessageService.ts
git add integration-service/src/domain/services/ContactProfileService.ts
git add integration-service/src/adapters/glpi/GlpiClient.ts
git add integration-service/src/adapters/glpi/glpiTypes.ts
git add integration-service/src/repositories/postgres/PostgresContactProfileRepository.ts
git add integration-service/src/repositories/postgres/PostgresSolutionActionRepository.ts
git add integration-service/src/repositories/contracts/SolutionActionRepository.ts
git add integration-service/tests/customerExperienceService.test.ts
git add integration-service/tests/contactProfileRepository.test.ts
git add integration-service/tests/glpiClient.test.ts
git add integration-service/tests/inboundWebhookService.test.ts
git add integration-service/tests/solutionNotificationService.test.ts
git add integration-service/tests/solutionActionRepository.test.ts
git add integration-service/tests/schemaBootstrap.test.ts
git add integaglpi/src/External/Repository/TicketContextRepository.php
git add integaglpi/src/Service/TicketContextService.php
git add integaglpi/templates/ticket_tab.php
```

Commit manual sugerido:

```bash
git commit -m "feat(integaglpi): close 8.2.1 customer experience user link and csat"
```

Observacao:

- este documento nao executa `git add`, `git commit`, `git push`, deploy ou migration;
- toda promocao continua manual e dependente de gate humano.
