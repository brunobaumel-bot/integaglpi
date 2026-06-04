# Auditoria Regressiva dos Relatos de Produção

Phase: `integaglpi_v8_production_reports_regression_audit_001`
Updated: 2026-06-04

## Objetivo

Transformar relatos reais dos técnicos em uma matriz executável de testes para HOMOLOGAÇÃO, com evidência objetiva antes de qualquer correção. Esta fase não corrige bugs, não altera runtime, não acessa produção, não altera banco real e não envia mensagem para cliente real.

## Ambiente Permitido

- Permitido: TESTE e HOMOLOGAÇÃO, com dados sintéticos ou dados formalmente autorizados.
- Proibido: PRODUÇÃO, cliente real, WhatsApp real não aprovado, ticket real fora de massa de teste.
- Qualquer escrita sintética em HOMOLOGAÇÃO exige gate humano, operador identificado e evidência antes/depois.

## Pré-condições

- Workspace limpo e pacote aprovado para HOMOLOGAÇÃO.
- Build atual identificado por commit.
- Feature flags revisadas: cloud off por padrão, LogMeIn opcional/read-only, IA sem mutação.
- Perfil técnico, supervisão e admin de teste disponíveis.
- Número WhatsApp de teste autorizado.
- Banco de HOMOLOGAÇÃO com backup validado se qualquer escrita sintética for aprovada.
- Acesso a logs sanitizados do GLPI, integration-service, Redis e PostgreSQL da integração.

## Regras de Segurança

- Não corrigir durante a auditoria.
- Não executar `DELETE`, `TRUNCATE`, `DROP` ou migration.
- Não enviar mensagem para cliente real.
- Não alterar ticket real.
- Não acessar produção.
- Não expor telefone completo, email, token, bearer, PSK, segredo, prompt bruto ou payload bruto no relatório.
- Node não deve acessar MariaDB GLPI.
- IA não pode enviar WhatsApp, alterar ticket ou publicar KB.
- LogMeIn não pode iniciar sessão remota nem ser dependência do atendimento.

## Classificação

| Classificação | Uso |
| --- | --- |
| PASS | Comportamento esperado confirmado com evidência objetiva. |
| FAIL | Problema reproduzido no build atual. Abrir fase de correção separada. |
| INCONCLUSIVE | Evidência insuficiente, ambiente indisponível ou dados incompatíveis. |
| NOT_APPLICABLE | Caso não se aplica ao ambiente/teste atual, com justificativa. |

## Campos Obrigatórios de Evidência

- `ambiente`
- `commit_build`
- `operador`
- `perfil_glpi`
- `ticket_id_teste` ou `conversation_id_teste`, quando aplicável
- `timestamp_inicio`
- `timestamp_fim`
- `prints_sanitizados`
- `logs_sanitizados`
- `consultas_read_only_resultado`
- `classificacao`
- `observacao`

## Matriz T01-T23

### T01 — Entidade preservada na criação/migração

```yaml
test_id: T01
priority: P0
relato_original: perda de entidade
objetivo: confirmar que entidade selecionada/memorizada permanece no ticket e na conversa
pre_condicoes: contato de teste com e sem memoria de entidade
dados_sinteticos: telefone mascarado de homologacao, empresa de teste, entidade GLPI de teste
procedimento: iniciar atendimento, selecionar entidade quando pedido, abrir ticket, reabrir a Central e aba do chamado
consultas_read_only: verificar conversation.glpi_entity_id, origem da entidade e ticket GLPI por tela/consulta aprovada
evidencia_minima: print da selecao, print do ticket com entidade, log sanitizado da decisao
resultado_esperado: entidade nao volta a zero/nula e ticket fica na entidade correta
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: ticket criado com entidade nula/0 ou divergente
```

### T02 — Chamado criado via celular aparece no GLPI

```yaml
test_id: T02
priority: P0
relato_original: chamado com protocolo mas sem ticket GLPI
objetivo: validar que abertura via celular gera ticket GLPI visivel e vinculado
pre_condicoes: numero de teste autorizado e fila/entidade valida
dados_sinteticos: resumo curto, entidade de teste, fila de teste
procedimento: concluir fluxo WhatsApp ate abertura, capturar protocolo, buscar no GLPI e Central
consultas_read_only: conversation.glpi_ticket_id, ticket existente, timeline da Central
evidencia_minima: protocolo mascarado, ticket_id, conversation_id, print GLPI
resultado_esperado: protocolo corresponde a ticket GLPI existente e vinculado
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: protocolo exibido sem ticket vinculado
```

