# Fase 8.2.1 — Customer Experience, Usuario GLPI e CSAT

PHASE_ID: `integaglpi_8_2_1_customer_experience_glpi_user_csat`

CURSOR_VERDICT: `CLOSE_COM_RESSALVAS`

## Resumo

A Fase 8.2.1 implementou melhorias de experiencia do atendimento WhatsApp, cadastro base do contato, vinculo/criacao controlada de usuario GLPI e pesquisa rapida de satisfacao antes do fechamento final.

O changeset aberto da Fase 8.1 foi tratado como `ACCEPTED_8_1_BASELINE`, conforme decisao do operador. Esta nota existe para registrar rastreabilidade da Fase 8.2.1 sem alterar comportamento funcional.

## Escopo Implementado

- Humanizacao dos textos principais enviados ao cliente.
- Coleta e normalizacao de e-mail no perfil do contato.
- E-mail invalido ou ausente nao bloqueia atendimento.
- Vinculo automatico com usuario GLPI somente por e-mail valido, unico e ativo.
- Criacao controlada de usuario GLPI apenas apos entidade real definida.
- Usuario GLPI criado sem senha, sem perfil administrativo e sem login automatico.
- Inclusao de solicitante GLPI no ticket quando vinculo seguro existir.
- CSAT via WhatsApp com 3 opcoes: Muito satisfeito, Satisfeito e Insatisfeito.
- CSAT positivo aprova/fecha pelo fluxo existente.
- CSAT insatisfeito mantem/reabre atendimento e sinaliza revisao.
- Contexto WhatsApp exibe perfil, e-mail, vinculo GLPI e status de CSAT.

## Arquivos Revisados/Tocados

- `integration-service/schema-migrations/013_customer_experience_glpi_user_csat.sql`
- `integration-service/src/domain/services/CustomerExperienceService.ts`
- `integration-service/tests/customerExperienceService.test.ts`
- `integration-service/src/adapters/glpi/GlpiClient.ts`
- `integration-service/src/adapters/glpi/glpiTypes.ts`
- `integration-service/tests/glpiClient.test.ts`
- `integration-service/src/domain/services/InboundWebhookService.ts`
- `integration-service/src/domain/services/EntitySelectionService.ts`
- `integration-service/src/domain/services/OutboundMessageService.ts`
- `integration-service/src/repositories/contracts/SolutionActionRepository.ts`
- `integration-service/src/repositories/postgres/PostgresSolutionActionRepository.ts`
- `integration-service/tests/inboundWebhookService.test.ts`
- `integration-service/tests/solutionNotificationService.test.ts`
- `integration-service/tests/solutionActionRepository.test.ts`
- `integration-service/src/buildDependencies.ts`
- `integration-service/src/domain/services/ContactProfileService.ts`
- `integration-service/src/repositories/postgres/PostgresContactProfileRepository.ts`
- `integration-service/init-db.sql`
- `integaglpi/src/External/Repository/TicketContextRepository.php`
- `integaglpi/src/Service/TicketContextService.php`
- `integaglpi/templates/ticket_tab.php`

## Validacoes

- `npx tsc --noEmit`: OK.
- `npm test`: OK, 37 arquivos / 289 testes passed.
- `php -l` nos PHP revisados: OK.
- `git diff --check`: OK, apenas avisos de LF/CRLF do Git no Windows.

## Ressalvas do Cursor

- Veredito final da auditoria: `CLOSE_COM_RESSALVAS`.
- Smoke manual em TESTE ainda deve confirmar o comportamento real com GLPI e Meta.
- O workspace ainda possui changeset amplo da 8.1, aceito pelo operador como baseline operacional.
- A promocao para producao continua manual e depende de gate humano.

## Smoke Manual Obrigatorio

- Primeiro atendimento com e-mail valido.
- Primeiro atendimento sem e-mail ou com e-mail invalido.
- Atendimento sem memoria de entidade, com selecao manual posterior.
- Segundo atendimento com memoria ativa de entidade.
- Vinculo de usuario GLPI unico e ativo por e-mail.
- Ambiguidade ou usuario inativo sem vinculo automatico.
- Criacao controlada de usuario GLPI somente apos entidade real.
- CSAT positivo fechando conforme fluxo existente.
- CSAT insatisfeito mantendo/reabrindo atendimento e sinalizando revisao.
- Contexto WhatsApp mostrando perfil, e-mail, vinculo GLPI e CSAT.
- Midia inbound/outbound da 8.1 sem regressao.
- Isolamento TESTE/PRODUCAO por `META_PHONE_NUMBER_ID`.

## Fora do Escopo

- Deploy ou promocao para producao.
- Alteracao de `.env` real.
- Backoffice completo, contratos, banco de horas, CRM, IA supervisora ou LogMeIn.
- Criacao de senha, perfil administrativo ou login automatico para usuario GLPI.
- Vinculo por nome, empresa textual ou qualquer criterio ambiguo.
- Alteracao automatica de tickets antigos.
