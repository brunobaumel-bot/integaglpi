# IntegraGLPI — Inventário de Alinhamento ao GLPI Nativo

**Phase ID:** `integaglpi_v8_native_catalog_contract_alignment_inventory_001`
**Fix Phase ID:** `integaglpi_v8_native_catalog_contract_alignment_inventory_fix1_001`
**Data:** 2026-06-05 (original) / 2026-06-05 (fix1)
**Tipo:** Auditoria técnica read-only — nenhum runtime alterado

---

## Executive Summary — MODELO B APROVADO

> **Decisão arquitetural aprovada:** Modelo B — GLPI nativo como Fonte de Verdade (SSOT).
> Plugin como camada WhatsApp / IA / operação.
> Nenhuma implementação runtime foi realizada nesta fase.

### Separação de responsabilidades

| Componente | Papel | Proibido |
|---|---|---|
| **GLPI nativo / MariaDB** | tickets, follow-ups, tarefas, soluções, catálogo de serviços, forms, categorias, contratos, SLA/OLA, entidades, fornecedores, KB oficial, RBAC/autenticação | — |
| **Plugin GLPI PHP** | Central de Atendimento, Monitor Online, Supervisor, UI operacional, RBAC/CSRF plugin, ações manuais com validação GLPI, candidatos KB e curadoria, auditoria operacional, intermediar APIs GLPI | Acessar MariaDB GLPI direto, manter catálogo/contratos/KB como SSOT |
| **integration-service Node** | WhatsApp Meta Cloud API, FSM de atendimento, roteamento, mensagens, IA assistiva, consumo de APIs autorizadas, PostgreSQL operacional, Redis cache/locks | **Jamais** acessar MariaDB GLPI diretamente; jamais ser SSOT de dados de negócio |
| **PostgreSQL** | conversas, mensagens, auditoria, métricas, consumo operacional, referências GLPI por ID, candidatos KB | Duplicar conteúdo mestre do GLPI; ser SSOT de catálogo/contratos/SLA/OLA/KB publicada |
| **Redis** | cache curto com TTL, locks, mapeamento de opções WhatsApp → IDs GLPI, invalidação por TTL ou manual | SSOT; replicar estrutura completa nativa; armazenar descrições/conteúdo nativo |
| **HML** | Validar todas as fases futuras antes de produção | Executar migração sem validação HML prévia |
| **Produção** | Apenas receber promoção manual após gate humano | Deploy, migration, sync ou alteração automáticos |

### Status dos domínios

| Domínio | Modelo B (direção futura) | Risco atual | Ação |
|---|---|---|---|
| Catálogo de Serviços / Forms / Categorias | Ler do GLPI nativo (`glpi_servicecatalogs`, `glpi_itilcategories`, Forms GLPI) via API REST/plugin | Alto — duplicação total | Substituir por referência nativa com verificação de schema |
| SLA/OLA | Ler de `glpi_slalevels`, `glpi_olas` via GLPI API | Alto — duplicação de política | Substituir por referência nativa |
| Contratos / Banco de Horas | `glpi_contract_id` nullable → referência ao GLPI nativo; consumo operacional legítimo no plugin | Médio — FK existe, dados duplicados, `NOT NULL` só após backfill | Backfill e then NOT NULL; remover campos redundantes |
| KB Publicada | KB oficial fica em `glpi_knowbaseitems`; aprovação futura via API GLPI com categoria e RBAC | Alto — duplicação total | Deprecar `kb_articles`; promover `NativeKnowledgeBaseService` |
| KB Candidatos | Plugin mantém curadoria/auditoria — correto | Baixo | Manter como está |
| KB Nativa (read) | `NativeKnowledgeBaseService` — correto | Nenhum | Manter e expandir |
| Message Catalog | WhatsApp templates — responsabilidade do plugin | Nenhum | Manter |

**Princípio:** GLPI é SSOT para todos os dados de negócio. Plugin mantém apenas operacional WhatsApp, IA, auditoria, histórico e consumo vinculado a contrato GLPI.

---

## 1. Inventário — Catálogo de Serviços / Forms / Categorias

### 1.1 Ocorrências classificadas

