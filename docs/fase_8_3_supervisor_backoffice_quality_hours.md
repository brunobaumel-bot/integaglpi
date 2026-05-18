# Fase 8.3 - Backoffice Operacional + Qualidade + Tempo de Atendimento

Status: implementado em desenvolvimento/TESTE, sem deploy automático.

## Escopo

Painel supervisor read-only no plugin GLPI para acompanhar atendimento WhatsApp, qualidade, CSAT, inatividade, chamados em risco e produtividade básica por técnico.

O painel é complementar ao GLPI. Não cria login paralelo, não altera fluxos 8.1/8.2 e não implementa contratos, banco de horas completo, IA, LogMeIn ou CRM.

## Arquivos da fase

- `integaglpi/front/supervisor.php`
- `integaglpi/src/SupervisorBackofficeMenu.php`
- `integaglpi/src/External/Repository/SupervisorBackofficeRepository.php`
- `integaglpi/src/Service/SupervisorBackofficeService.php`
- `integaglpi/src/Renderer/SupervisorBackofficeRenderer.php`
- `integaglpi/templates/supervisor_backoffice.php`
- `integaglpi/src/Plugin.php`
- `integaglpi/setup.php`

## Dados usados

Somente leitura sobre tabelas existentes:

- `glpi_plugin_integaglpi_conversations`
- `glpi_plugin_integaglpi_conversation_runtime`
- `glpi_plugin_integaglpi_queues`
- `glpi_plugin_integaglpi_contact_profile`
- `glpi_plugin_integaglpi_contact_entity_memory`
- `glpi_plugin_integaglpi_entity_selection_attempts`
- `glpi_plugin_integaglpi_solution_actions`
- `glpi_plugin_integaglpi_inactivity_tracking`
- `glpi_plugin_integaglpi_audit_events`

Não usa agregação sobre `glpi_plugin_integaglpi_messages`.

## KPIs

- total de chamados WhatsApp no período;
- chamados abertos;
- chamados solucionados;
- chamados fechados;
- CSAT insatisfeito;
- revisão de supervisor;
- encerramento por inatividade;
- falha/atenção de inatividade;
- risco operacional.

## Filtros e paginação

- período padrão: últimos 30 dias;
- janela máxima aplicada: 90 dias;
- técnico ID;
- entidade ID;
- fila;
- status;
- qualidade/risco;
- paginação na tabela de revisão;
- limite máximo: 50 registros por página.

## Permissões e entidades

A página exige login GLPI e direito `plugin_integaglpi` com leitura. A visão supervisora requer também uma das permissões operacionais já existentes:

- `plugin_integaglpi` UPDATE;
- `config` READ;
- `profile` READ.

As consultas são filtradas pelas entidades ativas da sessão GLPI via `Session::getActiveEntities()` ou `$_SESSION['glpiactiveentities']`. Entidade raiz/ID 0 não é usada como escopo de dados.

## LGPD

Listagens exibem telefone e e-mail mascarados. O painel não renderiza `payload_json`, tokens, headers, URLs Meta, base64 ou payload bruto.

## Limitações

- A resolução do escopo de entidade depende de `contact_entity_memory` ou `entity_selection_attempts` já preenchidos.
- Produtividade por técnico usa `conversation_runtime.assigned_user_id` quando disponível.
- Não há cálculo contratual de horas nesta fase.
- SQL read-only real deve ser validado no ambiente TESTE, pois Docker não estava disponível no PATH da sessão de implementação.

## Validações esperadas

- `php -l` nos PHP alterados.
- `git diff --check`.
- Smoke manual no GLPI:
  - usuário sem permissão não abre a página;
  - usuário supervisor abre a página;
  - filtros de período funcionam;
  - paginação respeita limite 50;
  - telefone/e-mail aparecem mascarados;
  - payload bruto não aparece;
  - links para ticket e Contexto WhatsApp abrem;
  - CSAT insatisfeito, revisão supervisor e inatividade aparecem quando houver dados.
