# Checklist de Monitoramento

Fase: `integaglpi_post_production_baseline_001`

Objetivo: checklist diário 24/7 para N1/N2 validar operação sem alterar produção.

## Checklist Diário

- [ ] Confirmar health/readiness do `integration-service`.
- [ ] Confirmar containers/serviços em estado saudável no painel operacional autorizado.
- [ ] Confirmar PostgreSQL e Redis disponíveis.
- [ ] Revisar logs críticos sanitizados do Node.
- [ ] Revisar logs críticos sanitizados do GLPI/plugin.
- [ ] Confirmar Webhook Guard ativo e sem drops indevidos.
- [ ] Confirmar inbound WhatsApp recebido.
- [ ] Confirmar outbound WhatsApp enviado manualmente quando aplicável.
- [ ] Confirmar delivery `sent`, `delivered`, `read` e falhas `failed`.
- [ ] Confirmar falhas Meta com erro sanitizado.
- [ ] Confirmar criação de follow-up GLPI.
- [ ] Confirmar reabertura com motivo quando houver caso real.
- [ ] Confirmar CSAT recebido ou pendente de forma visível.
- [ ] Confirmar inatividade/autoclose base sem loops.
- [ ] Confirmar Contratos/Horas carregando para perfil autorizado.
- [ ] Confirmar Dashboard de qualidade carregando para perfil autorizado.
- [ ] Confirmar IA Supervisora OFF em produção.

## Alertas Comuns

- `runtime_mismatch`: acionar N2 antes de qualquer ação.
- `package_incomplete`: bloquear promoção e validar pacote manual.
- `DROPPED_UNAUTHORIZED_NUMBER`: validar allowlist sem expor IDs reais.
- Delivery `failed` recorrente: registrar código Meta sanitizado e amostra sem payload bruto.
- Erro GLPI 403: validar permissão do usuário técnico ou token de serviço com responsável.
- Timeout GLPI/Meta: registrar horário, operação e correlation_id.

## Evidência Segura

- Usar prints sem telefone completo.
- Mascarar IDs, números e e-mails quando não forem necessários.
- Registrar `correlation_id`, horário e tela.
- Não copiar payload bruto do webhook.

## Segurança Documental

Nunca versionar, copiar ou colar em documentação: .env real, .ovpn, tokens, Bearer tokens, PSK, Phone Number ID real, senhas, dumps SQL, backups reais, payloads brutos sensíveis ou dados pessoais desnecessários.