| Arquivo | Tipo | Classificação |
|---|---|---|
| `migration/026_inactivity_sla_service_catalog.sql` | Tabela `glpi_plugin_integaglpi_service_catalog` | **plugin_parallel_catalog** |
| `src/Service/ServiceCatalogService.php` | CRUD completo sobre tabela própria | **plugin_parallel_catalog** |
| `src/Renderer/ServiceCatalogRenderer.php` | Renderização da UI paralela | **plugin_parallel_catalog** |
| `front/service.catalog.php` | Tela CRUD dedicada | **plugin_parallel_catalog** |
| `src/ServiceCatalogMenu.php` | Menu entry no plugin | **ui_only** → deprecar |
| `src/Plugin.php:254,487-502` | `getServiceCatalogUrl`, `canServiceCatalogRead/Update` | **ui_only** → deprecar |
| `src/GestaoGroupMenu.php:55-57` | Link `catalogo_servicos` no menu | **ui_only** → deprecar |
| `src/External/Repository/ConversationRepository.php:134,228,278,463` | JOIN com `glpi_plugin_integaglpi_service_catalog` | **cache_or_mapping** → converter para referência nativa |
| `src/Service/AttendanceCenterService.php:1913-1963` | `loadServiceCatalogOptions()` lê tabela própria | **plugin_parallel_catalog** |
| `integration-service/src/infra/db/databaseConstants.ts:29` | Constante `serviceCatalog` | **plugin_parallel_catalog** |
| `integration-service/src/repositories/PostgresAiQualityAnalysisRepository.ts:183` | JOIN com `service_catalog` em relatório de qualidade | **cache_or_mapping** |
| `src/Service/HistoricalMiningUiService.php:1253` | Lê `glpi_itilcategories` via GLPI API | **native_glpi_reference** ✓ |
| `src/Service/ExternalResearchService.php:656,660` | Lê `glpi_itilcategories` via `Dropdown::getDropdownName` | **native_glpi_reference** ✓ |

### 1.2 Schema paralelo (migration 026)

```sql
-- PARALELO — precisa ser substituído por referência nativa
glpi_plugin_integaglpi_service_catalog:
  id, service_key, name, description,
  routing_queue_id,          -- legítimo (filas WhatsApp)
  glpi_entity_id,            -- referência nativa ✓
  default_priority,          -- duplica glpi_itilcategories.default_priority
  required_fields_json,      -- duplica GLPI Forms
  sla_response_minutes,      -- duplica glpi_slalevels
  sla_solution_minutes,      -- duplica glpi_slalevels
  is_active, created_at, updated_at

-- Coluna em conversations que referencia o catálogo paralelo:
glpi_plugin_integaglpi_conversations.glpi_service_catalog_id
```

### 1.3 Fontes nativas do GLPI (Modelo B)

O Modelo B adota como fonte de verdade para o catálogo:

- **`glpi_itilcategories`** — categorias de chamados (já usado corretamente em `ExternalResearchService` e `HistoricalMiningUiService`)
- **`glpi_servicecatalogs`** — catálogo de serviços nativo do GLPI 11 (verificar existência no schema real instalado — ver nota abaixo)
- **Forms GLPI** — substituem `required_fields_json` do catálogo paralelo (verificar tabelas disponíveis no ambiente)

> **⚠️ AVISO SOBRE `glpi_itiltypes`:** A tabela `glpi_itiltypes` representa os **tipos ITIL fixos** do sistema (Incident, Problem, Change, Service Request), **não** o catálogo de serviços. Nenhuma FK do plugin deve referenciar `glpi_itiltypes` como substituto de catálogo de serviços. A equivalência `service_catalog.name ≈ glpi_itiltypes.name` está **incorreta** e não deve ser usada.
>
> **⚠️ VERIFICAÇÃO OBRIGATÓRIA DE SCHEMA:** Antes de definir qualquer FK em `service_catalog` ou `conversations` apontando para tabelas nativas de catálogo, o operador deve verificar no ambiente GLPI 11 instalado quais tabelas existem (`glpi_servicecatalogs`, Forms, etc.) para não criar FKs contra tabelas ausentes. O schema real pode variar conforme versão e plugins GLPI ativos.

### 1.4 Integração WhatsApp com catálogo nativo

- WhatsApp lê dinamicamente opções do GLPI via API REST ou plugin PHP autorizado (nunca Node direto ao MariaDB)
- Itens são exibidos como botões/listas WhatsApp respeitando limites Meta (3 botões, 10 itens de lista)
- Redis armazena **cache leve** com TTL curto contendo apenas:
  - `option_key`
  - `glpi_service_catalog_id` ou referência nativa confirmada
  - `glpi_form_id` quando aplicável
  - `glpi_itilcategory_id` quando aplicável
  - mapeamento queue/entity operacional
- Redis **não** replica descrições, estrutura completa ou cadastro nativo — apenas mapeamento de IDs operacional

### 1.5 Ação recomendada

