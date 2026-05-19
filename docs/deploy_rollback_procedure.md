# Deploy e Rollback Manual

Fase: `integaglpi_post_production_baseline_001`

Este documento contém exemplos manuais com placeholders. Nenhum comando deve ser executado automaticamente.

## Pré-Deploy Checklist

- [ ] Backup do plugin pronto.
- [ ] Backup do banco GLPI pronto.
- [ ] Backup do PostgreSQL do integration-service pronto.
- [ ] Backup do `.env` real fora do repositório pronto.
- [ ] Rollback preparado e testado em TESTE.
- [ ] Smoke em TESTE aprovado.
- [ ] Diff real revisado.
- [ ] Cursor aprovou o diff real.
- [ ] Pacote não contém `.env`, `.ovpn`, logs, dumps, backups ou segredos.
- [ ] IA permanece OFF em produção.

## Exemplo Manual de Sync TESTE para PRODUÇÃO

Exemplo ilustrativo. Ajustar `<origem>`, `<destino>`, `<usuario>`, `<host>` e caminhos conforme procedimento aprovado.

```bash
rsync -avz \
  --exclude=.env \
  --exclude=.ovpn \
  --exclude=*.log \
  --exclude=*.sql \
  --exclude=*.dump \
  --exclude=node_modules \
  --exclude=vendor \
  --exclude=.git \
  <origem-do-pacote>/ <usuario>@<host-producao>:<destino-do-pacote>/
```

Este exemplo não deve usar `--delete`. Cleanup, quando necessário, é manual, revisado e autorizado por humano.

## Pós-Deploy Smoke Curto

- Abrir health/readiness.
- Confirmar build/pacote esperado.
- Confirmar Console/Central.
- Confirmar inbound.
- Confirmar outbound manual.
- Confirmar criação/follow-up GLPI.
- Confirmar delivery/read/failed.
- Confirmar reabertura com motivo.
- Confirmar CSAT.
- Confirmar IA OFF em produção.

## Rollback Manual Curto

- Bloquear novas mudanças.
- Registrar horário, operador, build/pacote e motivo.
- Restaurar plugin do backup aprovado.
- Restaurar pacote Node do backup aprovado.
- Preservar `.env` real de produção.
- Reiniciar serviços somente conforme procedimento operacional autorizado.
- Rodar smoke curto.
- Registrar resultado.

## Cleanup Manual

- Não executar cleanup automático.
- Não usar comandos destrutivos sem revisão humana.
- Remover arquivos temporários somente após conferência do pacote e aprovação.
- Nunca remover backups antes do fechamento da janela de rollback.

## Segurança Documental

Nunca versionar, copiar ou colar em documentação: .env real, .ovpn, tokens, Bearer tokens, PSK, Phone Number ID real, senhas, dumps SQL, backups reais, payloads brutos sensíveis ou dados pessoais desnecessários.
