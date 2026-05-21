# AGENTS.md — Regras Arquiteturais Permanentes do IntegaGLPI

## 1. Cláusula pétrea

É terminantemente proibido modificar arquivos do núcleo do GLPI.

Toda funcionalidade deve ser implementada exclusivamente por:

- plugin GLPI;
- hooks oficiais;
- classes do plugin;
- API REST oficial do GLPI;
- integration-service Node.js, quando o escopo for regra de negócio, Meta/WhatsApp, FSM ou bot.

Nenhum patch pode alterar diretamente o core do GLPI.

## 2. Regra de ouro

Se algo funcionava antes, deve continuar funcionando depois.

Nenhuma refatoração estética, melhoria genérica ou reestruturação ampla justifica quebrar fluxo já validado.

Fluxos intocáveis, salvo escopo explícito:

- inbound WhatsApp → Node → GLPI;
- outbound GLPI → WhatsApp;
- roteamento por menu;
- persistência de `queue_id`;
- atribuição de `glpi_group_id`;
- append em conversation `open`;
- sync SOLVED/CLOSED → conversation/runtime `closed`;
- Central de Atendimento já validada.

## 3. Arquitetura oficial

### Plugin GLPI — PHP

Responsável por:

- UI;
- telas da Central;
- abas do ticket;
- hooks;
- permissões;
- configuração;
- integração leve com o integration-service;
- ações operacionais de UI, como claim e reply, quando aprovadas por fase.

### Node.js — integration-service

Responsável por:

- regras de negócio do WhatsApp;
- FSM do bot;
- webhooks Meta;
- integração Meta API;
- integração REST com GLPI;
- decisão inbound;
- persistência de mensagens;
- outbound real para WhatsApp.

### PostgreSQL externo

Responsável por armazenar:

- conversations;
- messages;
- routing_options;
- queues;
- conversation_runtime;
- estados operacionais da Central.

### GLPI / MariaDB

Responsável por:

- tickets;
- grupos;
- técnicos;
- perfis;
- direitos;
- histórico nativo GLPI.

## 4. Baseline validado

### Fase 6.1 — concluída

- Menu de roteamento funcionando.
- `queue_id` persistido em `conversations`.
- `glpi_group_id` aplicado ao ticket no create.
- Opção 1: `queue_id = 3`, `glpi_group_id = 8`.
- Opção 2: `queue_id = 5`, `glpi_group_id = 5`.
- Ticket SOLVED/CLOSED fecha `conversations` e `conversation_runtime`.
- Nova mensagem após `closed` inicia novo fluxo.

### Fase 7.1 — concluída

- Central de Atendimento global funcionando.
- Listagem de conversas abertas.
- Filtros e paginação.
- Link abre ticket correto.
- SQL apenas em Repository.
- Sem raw SQL em template.

### Fase 7.2 — concluída

- Central permite “Assumir atendimento”.
- Claim atômico no PostgreSQL.
- Conflito retorna HTTP 409.
- Clique duplicado pelo mesmo técnico é idempotente.
- Atribuição do ticket GLPI ao técnico é consequência secundária.
- Falha na atribuição GLPI não reverte o claim no PostgreSQL.

### Pendência não bloqueante

A tela de Perfil do plugin ainda possui instabilidade ao salvar permissões pela interface.

Contorno operacional atual:

```sql
UPDATE glpi_profilerights
SET rights = 3
WHERE profiles_id = 4
  AND name = 'plugin_integaglpi';
```

Direito canônico do plugin:

```text
plugin_integaglpi
```

Direitos legados podem existir apenas como fallback:

```text
PluginIntegaglpi
PluginWhatsapp
```

## 5. FSM — status macro

Tabela principal: `glpi_plugin_integaglpi_conversations`.

Status válidos já usados:

- `awaiting_queue_selection`: aguarda escolha do menu; não cria ticket.
- `open`: fluxo ativo; novas mensagens fazem append no ticket vinculado.
- `closed`: não permite append; nova mensagem inicia novo fluxo.
- `pending_glpi`: usar somente se já existir no código/schema.

É proibido criar status novo sem análise explícita de domínio e migration aprovada.