- `FREEZE imediato`: Não criar novos campos em `service_catalog` sem referência a tabela nativa verificada.
- `FASE 1`: Verificar schema GLPI 11 instalado para confirmar tabelas nativas disponíveis.
- `FASE 2`: UI passa a ler categorias/catálogo de `glpi_itilcategories` e tabelas nativas via GLPI API (não direto ao MariaDB — via plugin PHP ou GLPI REST).
- `FASE 3`: `service_catalog` mantido apenas com `id`, `service_key`, `routing_queue_id`, `glpi_itilcategory_id` (FK verificada), `glpi_entity_id` — restante deprecado.
- `FASE 5`: Tabela `service_catalog` mantida como arquivo histórico (`is_archived`).

---

## 2. Inventário — Contratos / Banco de Horas / SLA / OLA

### 2.1 Ocorrências classificadas

| Arquivo | Tipo | Classificação |
|---|---|---|
| `migration/016_contract_hours.sql` | Tabelas `entity_contracts` + `hour_adjustments` | **plugin_parallel_contract** (FK `glpi_contract_id` nullable) |
| `src/External/Repository/ContractHoursRepository.php` | CRUD sobre tabela própria | **plugin_parallel_contract** |
| `src/Service/ContractHoursService.php` | Lógica de alocação/consumo | **operational_hour_consumption** |
| `src/Renderer/ContractHoursRenderer.php` | UI CRUD | **plugin_parallel_contract** |
| `front/contracts.hours.php` | Tela CRUD dedicada | **plugin_parallel_contract** |
| `src/ContractsHoursMenu.php` | Menu entry | **ui_only** → converter |
| `inc/right.class.php:25-26` | Right READ/UPDATE menciona "Contratos e Horas" | **audit_metric** |
| `integration-service/src/services/QualityDashboardService.ts:279,579` | JOIN `entity_contracts` + `hour_adjustments` | **dashboard_only** |
| `migration/026` | `conversation_sla_logs` — logs operacionais de SLA | **audit_metric** ✓ manter |
| `migration/026` | `sla_response_minutes`/`sla_solution_minutes` em `service_catalog` | **plugin_parallel_contract** |

### 2.2 Schema — entity_contracts (estado atual)

```sql
glpi_plugin_integaglpi_entity_contracts:
  id
  glpi_entity_id     BIGINT NOT NULL  -- referência nativa ✓
  glpi_entity_name   TEXT NULL        -- REDUNDANTE — duplica MariaDB
  glpi_contract_id   BIGINT NULL      -- referência nativa ✓ (nullable — correto enquanto não houver backfill)
  contract_name      TEXT NULL        -- REDUNDANTE — duplica MariaDB
  allocated_hours    NUMERIC(10,2)    -- LEGÍTIMO operacional
  period_start/end   DATE             -- LEGÍTIMO operacional
  threshold_%        INTEGER          -- LEGÍTIMO operacional
  is_active, notes, created/updated  -- LEGÍTIMO
```

**Campos redundantes identificados:** `glpi_entity_name`, `contract_name` — duplicam dados do MariaDB GLPI.
**Campo crítico correto:** `glpi_contract_id` — FK já existe, nullable enquanto backfill não for concluído.

> **⚠️ SEQUÊNCIA OBRIGATÓRIA PARA `glpi_contract_id NOT NULL`:**
> A coluna `glpi_contract_id` deve permanecer **nullable** até que todas as etapas abaixo sejam concluídas:
> 1. Script de mapeamento manual: operador confirma `glpi_contract_id` para cada contrato existente
> 2. Verificação pré-condição: `SELECT COUNT(*) FROM glpi_plugin_integaglpi_entity_contracts WHERE glpi_contract_id IS NULL` deve retornar `0`
> 3. Gate humano: operador confirma que o count é zero e autoriza a migration
> 4. Somente então: `ALTER TABLE ... ALTER COLUMN glpi_contract_id SET NOT NULL` em migration additive
>
> **Aplicar `NOT NULL` antes deste backfill causa falha de migration em produção.** Esta é uma pré-condição objetiva e inegociável.

### 2.3 Schema — hour_adjustments

```sql
glpi_plugin_integaglpi_hour_adjustments:
  contract_id        BIGINT FK        -- correto
  glpi_entity_id     BIGINT           -- correto
  glpi_ticket_id     BIGINT NULL      -- referência nativa ✓
  adjusted_hours     NUMERIC(10,2)    -- LEGÍTIMO operacional
  adjustment_type    TEXT             -- LEGÍTIMO
  source             TEXT             -- LEGÍTIMO
  reviewed_by        BIGINT           -- referência glpi_user ✓
```

`hour_adjustments` é fundamentalmente legítimo — registra consumo operacional vinculado a tickets e contratos GLPI reais. **Preservar como auditoria operacional.**

