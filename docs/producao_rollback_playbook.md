# Rollback Produção

Rollback é manual e deve ser autorizado por humano.

## Gatilhos

- `runtime_mismatch` após promoção.
- Diagnóstico mostra `package_incomplete`.
- Console não carrega dados essenciais.
- Inbound ou outbound falha.
- Criação de ticket/regra de entidade falha.
- Contratos/Horas deixa de carregar.
- Reabertura/CSAT falha.

## Passos

1. Bloquear nova promoção.
2. Registrar `build_id`, `package_id`, horário e sintoma.
3. Restaurar diretório anterior do plugin.
4. Restaurar pacote anterior do `integration-service`.
5. Reiniciar Node.
6. Reiniciar PHP-FPM/LSWS ou invalidar OPcache.
7. Não apagar tickets, conversas ou contratos.
8. Não executar SQL destrutivo.
9. Rodar smoke mínimo.
10. Registrar evidência do rollback.

## Arquivos

- Restaurar `plugins/integaglpi` a partir do backup.
- Restaurar build anterior do `integration-service`.
- Restaurar `package_manifest.json` anterior, se usado pelo runtime.
- Nao copiar `.env` de TESTE para PRODUCAO.

## Configuracao/Env

- Preservar `.env` real de PRODUCAO.
- Se rollback exigir config anterior, restaurar somente do backup autorizado de PRODUCAO.
- Nao registrar token, senha ou DSN completo no incidente.

## Webhook Meta

- Nao alterar app/phone id sem aprovacao.
- Nao enfraquecer assinatura Meta.
- Nao remover allowlist/Webhook Guard.

## Banco

Nenhuma migration destrutiva é permitida. Para migrations aditivas já aplicadas, o rollback operacional deve ser feito por código/pacote anterior, mantendo colunas/tabelas extras inativas até fase própria.

Restauracao de banco so deve ocorrer se aprovada por humano e com impacto operacional entendido. Preferir rollback de pacote quando a migration aplicada foi aditiva.

## Segredos

O `.env` real não entra no pacote e não deve ser sobrescrito durante rollback.

## Abort Conditions

Acionar rollback se:

- inbound/outbound basico falhar;
- ticket nao for criado;
- entidade/memoria falhar;
- reabertura com motivo falhar;
- Contratos/Horas falhar;
- Console ou Dashboard ficarem indisponiveis;
- segredo aparecer em UI/log;
- IA aparecer ativa para cliente;
- Webhook Guard falhar.