### T03 — Chamados travados na Central

```yaml
test_id: T03
priority: P0
relato_original: chamados travados na Central
objetivo: identificar conversas que ficam sem proxima acao ou sem transicao possivel
pre_condicoes: Central em HOMOLOGACAO com filtros ativos
dados_sinteticos: conversas em open, awaiting_entity_selection e coleta de perfil
procedimento: abrir Central, aplicar filtros de pendencia, selecionar card e validar proxima acao
consultas_read_only: status conversation/runtime, assigned_user_id, next_action, updated_at
evidencia_minima: print da lista, contexto da conversa, status runtime
resultado_esperado: toda conversa ativa mostra proxima acao coerente ou fica fora da fila ativa
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: conversa ativa sem acao, sem ticket e sem caminho operacional
```

### T04 — Categoria e tempo do chamado editáveis

```yaml
test_id: T04
priority: P1
relato_original: categoria/tempo retornando bloqueio
objetivo: verificar se campos GLPI continuam editaveis por perfil autorizado
pre_condicoes: ticket de teste aberto e perfil com direito GLPI apropriado
dados_sinteticos: categoria e tempo ficticios permitidos
procedimento: editar categoria/tempo pelo GLPI em HOMOLOGACAO com operador autorizado
consultas_read_only: antes/depois na tela do ticket e historico GLPI
evidencia_minima: print antes/depois e mensagem de sucesso/erro
resultado_esperado: perfil autorizado salva; perfil sem direito recebe bloqueio esperado
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: operador autorizado recebe 403 sem motivo ou tecnico sem direito consegue salvar
```

### T05 — Botão Salvar / erro 403

```yaml
test_id: T05
priority: P0
relato_original: Salvar retorna 403
objetivo: validar CSRF, sessao e perfil nos formularios do plugin/GLPI
pre_condicoes: aba aberta com sessao valida e outro caso com sessao expirada
dados_sinteticos: ticket de teste e formulario permitido
procedimento: salvar com sessao valida; repetir apos expirar sessao; registrar resposta
consultas_read_only: status HTTP, mensagem UI, logs sanitizados de CSRF/RBAC
evidencia_minima: Network sanitizado e mensagem exibida
resultado_esperado: sessao valida salva conforme direito; expirada mostra erro claro sem stack trace
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: 403 opaco em sessao valida ou bypass sem CSRF
```

### T06 — Técnico exibido corretamente no plugin

```yaml
test_id: T06
priority: P1
relato_original: falhas de atribuição/técnico
objetivo: confirmar tecnico responsavel exibido igual no GLPI, runtime e Central
pre_condicoes: conversa assumida por tecnico de teste
dados_sinteticos: tecnico A e tecnico B de homologacao
procedimento: assumir atendimento, abrir Central e aba WhatsApp, comparar responsavel
consultas_read_only: assigned_user_id, claimed_at, ticket users
evidencia_minima: prints Central/ticket e status runtime
resultado_esperado: tecnico exibido corresponde ao responsavel real
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: UI exibe tecnico diferente do runtime/GLPI
```

### T07 — Transferência de técnico

```yaml
test_id: T07
priority: P0
relato_original: tecnico anterior conseguiu responder apos transferencia
objetivo: validar ownership e bloqueio backend depois da transferencia
pre_condicoes: conversa assumida pelo tecnico A e transferida ao tecnico B
dados_sinteticos: ticket/conversa de teste
procedimento: transferir com perfil autorizado; tentar resposta pelo tecnico antigo e pelo novo
consultas_read_only: assigned_user_id antes/depois, resposta HTTP, timeline
evidencia_minima: prints dos bloqueios e sucesso do responsavel
resultado_esperado: tecnico antigo bloqueado; tecnico atual pode responder
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: tecnico antigo envia mensagem com sucesso
```

### T08 — Notificação/mensagem em atribuição