### 2.4 SLA paralelo

```sql
-- Em service_catalog (PARALELO — duplica glpi_slalevels):
sla_response_minutes INTEGER NULL
sla_solution_minutes INTEGER NULL

-- Operacional (LEGÍTIMO — manter):
glpi_plugin_integaglpi_conversation_sla_logs  -- logs de breach/compliance
glpi_plugin_integaglpi_conversations.sla_*_deadline  -- deadlines calculados
```

### 2.5 Ação recomendada

- `FASE 1`: Operador mapeia `glpi_contract_id` para cada contrato existente (script manual, não automático).
- `FASE 2`: UI `contracts.hours.php` passa a ler `contract_name` e `glpi_entity_name` do GLPI nativo via API, não do PostgreSQL.
- `FASE 2`: Remover `contract_name` e `glpi_entity_name` do `INSERT/UPDATE` — manter apenas leitura via GLPI API.
- `FASE 2`: `sla_response_minutes`/`sla_solution_minutes` em `service_catalog` passam a vir do `glpi_slalevels` via referência `glpi_sla_id`.
- `FASE 3`: Após verificação do count zero (pré-condição), migration torna `glpi_contract_id NOT NULL`.
- `FASE 5`: Remover `glpi_entity_name` e `contract_name` do schema — somente após `glpi_contract_id` preenchido em todos os registros e verificado.

---

## 3. Inventário — KB / Candidatos / Publicação

### 3.1 Ocorrências classificadas

| Arquivo | Tipo | Classificação |
|---|---|---|
| `migration/028_knowledge_base_foundation.sql` | Tabelas `kb_articles` + `kb_article_versions` | **plugin_parallel_kb** — DEPRECAR |
| `src/Service/KnowledgeBaseService.php` | CRUD sobre `kb_articles` (PostgreSQL) | **plugin_parallel_kb** — DEPRECAR |
| `src/Renderer/KnowledgeBaseRenderer.php` | UI CRUD paralela | **plugin_parallel_kb** — DEPRECAR |
| `front/kb.php` | Tela CRUD KB paralela | **plugin_parallel_kb** → converter para read-only nativo |
| `src/KnowledgeBaseMenu.php` | Menu entry KB paralela | **ui_only** → converter |
| `src/Service/NativeKnowledgeBaseService.php` | Lê `glpi_knowbaseitems` via GLPI API | **glpi_native_kb_reference** ✓ MANTER |
| `front/kb.native.php` | UI wrapper KB nativa | **glpi_native_kb_reference** ✓ MANTER |
| `src/Service/KbSearchService.php` | Usa `NativeKnowledgeBaseService` | **glpi_native_kb_reference** ✓ MANTER |
| `front/kb.search.php` | Search proxy KB nativa | **glpi_native_kb_reference** ✓ MANTER |
| `migration/030_ai_kb_candidates_from_history.sql` | Tabela `kb_candidates` | **plugin_kb_candidate** ✓ MANTER |
| `migration/030` | Tabela `kb_candidate_reviews` | **audit_feedback** ✓ MANTER |
| `migration/044` | `kb_article_helpfulness` + colunas extras em `kb_candidates` | **audit_feedback** ✓ MANTER |
| `src/Service/KbCandidateService.php` | Gerencia candidatos | **plugin_kb_candidate** ✓ MANTER |
| `front/kb.candidates.php` | UI curadoria candidatos | **plugin_kb_candidate** ✓ MANTER |
| `integration-service/src/repositories/PostgresKbFeedbackRepository.ts` | Referencia `glpi_knowbaseitem_id` | **glpi_native_kb_reference** ✓ MANTER |
| `integration-service/src/ai/aiQualityPrompt.ts:23` | Referencia `/front/knowbaseitem.form.php` | **glpi_native_kb_reference** ✓ MANTER |
| `src/Service/ExternalResearchService.php` | `no_auto_publish: true` em todos os caminhos | **autopublish_risk** RESOLVIDO ✓ |
| `src/Service/HistoricalMiningUiService.php` | `no_auto_publish: false` bloqueado, `p4_no_auto_publish: true` | **autopublish_risk** RESOLVIDO ✓ |

### 3.2 Schema paralelo a deprecar (migration 028)

```sql
-- PARALELO — deprecar progressivamente
glpi_plugin_integaglpi_kb_articles:
  id, title, content_markdown, article_type,
  status (draft/active/archived),  -- duplica fluxo GLPI KB
  service_catalog_id,              -- FK para catálogo paralelo (dupla duplicação)
  routing_queue_id, category, tags_json, ...

glpi_plugin_integaglpi_kb_article_versions: -- histórico de versões paralelo
```

