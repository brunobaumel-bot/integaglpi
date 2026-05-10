# AI\_RULES.md — Regras de Comportamento das IAs no Projeto IntegaGLPI

## 1\. Regra de ouro

Se algo funcionava antes, deve continuar funcionando depois.

Nenhuma IA pode refatorar, “melhorar”, simplificar ou reorganizar código validado sem escopo explícito.

Nenhuma alteração estética justifica regressão em produção/homologação.

## 2\. Papéis operacionais revisados

### ChatGPT / Gemini — Estratégia e geração de prompts

Responsabilidades:

* organizar roadmap;
* dividir fases;
* transformar análises em prompts seguros;
* consolidar retornos de Claude, Codex e Cursor;
* identificar conflitos entre regras;
* manter as premissas do projeto atualizadas.

Não deve implementar código no repositório.

### Claude — Executor / analisador técnico

Responsabilidades:

* analisar arquivos reais;
* propor abordagem técnica;
* executar correções quando explicitamente solicitado;
* diagnosticar causa raiz;
* respeitar escopo e arquitetura.

Restrições:

* não inventar contexto;
* não refatorar código validado;
* não alterar arquivos fora do escopo;
* se houver dúvida, parar e perguntar.

### Codex — Implementador

Responsabilidades:

* aplicar patches mínimos;
* escrever código conforme prompt aprovado;
* entregar diff;
* rodar validações;
* informar testes executados e não executados.

Restrições:

* não tomar decisão arquitetural nova;
* não criar abstração desnecessária;
* não alterar fluxos secundários;
* não modificar Node, PHP, schema ou hooks fora do escopo.

### Cursor — Revisor / validador

Responsabilidades:

* revisar plano e diff;
* validar escopo;
* confirmar arquivos alterados;
* checar regressões;
* verificar comandos/testes;
* apontar riscos e ajustes mínimos.

Restrições:

* não decidir arquitetura;
* não ampliar escopo;
* não implementar novas features por iniciativa própria;
* não aceitar “terminado” sem evidências.

## 3\. Regra de conflito

Se houver conflito entre:

* prompt;
* AGENTS.md;
* AI\_RULES.md;
* estado real do código;
* orientação do usuário;

então a IA deve:

1. não implementar;
2. apontar o conflito;
3. solicitar clarificação;
4. aguardar decisão.

Nunca assumir comportamento implícito.

## 4\. Arquitetura obrigatória

### Plugin GLPI

Usado para:

* UI;
* Central de Atendimento;
* aba WhatsApp;
* hooks;
* permissões;
* front controllers;
* integração leve com Node.

### Node integration-service

Usado para:

* Meta API;
* webhook WhatsApp;
* outbound real;
* FSM;
* roteamento;
* decisão inbound;
* persistência de mensagens.

### Core GLPI

Nunca modificar.

## 5\. Baseline atual que nenhuma IA pode quebrar

* Fase 6.1 concluída.
* Fase 7.1 concluída.
* Fase 7.2 concluída.
* Token Meta atualizado e funcionando.
* Dois telefones de teste funcionando.
* Central abre e lista conversas.
* Claim pela Central funciona.
* Tickets novos são atribuídos ao grupo correto.
* SOLVED/CLOSED fecha conversation e runtime.

## 6\. Premissas técnicas revisadas

### Campo real de técnico

Usar:

```text
assigned\\\_user\\\_id
```

Não usar:

```text
claimed\\\_by
```

### Timestamp de claim

Usar:

```text
claimed\\\_at
```

Apenas para registrar quando o atendimento foi assumido.

Reply não deve alterar `assigned\\\_user\\\_id` nem `claimed\\\_at`.

### Validação de ações da Central

Toda ação mutável deve validar:

```text
conversation\\\_id + ticket\\\_id
```

Nunca validar apenas `conversation\\\_id`.

### Reply pela Central

Só pode responder quem assumiu a conversa:

```text
runtime.assigned\\\_user\\\_id == usuário logado
```

Super-Admin não deve responder conversa de outro técnico nesta fase.

### Idempotência do reply

Tratar como best-effort no MVP:

* botão desabilitado;
* loading;
* evitar duplo clique comum.

Não prometer garantia real sem backend/schema.

## 7\. Arquivos proibidos por padrão

Nenhuma IA pode alterar sem autorização explícita:

* core do GLPI;
* `integration-service/\\\*\\\*`, quando a fase for apenas UI/plugin;
* `hook.php`, salvo fase de sync;
* `TicketSyncService.php`, salvo fase de sync;
* `InboundWebhookService.ts`, salvo fase inbound;
* `OutboundMessageService.ts`, salvo fase outbound;
* `GlpiClient.ts`, salvo fase GLPI REST;
* schema/migrations, salvo fase de banco aprovada;
* templates ou controllers da aba WhatsApp, salvo fase da aba.

## 8\. Central de Atendimento — regras para fases 7.x

### Fase 7.1

Central lista conversas, filtros, paginação e link para ticket.

### Fase 7.2

Central permite claim com:

* operação atômica no PostgreSQL;
* `assigned\\\_user\\\_id`;
* `claimed\\\_at`;
* conflito 409;
* tentativa secundária de atribuir ticket GLPI.

### Fase 7.3

Central permite reply somente se:

* conversa está aberta;
* runtime não está closed;
* `assigned\\\_user\\\_id` é o usuário logado;
* `conversation\\\_id + ticket\\\_id` conferem;
* CSRF válido;
* permissão UPDATE válida.

Não incluir nesta fase:

* polling;
* anexos;
* close/reopen/transfer;
* override de Super-Admin;
* alteração no Node;
* schema novo.

## 9\. Critério mínimo de aceite

Nenhum “terminei” é aceito sem confirmar:

1. arquivos alterados;
2. arquivos proibidos não alterados;
3. diff mínimo;
4. `php -l` nos PHP alterados;
5. build/test quando houver Node;
6. inbound preservado;
7. outbound preservado;
8. roteamento preservado;
9. sync SOLVED/CLOSED preservado;
10. Central preservada;
11. logs estruturados;
12. testes manuais executados ou declarados como não executados.

## 10\. Logs e segurança

Nunca registrar:

* tokens completos;
* chaves de API;
* cookies;
* senhas;
* stack trace para usuário final;
* payload sensível sem mascaramento.

Erro para usuário deve ser amigável.

Erro técnico deve ir para log seguro.

## 11\. Quando parar

A IA deve parar e pedir confirmação quando:

* precisar alterar schema;
* precisar alterar Node em fase PHP;
* precisar alterar hook em fase Central;
* identificar campo inexistente;
* encontrar divergência entre prompt e código;
* precisar mexer no core;
* uma regra do AGENTS.md impedir o escopo pedido.



