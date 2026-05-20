# Runbook Operacional

Fase: `integaglpi_post_production_baseline_001`

Objetivo: orientar validação e resposta operacional sem alterar código, banco ou produção fora de procedimentos aprovados.

## Rotina Operacional

- Validar health do Node e do plugin no início do turno.
- Validar Console/Central com perfil operacional.
- Validar Dashboard com perfil autorizado.
- Conferir últimos erros Meta, GLPI e delivery.
- Conferir inatividade/autoclose e CSAT.
- Conferir Contratos/Horas somente como operação autorizada.
- Registrar evidências com horário, usuário, ambiente e correlation_id.

## Como Validar TESTE

- Usar dados e números de teste autorizados.
- Executar inbound e outbound controlados.
- Criar ticket de teste com entidade permitida.
- Testar mídia pequena e segura.
- Validar delivery e reabertura com motivo.
- Validar CSAT.
- Validar que IA segue OFF quando o objetivo for simular produção.

## Como Validar PRODUÇÃO

- Executar somente smoke manual aprovado.
- Não acionar casos em massa.
- Não alterar `.env`, infraestrutura ou banco.
- Não executar scripts de cleanup.
- Não alterar Webhook Guard.
- Não ativar IA.
- Registrar qualquer falha com evidência sanitizada.

## Como Agir em Alerta Comum

- Falha de inbound: verificar Webhook Guard, assinatura Meta e logs sanitizados.
- Falha de outbound: verificar erro Meta sanitizado, janela 24h e template quando aplicável.
- Falha GLPI: verificar initSession, permissão e status da API.
- Falha de delivery: verificar WAMID local, evento Meta e linha de delivery.
- Conversa presa sem ticket: em TESTE, usar `Encerrar administrativamente` na Central apenas com operador autorizado, motivo claro e evidência. Em PRODUÇÃO, executar somente após aprovação humana do turno e confirmar que não há ticket GLPI vinculado.
- Pré-ticket incompleto: verificar na Central os campos respondidos, campos pendentes e próxima ação. Após 5 minutos sem resposta, o job de inatividade deve registrar o ciclo e enviar no máximo um lembrete configurável por parada.
- Runtime divergente: bloquear promoção e validar pacote/build_id.

## Encerramento Administrativo de Conversa Presa

- Usar somente para conversa sem `glpi_ticket_id`, sem atividade recente e fora do fluxo normal de ticket.
- Preencher motivo obrigatório com descrição objetiva, sem dados pessoais desnecessários.
- Confirmar que a ação não envia WhatsApp, não cria ticket e não altera ticket GLPI.
- Após executar, validar que a conversa saiu da lista ativa e que a auditoria registrou operador, motivo, status anterior e novo status.
- Se a ação for bloqueada por ticket, atividade recente, status terminal ou lock, não usar SQL manual; coletar evidência sanitizada e escalar.

## Pré-ticket Incompleto

- A Central deve mostrar dados já informados pelo cliente, campos pendentes e a próxima ação recomendada.
- O lembrete `profile_collection_reminder` é enviado pelo job existente de inatividade, sem scheduler novo.
- Fora da janela WhatsApp 24h, texto livre não deve ser enviado; se não houver template local configurado, registrar `skip_reason` e aguardar retorno do cliente.
- Nunca criar ticket automaticamente enquanto houver campos obrigatórios pendentes.

## Coleta de Evidências

- Coletar apenas: tela, horário, operação, correlation_id, status e erro sanitizado.
- Usar placeholders para caminhos e hosts quando documentar.
- Não colar telefone completo, tokens ou payload bruto.

## O Que Nunca Fazer em Produção

- Não executar deploy automático.
- Não executar rollback automático.
- Não executar cleanup automático.
- Não executar SQL DDL/DML fora de janela aprovada.
- Não usar `git clean`, `git reset` ou remoções destrutivas.
- Não copiar `.env` entre ambientes.
- Não ativar IA para cliente.
- Não iniciar LogMeIn nesta fase.

## Segurança Documental

Nunca versionar, copiar ou colar em documentação: .env real, .ovpn, tokens, Bearer tokens, PSK, Phone Number ID real, senhas, dumps SQL, backups reais, payloads brutos sensíveis ou dados pessoais desnecessários.