## 6. Bot context e TTL

Quando existir `bot_context`, ele deve controlar microetapas do bot, por exemplo:

```json
{ "step": "ask_queue", "retries": 1, "started_at": "timestamp" }
```

Estados de espera devem ter TTL operacional de 30 minutos.

Ao expirar TTL:

- registrar log estruturado;
- encerrar ou reiniciar fluxo de forma controlada;
- nunca deixar o usuário sem resposta.

## 7. Ordem obrigatória de decisão inbound

Toda mensagem inbound deve seguir esta ordem lógica:

1. validar idempotência por `message_id`;
2. aplicar lock sequencial por contato;
3. buscar conversation;
4. verificar status macro;
5. verificar TTL;
6. verificar `bot_context`, se existir;
7. validar tipo de mensagem;
8. executar ação: menu, append, novo ticket ou erro controlado.

Essa ordem não deve ser alterada sem aprovação arquitetural.

## 8. Concorrência e locks

### Inbound / webhook

Mensagens do mesmo contato devem ser processadas sequencialmente.

Usar Redis Lock ou mecanismo equivalente já existente para evitar decisões simultâneas.

Log obrigatório quando debounce/serialização for aplicada:

```text
[integration-service][inbound][DEBOUNCE_APPLIED]
```

### Central — Assumir atendimento

A Fase 7.2 foi validada com exceção técnica aprovada:

```text
UPDATE condicional atômico no PostgreSQL em vez de Redis Lock.
```

A implementação atual usa transação + `UPDATE ... WHERE ... RETURNING` em `conversation_runtime`.

Essa exceção é aceita porque:

- é atômica no banco;
- retorna conflito 409;
- evita dependência extra no PHP;
- já foi homologada.

Para novas ações concorrentes, usar uma das opções aprovadas:

- Redis Lock pessimista; ou
- operação atômica equivalente no banco, com transação, `WHERE` condicional e tratamento de conflito.

## 9. Campos reais de claim e runtime

Campo real do técnico atual:

```text
glpi_plugin_integaglpi_conversation_runtime.assigned_user_id
```

Timestamp do claim:

```text
glpi_plugin_integaglpi_conversation_runtime.claimed_at
```

É proibido usar `claimed_by`, pois esse campo não é o nome real no schema atual.

Regras:

- `assigned_user_id` define o técnico dono da conversa.
- `claimed_at` marca quando o claim ocorreu.
- Reply pela Central não deve alterar `assigned_user_id`.
- Reply pela Central não deve alterar `claimed_at`.

## 10. Validação de ações da Central

Toda ação mutável da Central deve validar no backend:

- sessão GLPI ativa;
- permissão `plugin_integaglpi` adequada;
- CSRF válido;
- `conversation_id` obrigatório;
- `ticket_id` obrigatório;
- vínculo real entre `conversation_id` e `ticket_id`;
- status atual da conversation/runtime;
- ownership quando aplicável.

A validação deve usar:

```text
conversation_id + ticket_id
```

Nunca validar ação mutável apenas por `conversation_id`.

## 11. Central — regras de UI

Proibições:

- raw SQL em templates;
- lógica de negócio pesada em views;
- mutações sem CSRF;
- ações não autorizadas por permissão;
- acesso público;
- stack trace para usuário.

Obrigações:

- Repository/Service para regra de negócio;
- templates apenas renderizam;
- listagens com LIMIT e paginação;
- filtros validados;
- saída HTML escapada;
- `fetch` com `credentials: 'same-origin'` quando usar AJAX;
- erros amigáveis.

## 12. Central — reply WhatsApp pela Central

A partir da Fase 7.3, reply pela Central deve seguir:

- só responde quem assumiu a conversa;
- `assigned_user_id` deve ser igual ao usuário logado;
- `conversation.status = open`;
- `runtime.status != closed`;
- validar `conversation_id + ticket_id`;
- reutilizar `IntegrationServiceClient::sendOutbound()`;
- não chamar diretamente `front/ticket.whatsapp.reply.php`;
- não alterar Node sem necessidade comprovada;
- não implementar polling, anexos, close/reopen/transfer nesta fase.