### 3.3 Schema legítimo (manter)

```sql
-- LEGÍTIMO — curadoria/auditoria, nunca publicação automática
glpi_plugin_integaglpi_kb_candidates          -- rascunhos sugeridos pela IA
glpi_plugin_integaglpi_kb_candidate_reviews   -- auditoria de revisão humana
glpi_plugin_integaglpi_kb_article_helpfulness -- feedback "ajudou/não ajudou"
glpi_plugin_integaglpi_external_source_catalog -- catálogo de fontes externas
```

### 3.4 Autopublish — ZERO riscos encontrados + STOP CONDITION permanente

Todas as ocorrências de `auto_publish` no código estão com valor `false` ou `no_auto_publish: true`. Nenhum caminho de código publica na KB GLPI automaticamente. Confirmado em:
- `ExternalResearchService.php`: 8 ocorrências com `no_auto_publish: true`
- `HistoricalMiningUiService.php`: 12 ocorrências com `no_auto_publish: false` + guard `if (!empty($safetyFlags['auto_publish'])) { BLOCK }`
- `AiConfigViewService.php`: `no_auto_publish_kb: true`

> **🛑 STOP CONDITION PERMANENTE — KB AUTOPUBLISH:**
> Qualquer fase, PR, commit ou proposta que implemente **publicação automática** (autopublish) de artigos em `glpi_knowbaseitems` deve receber **BLOCK imediato e permanente**. Esta condição não pode ser negociada, contornada por feature flag nem adiada. A publicação de artigos na KB GLPI deve sempre exigir: (1) ação manual explícita de um operador com permissão, (2) categoria obrigatória preenchida, (3) validação RBAC via GLPI API, (4) rascunho/artigo criado na KB nativa via API GLPI — nunca por escrita direta ao MariaDB.

### 3.5 Fluxo de aprovação de candidato KB (Modelo B — futuro)

Quando um candidato KB for aprovado pelo operador, o fluxo futuro deve:
1. Validar permissão do operador via GLPI RBAC (plugin PHP intermediário)
2. Criar rascunho/artigo na KB nativa via **API REST GLPI** com:
   - `glpi_itilcategory_id` obrigatório (categoria do chamado vinculado)
   - `is_draft = true` inicialmente
3. Nunca escrever diretamente em `glpi_knowbaseitems` — apenas via API GLPI
4. Registrar evento de auditoria no PostgreSQL do plugin
5. Publicação final permanece responsabilidade do operador dentro do GLPI

### 3.6 Ação recomendada

- `FREEZE imediato`: Não adicionar novos artigos em `kb_articles` — direcionar criação para GLPI KB nativo.
- `FASE 2`: `front/kb.php` passa a redirecionar para `kb.native.php` (já existe e funciona).
- `FASE 4`: `KnowledgeBaseMenu` aponta para `kb.native.php` em vez de `kb.php`.
- `FASE 5`: Tabelas `kb_articles` + `kb_article_versions` deprecadas (não deletadas — apenas inacessíveis via UI) após migração de conteúdo para GLPI KB nativo.

---

## 4. Estratégia de Dados

### 4.1 Matriz por tabela

| Tabela PostgreSQL | Estratégia | Observação |
|---|---|---|
| `glpi_plugin_integaglpi_service_catalog` | `convert_to_glpi_id_reference` | Verificar schema real GLPI 11; adicionar FK nativa verificada; deprecar campos duplicados |
| `glpi_plugin_integaglpi_conversation_sla_logs` | `keep_as_audit` | Logs operacionais legítimos |
| `glpi_plugin_integaglpi_entity_contracts` | `convert_to_references` | `glpi_contract_id` nullable → NOT NULL somente após backfill validado (count=0); remover `contract_name`, `glpi_entity_name` após fase 5 |
| `glpi_plugin_integaglpi_hour_adjustments` | `keep_as_audit` | Consumo operacional legítimo |
| `glpi_plugin_integaglpi_kb_articles` | `deprecate_no_delete` | Freeze + redirecionar UI para nativo |
| `glpi_plugin_integaglpi_kb_article_versions` | `deprecate_no_delete` | Idem |
| `glpi_plugin_integaglpi_kb_candidates` | `keep_as_audit` | Curadoria IA — legítimo |
| `glpi_plugin_integaglpi_kb_candidate_reviews` | `keep_as_audit` | Auditoria de revisão humana — legítimo |
| `glpi_plugin_integaglpi_kb_article_helpfulness` | `keep_as_audit` | Feedback agregado — legítimo |
| `glpi_plugin_integaglpi_message_catalog` | `keep_as_audit` | Templates WhatsApp — responsabilidade do plugin |
| `glpi_plugin_integaglpi_external_source_catalog` | `keep_as_audit` | Fontes externas — responsabilidade do plugin |

