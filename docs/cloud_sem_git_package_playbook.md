# Cloud sem Git: Pacote Manual

O servidor cloud é ambiente de execução/smoke. Git, diff e commit ficam no dev local.

## Preparação no Dev Local

- Rodar testes obrigatórios.
- Gerar/validar `package_manifest.json`.
- Conferir `git diff --name-only`.
- Remover arquivos temporários, logs e payloads.
- Separar `.env.example` de `.env` real.

## Conteúdo do Pacote

- `integaglpi/`
- `integration-service/`
- `package_manifest.json`
- `docs/`
- migrations aditivas aprovadas

Não incluir:

- `.env` real;
- dumps de banco;
- tokens;
- certificados privados;
- payloads de WhatsApp;
- arquivos de debug locais.

## Aplicação no Cloud

- Copiar arquivos manualmente.
- Manter backup do pacote anterior.
- Reiniciar Node.
- Reiniciar PHP-FPM/LSWS ou invalidar OPcache.
- Rodar Diagnóstico Operacional.
- Rodar smoke produção.

## OPcache/Cache

Se o código correto aparece no dev local, mas o cloud executa versão antiga:

- conferir caminho do arquivo no log;
- reiniciar PHP-FPM/LSWS;
- invalidar OPcache se houver painel/rotina autorizada;
- limpar cache do navegador;
- reiniciar Node se a mudança for no `integration-service`.

O plugin não deve executar `git`, `docker`, `psql`, `pg_dump`, `system`, `exec`, `shell_exec` ou comandos de restart.
