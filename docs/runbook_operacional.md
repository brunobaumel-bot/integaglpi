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
- Conversa presa: registrar e deixar para a próxima fase funcional.
- Runtime divergente: bloquear promoção e validar pacote/build_id.

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