**Estratégias disponíveis:**
- `keep_as_audit` — manter sem alteração estrutural; dados são operacionais legítimos do plugin
- `convert_to_references` — tornar FK para tabela GLPI nativa; dados de negócio migram para GLPI
- `deprecate_no_delete` — freeze de criação; UI redirecionada; tabela arquivada, não deletada
- `no_delete_until_audit` — nenhuma tabela deve ser deletada sem backup verificado e autorização explícita

### 4.2 Campos redundantes a eliminar (fases futuras)

| Tabela | Campo redundante | Campo nativo equivalente | Fase |
|---|---|---|---|
| `entity_contracts` | `contract_name` | `glpi_contracts.name` (MariaDB via API GLPI) | 5 |
| `entity_contracts` | `glpi_entity_name` | `glpi_entities.completename` (MariaDB via API GLPI) | 5 |
| `service_catalog` | `name`, `description` | Tabela nativa verificada (não `glpi_itiltypes` — ver seção 1.3) | 4 |
| `service_catalog` | `sla_response_minutes` | `glpi_slalevels.execution_time` via API GLPI | 3 |
| `service_catalog` | `sla_solution_minutes` | `glpi_slalevels.execution_time` via API GLPI | 3 |
| `kb_articles` | `title`, `content_markdown` | `glpi_knowbaseitems.name/answer` via API GLPI | 5 |

> **⚠️ Acesso a dados MariaDB GLPI:** Todos os campos nativos acima devem ser lidos via **GLPI API REST** ou **classes PHP GLPI** pelo plugin intermediário — **nunca** por acesso direto do Node ao MariaDB GLPI.

---

## 5. Estratégia de UI

| Tela Plugin | Status | Recomendação | Fase |
|---|---|---|---|
| `front/service.catalog.php` | CRUD paralelo completo | `convert_to_readonly_native_reference` | 2 |
| `front/contracts.hours.php` | CRUD operacional com dados duplicados | `keep` + remover sync manual | 2 |
| `front/kb.php` | CRUD paralelo KB | `deprecate_ui` → redirecionar para `kb.native.php` | 2 |
| `front/kb.native.php` | Wrapper KB GLPI nativa | `keep` — padrão correto | — |
| `front/kb.candidates.php` | Curadoria IA | `keep` — responsabilidade legítima | — |
| `front/kb.search.php` | Busca KB nativa | `keep` | — |
| `front/smart.help.php` | IA read-only | `keep` | — |

---

## 6. Estratégia de API

| Endpoint Node | Status | Recomendação |
|---|---|---|
| Leitura `service_catalog` (QualityDashboard) | JOIN com tabela paralela | Fase 2: ler categorias via GLPI API REST (via plugin PHP intermediário) |
| `databaseConstants.serviceCatalog` | Constante ativa | Manter até fase 5 |
| Leitura `entity_contracts` (QualityDashboard) | Correto — consumo operacional | Manter |
| `glpi_knowbaseitem_id` em feedback | Referência nativa correta | Manter |
| `HttpKbSearchPort` → KB nativa | Correto | Manter |

**Regra permanente:** Node **nunca** acessa MariaDB GLPI diretamente. Toda referência nativa é via PHP plugin ou GLPI API REST. Redis armazena apenas mapeamentos leves com TTL — não é substituto de leitura GLPI.

---

## 7. Segurança / RBAC / PII

| Item | Status |
|---|---|
| RBAC no catálogo de serviços | `requireServiceCatalogRead/Update` em todas as rotas — preservar; RBAC herda do GLPI nativo |
| RBAC em contratos | `requireContractRead/Update` — preservar; plugin não burla ACL GLPI |
| RBAC em KB | `requireKnowledgeBaseRead/Update` — preservar na tela nativa; aprovação de candidato requer RBAC GLPI |
| PII em candidatos KB | `evidence_hashes_json` (hash, não raw) — correto |
| PII em hour_adjustments | Apenas IDs numéricos (ticket, entity, user) — correto |
| PII — redução por Modelo B | Menor duplicação de dados de negócio reduz superfície de PII no PostgreSQL |
| Autopublish KB | ZERO — todos os caminhos têm guard `no_auto_publish: true`; stop condition permanente adicionada |
| Node→MariaDB | Não encontrado — regra respeitada; proibição documentada permanentemente |
| Migração futura — risco | Médio — mitigado por feature flags, gate humano, rollback obrigatório e validação HML prévia |