```yaml
test_id: T08
priority: P1
relato_original: assumção nativa nao notifica cliente
objetivo: verificar notificação unica em claim plugin e GLPI nativo
pre_condicoes: ticket WhatsApp de teste em status Novo
dados_sinteticos: tecnico de teste e cliente de teste
procedimento: assumir pelo plugin e, em outro caso, atribuir pelo GLPI nativo
consultas_read_only: audit/eventos, mensagens outbound mock/aprovadas, runtime assigned_user_id
evidencia_minima: evento sanitizado e ausência de duplicidade
resultado_esperado: cliente recebe no maximo uma notificacao por evento aprovado
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: duplicidade ou ausencia de notificacao em claim aprovado
```

### T09 — Telefone mascarado vs acionamento técnico

```yaml
test_id: T09
priority: P1
relato_original: telefone mascarado impedindo operação
objetivo: garantir que UI mascara PII sem impedir ações autorizadas
pre_condicoes: conversa com telefone valido e usuario autorizado
dados_sinteticos: telefone de homologacao
procedimento: abrir Central/ticket, confirmar mascara visual e executar ação permitida
consultas_read_only: payload de action deve usar conversation_id/ticket_id, nao telefone visual
evidencia_minima: print com telefone mascarado e action bem-sucedida
resultado_esperado: telefone completo nao aparece; operacao usa ids internos
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: UI exige telefone completo ou expõe telefone bruto
```

### T10 — Fechamento por inatividade respeita pendente/ação interna

```yaml
test_id: T10
priority: P0
relato_original: fechamento indevido por inatividade
objetivo: validar que inatividade/autoclose nao fecha caso com pendencia interna indevida
pre_condicoes: casos de teste em coleta, aguardando entidade, open e pendencia interna
dados_sinteticos: timers de homologacao aprovados
procedimento: simular janela de inatividade conforme job aprovado ou revisar eventos existentes
consultas_read_only: inactivity_tracking, job_events, conversation status, ticket status
evidencia_minima: evento de skip/send/autoclose sanitizado
resultado_esperado: autoclose respeita status, pendencias e regras de skip
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: ticket/conversa fecha sem regra aplicavel
```

### T11 — Reabertura manual

```yaml
test_id: T11
priority: P0
relato_original: falha de reabertura
objetivo: confirmar reabertura manual preserva contexto e permite continuidade
pre_condicoes: ticket de teste solucionado/fechado com conversa vinculada
dados_sinteticos: motivo de reabertura sanitizado
procedimento: reabrir pelo fluxo aprovado e enviar resposta de teste quando autorizado
consultas_read_only: ticket status, conversation/runtime status, audit
evidencia_minima: antes/depois status e timeline
resultado_esperado: reabertura não cria ticket duplicado e conversa volta ao fluxo correto
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: novo ticket duplicado ou conversa permanece bloqueada
```

### T12 — Histórico ao responder

```yaml
test_id: T12
priority: P1
relato_original: histórico/resposta sem contexto
objetivo: validar que tecnico ve historico suficiente antes de responder
pre_condicoes: conversa com mensagens inbound/outbound anteriores
dados_sinteticos: mensagens curtas sem PII
procedimento: abrir aba WhatsApp e Central, responder somente se responsavel
consultas_read_only: timeline ordenada por created_at e origem inbound/outbound
evidencia_minima: print sanitizado da timeline e resposta contextual
resultado_esperado: historico aparece ordenado e resposta não perde contexto
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: resposta enviada com timeline vazia/incompleta sem aviso
```

### T13 — Áudio/vídeo/mídia anexados

```yaml
test_id: T13
priority: P1
relato_original: mídia não anexada
objetivo: verificar anexos de midia no estado open sem bloquear webhook
pre_condicoes: conversa open de teste e arquivo pequeno permitido
dados_sinteticos: audio/video/imagem de teste sem PII
procedimento: enviar midia de teste, aguardar processamento assincrono, abrir ticket
consultas_read_only: message metadata, GLPI documents, logs de download/cleanup sanitizados
evidencia_minima: anexo visivel ou erro controlado com motivo
resultado_esperado: midia permitida vira anexo/metadado; falha nao quebra fluxo principal
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: webhook bloqueia ou binario aparece no PostgreSQL
```

### T14 — Foto enviada na abertura

