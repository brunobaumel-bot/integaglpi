# Plano de Rollout Controlado TESTE -> PRODUCAO

Fase: `integaglpi_controlled_production_rollout_001`

Este plano prepara a promocao manual do IntegraGLPI para producao. Ele nao autoriza deploy automatico, migration automatica, alteracao de `.env` real ou mudanca direta em producao.

## Objetivo

- Promover o pacote validado em TESTE para PRODUCAO com janela controlada.
- Preservar isolamento entre TESTE e PRODUCAO.
- Garantir backup, rollback, smoke e gates humanos.
- Manter IA desligada em producao, salvo decisao formal futura.
- Preservar Webhook Guard, manifest/build_id e pacote limpo.

## Escopo

Incluido:

- plugin GLPI `integaglpi`;
- `integration-service`;
- migrations aditivas aprovadas, quando aplicaveis;
- `package_manifest.json`;
- documentacao operacional em `docs/`.

Excluido:

- `.env` real;
- dumps, backups e certificados privados;
- `.ovpn`;
- tokens, senhas e chaves;
- AI-ENGINEER, Mini CRM ou IA Copiloto;
- qualquer automacao de deploy.

## Responsaveis

- Dono tecnico: valida pacote e smoke em TESTE.
- Operador de infraestrutura: aplica pacote manual e reinicia servicos.
- Responsavel GLPI: valida perfis, entidades, tickets e plugin.
- Aprovador humano: libera avancar, abortar ou rollback.

## Janela de Manutencao

- Definir inicio e fim antes da promocao.
- Congelar novas alteracoes durante a janela.
- Manter contato de rollback disponivel.
- Manter backups recentes antes de qualquer troca de pacote.

## Pre-requisitos

- TESTE aprovado com smoke completo.
- `package_manifest.json` presente.
- `build_id` e `package_id` conhecidos.
- Checklist de backup concluido.
- Checklist de migration revisado.
- Rollback ensaiado em nivel documental.
- Cloud reconhecida como ambiente sem Git.
- IA de producao explicitamente desligada.

## Ordem de Execucao Manual

1. Congelar pacote aprovado no dev local.
2. Validar manifest/package.
3. Realizar backups.
4. Copiar pacote manual para PRODUCAO.
5. Aplicar migrations manuais aprovadas, se houver.
6. Reiniciar Node.
7. Reiniciar PHP-FPM/LSWS ou invalidar OPcache.
8. Abrir Diagnostico Operacional.
9. Conferir `build_id`, `package_id` e ausencia de `runtime_mismatch`.
10. Executar smoke de producao.
11. Registrar resultado e horario.

## Criterios de Avanco

- Backup validado.
- Manifest presente e consistente.
- Diagnostico Operacional sem segredo.
- Node readiness ok.
- Webhook Guard configurado.
- Smoke minimo aprovado.
- IA continua off em producao.

## Criterios de Abortar

- Manifest ausente ou `package_incomplete`.
- `runtime_mismatch`.
- Backup incompleto.
- Migration pendente sem aprovacao humana.
- Diagnostico expondo segredo.
- Webhook Guard ausente.
- Inbound/outbound basico falhando.
- IA ativa indevidamente em producao.

## Evidencias Minimas

- `build_id`/`package_id` vistos no plugin.
- Readiness Node visto no plugin.
- Horario de aplicacao.
- Resultado do smoke.
- Registro de quem aprovou avancar ou abortar.
