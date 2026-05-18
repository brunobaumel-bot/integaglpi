# Fase 8.4 — Contratos + Banco de Horas por Entidade

Status: implementada para TESTE/desenvolvimento, sem deploy automático.

## Escopo

A fase adiciona um controle consultivo de contratos operacionais por entidade GLPI e consumo de horas. O painel é complementar ao Backoffice Supervisor da 8.3 e não altera os fluxos de atendimento das fases 8.1, 8.2 ou 8.3.

## Entregas

- Cadastro de contrato operacional por entidade GLPI.
- Referência opcional e read-only ao contrato nativo GLPI por `glpi_contract_id`.
- Horas contratadas por vigência.
- Alertas internos de 70%, 90% e 100%.
- Ajustes manuais auditados com justificativa obrigatória.
- Histórico paginado de ajustes.
- Link no Backoffice Supervisor para a página de contratos e horas.

## Modelo De Dados

Migration aditiva:

- `integration-service/schema-migrations/016_contract_hours.sql`

Tabelas:

- `glpi_plugin_integaglpi_entity_contracts`
- `glpi_plugin_integaglpi_hour_adjustments`

As tabelas armazenam IDs de entidade, contrato opcional, horas, datas, status, justificativas e usuário GLPI responsável. Não armazenam telefone, e-mail, payload Meta, token, URL assinada ou mídia.

## Cálculo De Consumo

Fontes permitidas:

- `glpi_tickettasks.actiontime`, quando disponível no GLPI.
- Ajustes manuais auditados.

Fontes excluídas:

- Tempo de conversa WhatsApp.
- Tempo de sessão WhatsApp.
- Métricas de mensagens.

O tempo de conversa WhatsApp pode ser tratado futuramente como métrica auxiliar, mas não entra no consumo técnico oficial desta fase.

## Permissões E Entidades

O painel reutiliza o direito nativo do plugin:

- `plugin_integaglpi` com `READ` para visualizar.
- `plugin_integaglpi` com `UPDATE` para criar/editar contratos e registrar ajustes.

As consultas e operações respeitam as entidades ativas da sessão GLPI. Entidade zero/raiz não é aceita para contratos operacionais.

## Limitações

- Não há faturamento automático.
- Não há bloqueio automático de atendimento por saldo.
- Não há alerta por WhatsApp ou e-mail.
- Não altera `glpi_contracts`.
- O consumo via `glpi_tickettasks.actiontime` depende do campo existir e estar acessível no GLPI local.

## Validações Recomendadas

```bash
git status --short
git diff --name-only
git diff --stat
git diff --check
```

```bash
php -l integaglpi/front/contracts.hours.php
php -l integaglpi/src/ContractsHoursMenu.php
php -l integaglpi/src/External/Repository/ContractHoursRepository.php
php -l integaglpi/src/Service/ContractHoursService.php
php -l integaglpi/src/Renderer/ContractHoursRenderer.php
```

```bash
npm test -- phpContractHoursStatic.test.ts schemaBootstrap.test.ts
```

## Smoke Manual

1. Abrir GLPI com usuário autorizado.
2. Acessar IntegraGLPI > Contratos e Horas.
3. Confirmar que usuário sem permissão não acessa.
4. Criar contrato em entidade ativa.
5. Confirmar que entidade fora do escopo é rejeitada.
6. Registrar ajuste positivo com justificativa.
7. Registrar ajuste negativo com justificativa.
8. Confirmar rejeição de ajuste sem justificativa.
9. Verificar cards 70/90/100.
10. Confirmar que nenhum alerta WhatsApp/e-mail é enviado.
11. Confirmar que chamados continuam sendo criados mesmo com contrato excedido.

## Produção

Produção exige gate próprio:

- backup;
- aplicação manual da migration;
- revisão humana;
- smoke manual;
- rollback documentado.

Não houve deploy automático nesta fase.