---

## 8. Plano de Migração Incremental

> **Produção está bloqueada nesta fase.** Todas as migrações efetivas ocorrem somente após:
> (1) gate humano explícito, (2) validação em HML, (3) feature flag e plano de rollback definidos.

### Freeze Imediato (agora)
- Não criar novos campos em `service_catalog` sem referência a tabela nativa verificada (não usar `glpi_itiltypes`).
- Não criar novos artigos em `kb_articles` — todo conteúdo novo vai para GLPI KB nativo.
- Não remover `glpi_contract_id` da tabela `entity_contracts`.
- Não aplicar `glpi_contract_id NOT NULL` antes do backfill validado.

### must_do_now (Decisões tomadas nesta fase — docs)
- Registrar formalmente o Modelo B aprovado (GLPI nativo como SSOT).
- Mapear duplicações e dependências (este documento).
- Documentar feature flags futuras para desabilitar cadastros paralelos.
- Documentar pré-condições objetivas para cada NOT NULL migration futura.

### can_do_after_go (Pós-GO inicial — gate humano obrigatório)
- Migração efetiva para referências GLPI (fases 1–3).
- Descontinuação de interfaces paralelas de UI (fases 2–4).
- Criação de artigos KB via API GLPI após aprovação manual (fase 3+).

### should_not_do (Proibições permanentes)
- Excluir históricos de hour_adjustments, conversation_sla_logs, kb_candidates.
- Remover auditoria operacional.
- Forçar migração sem rollback definido.
- Qualquer autopublish KB.
- Qualquer DROP/DELETE/TRUNCATE sem autorização explícita, backup verificado e gate humano.

### Fase 1 — Mapeamento de referências (sprint futura — pós-GO)

```sql
-- Additive, idempotent — sem DELETE/DROP
-- EXECUTAR SOMENTE APÓS GATE HUMANO E VALIDAÇÃO HML
ALTER TABLE glpi_plugin_integaglpi_service_catalog
  ADD COLUMN IF NOT EXISTS glpi_itilcategory_id BIGINT NULL,  -- usa glpi_itilcategories, não glpi_itiltypes
  ADD COLUMN IF NOT EXISTS glpi_sla_id          BIGINT NULL,
  ADD COLUMN IF NOT EXISTS glpi_ola_id          BIGINT NULL;

ALTER TABLE glpi_plugin_integaglpi_entity_contracts
  ADD COLUMN IF NOT EXISTS glpi_contract_id_backfill_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
```
- Script de mapeamento manual: operador preenche `glpi_itilcategory_id` para cada `service_key`.
- Script de mapeamento: operador confirma `glpi_contract_id` para cada contrato existente.

### Fase 2 — UI passa a ler GLPI nativo

- `ServiceCatalogService` passa a enriquecer dados com GLPI API (nome, categoria, SLA) — via plugin PHP, não Node direto.
- `front/kb.php` redireciona para `kb.native.php`.
- `contracts.hours.php` busca `contract_name` via GLPI API em vez do banco.
- Tela `service.catalog.php` passa a ser somente leitura enriquecida.

### Fase 3 — Migração de dados

- **Pré-condição obrigatória para `glpi_contract_id NOT NULL`:** `SELECT COUNT(*) ... WHERE glpi_contract_id IS NULL = 0` + gate humano
- Migration additive: `glpi_contract_id NOT NULL` somente após verificação e autorização explícita.
- Migration additive: `glpi_sla_id NOT NULL` após mapeamento do SLA nativo e verificação.
- Nenhum dado deletado — campos antigos ficam com `is_deprecated BOOLEAN DEFAULT TRUE`.
- Feature flag obrigatória: permitir rollback para campos antigos caso GLPI API esteja indisponível.

### Fase 4 — Deprecar CRUD paralelo

- `KnowledgeBaseMenu` aponta para `kb.native.php`.
- `ServiceCatalogMenu` passa a mostrar link para catálogo GLPI nativo.
- Forms GLPI nativos substituem `required_fields_json` do catálogo.

### Fase 5 — Cleanup (somente com backup + auditoria + autorização explícita)
- Nunca executar automaticamente.
- Requer backup verificado + aprovação manual + smoke test pós-migração.
- Remover campos deprecated do schema.
- Manter tabelas como arquivos históricos (`is_archived`).

---

## 9. Riscos

