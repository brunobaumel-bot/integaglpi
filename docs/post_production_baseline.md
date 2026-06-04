# Baseline Pós-Produção

Fase: `integaglpi_post_production_baseline_001`

Data da baseline: `2026-05-18`

Commit documental atual: `7012c4f`

Versão documental atual: IntegraGLPI produção estável pós-entrega de Console, Dashboard, Delivery, Contratos/Horas, CSAT, Reabertura e IA Supervisora read-only.

## Status dos Ambientes

- TESTE: ambiente de validação e smoke antes de qualquer promoção.
- PRODUÇÃO: ativa, estável e funcional.
- Promoção: sempre manual, com gate humano, backup e rollback preparados.
- Cloud: ambiente de execução; Git/diff/commit ficam no desenvolvimento local.

## Funcionalidades Estáveis

- WhatsApp inbound/outbound.
- Mídia e anexos.
- Delivery `sent`, `delivered`, `read` e `failed`.
- Webhook Guard.
- Console Operacional / Central.
- Pré-ticket em grande parte funcional.
- Entidade real e memória de entidade em grande parte funcional.
- Contratos e banco de horas.
- Dashboard de qualidade.
- Reabertura com motivo.
- CSAT.
- Inatividade/autoclose base.
- Catálogo de mensagens base.
- IA Supervisora 8.5 somente leitura.

## Estado de Segurança

- IA Supervisora permanece OFF em produção.
- IA Copiloto não iniciada.
- LogMeIn ainda não está implementado.
- Webhook Guard deve permanecer ativo.
- Segredos continuam fora do repositório e fora da documentação.

## Pendências do Roadmap

- Próxima fase funcional: `integaglpi_console_soft_close_and_stuck_conversations_001`.
- Soft close operacional no Console.
- Tratamento de conversas presas.
- Refinos de pré-ticket e entidade/memória conforme smoke real.
- Evolução futura de IA somente após nova fase e aprovação explícita.
- LogMeIn fora do escopo atual.

## Segurança Documental

Nunca versionar, copiar ou colar em documentação: .env real, .ovpn, tokens, Bearer tokens, PSK, Phone Number ID real, senhas, dumps SQL, backups reais, payloads brutos sensíveis ou dados pessoais desnecessários.

## V8 Final — Baseline A Capturar Após Produção

Esta seção é checklist documental. Não executa deploy e não autoriza produção.

- Commit/pacote implantado.
- Horário da janela.
- Operador responsável.
- Resultado do smoke final V8.
- Status do health/readiness.
- Status da Central Enterprise.
- Status do Monitoramento Operacional.
- Status da Central do Supervisor.
- Status de SmartHelp: manual, sem autoenvio, sem mutação.
- Status de cloud: OFF ou gate completo com evidência.
- Status de LogMeIn: OFF/read-only/opcional.
- Resultado da inspeção de logs sem PII/segredo/payload bruto.
- Rollback window encerrada somente após aceite humano.
