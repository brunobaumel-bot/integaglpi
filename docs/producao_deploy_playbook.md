# Playbook de Deploy Manual - Producao

Status: manual only. Nao executar automaticamente por Codex.

## Pre-Deploy

1. Obter aprovacao humana explicita.
2. Confirmar janela de manutencao.
3. Confirmar backup recente e restauravel.
4. Revisar pacote e excluir:
   - `.env` real;
   - logs;
   - dumps;
   - backups;
   - `node_modules`;
   - `dist` local;
   - arquivos `.ovpn`;
   - tokens, senhas e chaves reais.
5. Rotacionar segredos quando aplicavel.
6. Confirmar que IA Supervisora ficara desabilitada em producao.

## Configuracao de Ambiente

Usar `integration-service/.env.production.example` como modelo e preencher manualmente no servidor.

Fonte da verdade para nomes aceitos pelo Node:

- `integration-service/src/config/env.ts`

Obrigatorio para producao:

```env
AI_SUPERVISOR_ENABLED=false
AI_SUPERVISOR_DRY_RUN=true
AI_SUPERVISOR_BASE_URL=http://127.0.0.1:11434/disabled-prod-ai
```

Valores reais devem ser preenchidos apenas no `.env` do servidor, nunca no repositorio.

Nao usar nomes legados no `.env` de producao:

- `GLPI_BASE_URL`
- `DATABASE_URL`
- `OLLAMA_BASE_URL`

Usar os nomes reais do loader:

- `GLPI_API_BASE_URL`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`
- `AI_SUPERVISOR_BASE_URL`

## Ordem Manual Recomendada

1. Parar janela de alteracao no GLPI/plugin, se necessario.
2. Fazer backup do banco GLPI/MariaDB.
3. Fazer backup do PostgreSQL IntegraGLPI.
4. Fazer backup dos arquivos atuais do plugin `integaglpi`.
5. Fazer backup do diretório atual do `integration-service`.
6. Copiar arquivos do pacote aprovado para o servidor.
7. Instalar dependencias Node no servidor, se necessario.
8. Aplicar migrations PostgreSQL manualmente, uma a uma, revisando saida.
9. Validar `.env` de producao sem IA.
   - Confirmar `AI_SUPERVISOR_ENABLED=false`.
   - Confirmar checkbox IA Supervisora desmarcado na configuracao do plugin GLPI.
   - Confirmar ausencia de `GLPI_BASE_URL`, `DATABASE_URL` e `OLLAMA_BASE_URL`.
10. Reiniciar manualmente o `integration-service`.
11. Limpar cache do GLPI somente se o operador considerar necessario.
12. Executar smoke de producao.

## Migrations

- Aplicar somente migrations ainda nao aplicadas.
- Nao executar `DROP`, `TRUNCATE` ou `DELETE` operacional.
- Registrar hora, operador, migration e resultado.
- Se uma migration falhar, parar e acionar rollback.

## Pos-Deploy

1. Confirmar health do `integration-service`.
2. Confirmar webhook Meta apontando para producao correta.
3. Confirmar `META_PHONE_NUMBER_ID` de producao.
4. Confirmar IA desligada.
5. Executar checklist de smoke.
6. Registrar evidencias.

## Proibido

- Deploy automatico.
- Commit/push automatico.
- Aplicar migration sem backup.
- Ativar IA Supervisora em producao.
- Incluir segredo no pacote.
- Alterar core GLPI.