```yaml
test_id: T14
priority: P1
relato_original: foto enviada na abertura nao aparece
objetivo: confirmar comportamento quando midia chega antes/depois da criacao do ticket
pre_condicoes: contato novo de teste e regra de midia conhecida
dados_sinteticos: imagem pequena de teste
procedimento: enviar imagem na abertura e registrar resposta do bot
consultas_read_only: status da conversa, message type, anexo/documento
evidencia_minima: print resposta e registro de midia
resultado_esperado: midia fora do estado permitido recebe fallback; midia permitida anexa
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: perda silenciosa sem resposta ou bloqueio do webhook
```

### T15 — Mensagens em Conversas WhatsApp vs aba Chamados

```yaml
test_id: T15
priority: P1
relato_original: mensagens divergentes entre Conversas WhatsApp e aba Chamados
objetivo: validar consistencia de timeline nas duas superficies
pre_condicoes: ticket com mensagens inbound/outbound recentes
dados_sinteticos: conversa de teste com pelo menos 3 mensagens
procedimento: comparar Central/Conversas WhatsApp e aba do chamado
consultas_read_only: messages by conversation_id e glpi_ticket_id
evidencia_minima: prints das duas superficies com timestamps
resultado_esperado: mesmas mensagens principais aparecem sem inversao de origem
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: mensagem enviada/recebida some de uma superficie
```

### T16 — Automação invasiva

```yaml
test_id: T16
priority: P0
relato_original: automação invasiva
objetivo: confirmar que IA/bot nao envia perguntas ou respostas fora do fluxo aprovado
pre_condicoes: SmartHelp, Copiloto, cloud e bot em defaults seguros
dados_sinteticos: atendimento de teste com ticket aberto
procedimento: abrir telas e aguardar sem clicar em ações manuais
consultas_read_only: mensagens outbound, audit, logs de IA
evidencia_minima: ausência de outbound automatico e flags seguras
resultado_esperado: nenhuma IA/SmartHelp/Copiloto envia WhatsApp ou altera ticket automaticamente
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: qualquer outbound automatico nao aprovado
```

### T17 — Divergência de nome do remetente

```yaml
test_id: T17
priority: P2
relato_original: divergência de nome de remetente
objetivo: validar nome exibido para contato/remetente em Central e ticket
pre_condicoes: contato com nome informado e memoria existente/opcional
dados_sinteticos: nome ficticio e empresa de teste
procedimento: iniciar atendimento, informar nome, abrir telas e comparar labels
consultas_read_only: contact profile, message sender display, ticket content
evidencia_minima: prints com nome mascarado/parcial se necessario
resultado_esperado: nome exibido corresponde a origem mais atual e nao troca com outro contato
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: contato aparece com nome de outro remetente
```

### T18 — Bot principal não carrega

```yaml
test_id: T18
priority: P0
relato_original: bot principal instavel ou nao carrega
objetivo: validar health do fluxo principal sem IA/cloud/LogMeIn obrigatorios
pre_condicoes: integration-service e webhook guard em homologacao
dados_sinteticos: mensagem texto simples
procedimento: executar inbound controlado, escolher fila e validar resposta do bot
consultas_read_only: health/readiness, logs inbound, routing logs
evidencia_minima: status health e resposta do bot
resultado_esperado: bot responde dentro do tempo esperado e segue FSM
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: webhook sem resposta, timeout recorrente ou FSM nao inicia
```

### T19 — Abertura manual de chamados por e-mail/telefone

```yaml
test_id: T19
priority: P1
relato_original: abertura manual por e-mail/telefone
objetivo: validar fluxo manual sem quebrar vinculo WhatsApp/ticket
pre_condicoes: perfil autorizado e dados de contato sinteticos
dados_sinteticos: email e telefone de teste
procedimento: abrir chamado manual conforme tela aprovada e vincular telefone se permitido
consultas_read_only: ticket criado, conversation link se houver, audit
evidencia_minima: ticket_id e payload sanitizado
resultado_esperado: chamado manual nao cria conversa duplicada nem exige PII em tela
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: cria ticket duplicado ou vaza telefone/email completo sem necessidade
```

### T20 — Locks Redis / dead-letter / filas presas

