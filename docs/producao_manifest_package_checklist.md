# Checklist de Manifesto e Pacote Manual

Este checklist deve ser executado no dev local antes de copiar o pacote para cloud.

## Manifesto

- [ ] `package_manifest.json` existe.
- [ ] `build_id` preenchido.
- [ ] `package_id` preenchido.
- [ ] `generated_at` preenchido.
- [ ] `phase_ids` inclui fases recentes.
- [ ] `critical_files` contem arquivos esperados.
- [ ] hashes SHA-256 estao preenchidos.
- [ ] `expected_migrations` conferidas.
- [ ] `secrets_included` e `false`.

## Git Local

Git existe apenas no dev local. Cloud nao precisa ter Git.

Comandos locais de revisao:

```bash
git diff --name-only
git status --short
git diff --check
```

Validar:

- [ ] nenhum arquivo sensivel aparece;
- [ ] arquivos `??` foram classificados;
- [ ] pacote final inclui apenas o necessario;
- [ ] docs de rollout/rollback/smoke acompanham o pacote.

## Exclusoes Obrigatorias

Nao incluir:

- `.env`;
- `.ovpn`;
- dumps;
- backups;
- certificados privados;
- tokens;
- senhas;
- payloads reais;
- logs com PII desnecessaria.

## Cloud Sem Git

- [ ] copiar pacote manualmente;
- [ ] manter backup do pacote anterior;
- [ ] reiniciar Node;
- [ ] reiniciar PHP-FPM/LSWS ou invalidar OPcache;
- [ ] abrir Diagnostico Operacional;
- [ ] confirmar `build_id`/`package_id`;
- [ ] confirmar sem `runtime_mismatch`.