Super-Admin também não deve responder conversa assumida por outro técnico nesta fase.
Override administrativo deve ser fase futura, com auditoria.

## 13. Idempotência

### Inbound

Obrigatória por `message_id`.

Nunca processar a mesma mensagem inbound duas vezes.

### Reply pela Central

No MVP, idempotência é best-effort:

- desabilitar botão durante envio;
- mostrar loading;
- evitar duplo clique comum;
- usar `idempotency_key` apenas se o fluxo existente oferecer suporte real.

Não prometer idempotência garantida sem persistência/consulta end-to-end.

Não criar schema apenas para idempotência sem aprovação explícita.

## 14. Mídia e anexos

Se o estado espera texto, mídia/áudio deve ser recusado com fallback curto.

Proibido salvar binário no banco.

Anexos devem ser armazenados no storage do GLPI, guardando no banco apenas metadados:

- caminho;
- MIME;
- tamanho;
- hash;
- referência GLPI.

## 15. Permissões

Direito canônico do plugin:

```text
plugin_integaglpi
```

Regras:

- READ permite visualizar Central/aba, conforme tela.
- UPDATE permite ações mutáveis, como claim e reply.
- Permissões legadas podem ser lidas como fallback, mas novas gravações devem usar o canônico.

Nunca remover `Session::checkRight` / `Session::haveRight` das ações.

## 16. Logs obrigatórios

Logs já esperados:

```text
[integration-service][routing][OPTIONS_LOADED]
[integration-service][routing][BRANCH_CHECK]
[integration-service][routing][MENU_SENT]
[integration-service][routing][OPTION_SELECTED]
[integration-service][routing][INVALID_OPTION]
[integration-service][routing][INVALID_INPUT_TYPE]
[integration-service][routing][TICKET_CREATED]
[integration-service][routing][ATTRIBUTION]
[integaglpi][ticket][SYNC_CLOSE]
```

Para a Central:

```text
[integaglpi][central][claim]
[integaglpi][central][claim][conflict]
[integaglpi][central][claim][glpi_assign_error]
[integaglpi][central][reply]
[integaglpi][central][reply][error]
```

Logs não devem expor tokens, segredos, payloads sensíveis ou stack trace ao usuário.

## 17. Feature Flags e segurança operacional

Quando uma mudança puder afetar fluxo validado, preferir Feature Flag.

Se não houver Feature Flag, o patch deve ser mínimo, reversível e acompanhado de checklist de rollback.

Tokens e chaves nunca devem ser colados em prompts ou logs.

Mudanças em `.env` não exigem rebuild se não houver alteração de código, mas exigem recriar/reiniciar container para recarregar ambiente.

## 18. Banco de dados

- Nunca alterar/remover coluna existente sem aprovação explícita.
- Sempre usar migration incremental e idempotente.
- Não criar schema para resolver problema de UI sem análise.
- Não fazer UPDATE manual como solução permanente, salvo contorno emergencial documentado.

## 19. Definition of Done mínima

Nenhuma fase é considerada concluída sem validar:

1. inbound continua criando tickets;
2. outbound continua enviando WhatsApp;
3. roteamento continua funcionando;
4. não há duplicação de mensagens;
5. logs estruturados aparecem;
6. Central continua abrindo;
7. permissões e CSRF continuam ativos;
8. sync SOLVED/CLOSED continua fechando conversation/runtime;
9. nenhum arquivo proibido foi alterado.

# 🔴 REGRAS PARA PROCESSAMENTO DE MÍDIA

1. Webhook nunca pode ser bloqueado
   → resposta em < 5s

2. Download de mídia é sempre assíncrono

3. Nunca baixar mídia fora do estado open

4. Nunca armazenar binário no PostgreSQL

5. Todo arquivo temporário deve ser removido (cleanup obrigatório)

6. Validar MIME real, não confiar no header

7. Implementar idempotência por message_id

8. Limitar tamanho via configuração (env)

9. Sempre usar stream (nunca buffer completo)

10. Falha de mídia nunca pode quebrar o fluxo principal