```yaml
test_id: T20
priority: P0
relato_original: filas presas, locks ou dead-letter
objetivo: validar que locks/dead-letter/fila nao deixam atendimento travado sem evidencia
pre_condicoes: acesso read-only a health/logs de homologacao
dados_sinteticos: conversation_id de teste ou fila vazia
procedimento: consultar health/readiness, eventos recentes, dead-letter e status de fila sem mutar dados
consultas_read_only: Redis/health aprovado, audit events, dead-letter diagnostics
evidencia_minima: snapshot sanitizado de locks/dead-letter/fila
resultado_esperado: locks expiram, dead-letter visivel e fila sem backlog indevido
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: lock sem TTL, dead-letter oculto ou fila sem consumo
```

### T21 — Sessão expirada / CSRF após aba aberta por tempo prolongado

```yaml
test_id: T21
priority: P0
relato_original: 403 após aba aberta por muito tempo
objetivo: validar renovacao/erro amigavel de CSRF e sessao
pre_condicoes: aba Central/ticket aberta e sessao de teste controlada
dados_sinteticos: ticket/conversa de homologacao
procedimento: aguardar expiracao ou simular token invalido; tentar acao permitida
consultas_read_only: Network, logs CSRF/RBAC sanitizados
evidencia_minima: HTTP status, mensagem UI e ausencia de stack trace
resultado_esperado: erro claro e nenhuma mutacao; sessao valida opera normalmente
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: POST mutavel passa sem CSRF ou 403 opaco em sessao valida
```

### T22 — SmartHelp guiado: resumo, busca local, cloud-safe, PII Guard

```yaml
test_id: T22
priority: P1
relato_original: regressao SmartHelp guiado
objetivo: validar resumo-only, busca local, cloud bloqueada e PII Guard
pre_condicoes: ticket de teste com texto sem PII e outro com PII sintetica
dados_sinteticos: resumo tecnico curto e dado pessoal ficticio
procedimento: clicar Resumo, Busca local, Pedir ajuda externa e revisar preview
consultas_read_only: Network, resposta JSON sanitizada, audit cloud metadata
evidencia_minima: prints dos passos, sem payload bruto, sem envio automatico
resultado_esperado: resumo nao busca KB; busca local usa resumo; cloud exige preview/consentimento/permissao
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: cloud recebe PII, IA envia WhatsApp ou altera ticket
```

### T23 — Menus/drilldowns: Monitoramento, Supervisão, Auditoria/Eventos, SLA/Inatividade

```yaml
test_id: T23
priority: P2
relato_original: regressao de menus/drilldowns
objetivo: validar menus consolidados e rotas internas sem esconder funcionalidade
pre_condicoes: perfis admin, supervisor e tecnico de teste
dados_sinteticos: nenhum dado real necessario
procedimento: abrir sidebar e testar Monitoramento Operacional, Central do Supervisor e drilldowns
consultas_read_only: URLs acessadas, HTTP status, RBAC por perfil
evidencia_minima: prints de menu e paginas Auditoria/Eventos/SLA/Inatividade
resultado_esperado: rotas antigas preservadas, Eventos usa view=events, SLA/Inatividade aparecem como drilldowns
classificacao: PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE
stop_condition: menu some para perfil autorizado ou tecnico ganha diagnostico indevido
```

## Critérios de Aceitação

- T01 a T23 executados ou justificados como `NOT_APPLICABLE`.
- Toda evidência é sanitizada.
- Nenhum teste acessa produção.
- Escritas sintéticas possuem gate humano.
- Falhas viram backlog/fase de correção separada, sem correção durante a auditoria.

## Stop Conditions Globais

- Necessidade de acessar produção.
- Necessidade de executar SQL destrutivo.
- Necessidade de enviar mensagem para cliente real.
- Necessidade de alterar ticket real.
- Necessidade de corrigir runtime durante a auditoria.
- Exposição de PII/segredo/payload bruto.
- Ambiente sem backup quando escrita sintética for aprovada.

## Template de Relatório Final

```yaml
phase_id: integaglpi_v8_production_reports_regression_audit_001
ambiente:
commit_build:
periodo_execucao:
operadores:
resumo:
  total_tests:
  pass:
  fail:
  inconclusive:
  not_applicable:
falhas:
  - test_id:
    severidade:
    evidencia_sanitizada:
    recomendacao:
decisao:
  status: PASSOU_PARA_CORRECAO | BLOQUEADO | HOMOLOGACAO_OK
  proxima_acao:
```