| Risco | Severidade | Mitigação |
|---|---|---|
| `service_catalog` referenciando `glpi_itiltypes` em vez de tabela nativa correta | Alto | Substituído por `glpi_itilcategory_id` ou tabela nativa verificada (seção 1.3) |
| `entity_contracts` com `glpi_contract_id = NULL` ao tentar tornar NOT NULL sem backfill | Alto | Sequência obrigatória documentada (seção 2.2): count=0 → gate → migration |
| GLPI API não fornece dados necessários para migração | Alto — STOP | Verificar cobertura de API antes de iniciar fase; fallback para catálogo paralelo até API confirmar dados |
| Migração exigiria Node direto no MariaDB GLPI | Alto — STOP | Proibido; todas as leituras nativas via GLPI API REST ou plugin PHP |
| Latência WhatsApp não mitigável com Redis/cache | Médio — STOP | Medir latência real em HML antes de desabilitar catálogo paralelo |
| Operador decide manter catálogo paralelo por regra de negócio | Médio | Gate humano; o Modelo B é direção, não imposição imediata |
| KB `articles` usados em algum fluxo ativo antes de serem deprecados | Médio | Verificar `is_active` count antes de deprecar UI |
| GLPI nativo não acessível durante migração de referências | Médio | Todas as consultas têm fallback gracioso (`tableExists` checks) |
| Dupla entrada (catálogo paralelo + GLPI nativo) gera inconsistência | Alto | Freeze imediato evita criação de novos itens paralelos |

---

## 10. Stop Conditions

Não executar nenhuma fase de migração se:

- Backup PostgreSQL não verificado.
- **`glpi_contract_id IS NULL` count > 0 antes de tornar FK NOT NULL** — pré-condição objetiva inegociável.
- Smoke test de health pós-migration falhar.
- **Node→MariaDB for proposto como caminho de leitura** — proibido permanentemente.
- Dados históricos (hour_adjustments, conversation_sla_logs, kb_candidates) forem alvos de DELETE.
- **API GLPI não fornece dados necessários** para a fase em questão.
- **Migração exigiria acesso direto do Node ao MariaDB GLPI**.
- **Latência WhatsApp não for mitigável** com Redis/cache dentro dos limites aceitáveis.
- **Operador decide manter catálogo paralelo** por regra de negócio explícita.
- **Qualquer proposta de autopublish em `glpi_knowbaseitems`** — BLOCK imediato e permanente.
- **Qualquer DROP/DELETE/TRUNCATE sem autorização explícita**, backup verificado e gate humano.
- **Qualquer NOT NULL antes de backfill validado** (count = 0 verificado).
- Validação em HML não realizada antes da promoção para produção.

---

## 11. ROADMAP_IMPACT

### must_do_now
- Registrar formalmente a decisão arquitetural (Modelo B — GLPI nativo como SSOT). ✅ Este documento.
- Mapear todas as duplicações e dependências entre plugin e GLPI nativo. ✅ Este documento.
- Documentar feature flags futuras para desabilitar cadastros paralelos sem quebrar produção.
- Verificar cobertura da GLPI API REST no ambiente instalado (quais endpoints existem para catálogo, forms, contratos, SLA).

### can_do_after_go
- Migração efetiva para referências GLPI (fases 1–3, com gate humano e validação HML).
- Descontinuação de interfaces paralelas de UI (fases 2–4, pós-GO).
- Criação de artigos KB via API GLPI após aprovação manual do candidato (fase 3+).
- Backfill de `glpi_contract_id` com script manual supervisionado por operador.

### should_not_do
- Excluir históricos (hour_adjustments, conversation_sla_logs, kb_candidates).
- Remover auditoria operacional.
- Forçar migração sem rollback e feature flags definidos.
- Qualquer autopublish KB (stop condition permanente).
- Aplicar NOT NULL antes de backfill validado.

---

## 12. Próxima Fase Recomendada

**Phase ID:** `integaglpi_v8_native_glpi_reference_columns_phase1_001`

**Objetivo:** Após gate humano e validação em HML:
1. Verificar schema GLPI 11 instalado para confirmar tabelas nativas de catálogo disponíveis.
2. Adicionar colunas de referência nativa (`glpi_itilcategory_id`, `glpi_sla_id`, `glpi_ola_id` em `service_catalog`) via migrations additive e idempotent.
3. Criar script de mapeamento manual para o operador preencher os IDs nativos nos registros existentes.
4. Confirmar `glpi_contract_id` preenchido em `entity_contracts` antes de qualquer NOT NULL.

**Risco:** Baixo — apenas ADD COLUMN IF NOT EXISTS, nenhum dado alterado ou removido.

**Gate obrigatório:** Operador revisa e preenche mapeamentos antes da Fase 2 ser iniciada. Validação em HML obrigatória antes de produção. Feature flags e plano de rollback definidos antes de qualquer NOT NULL migration.
