# Condicoes de Abort e No-Go

Qualquer item abaixo bloqueia promocao ou exige rollback manual.

## Pacote

- `package_manifest.json` ausente.
- `package_incomplete`.
- `runtime_mismatch`.
- Arquivos `??` inesperados no dev local.
- Pacote contem `.env`, dump, backup, `.ovpn`, certificado privado, token ou senha.

## Ambiente

- Backup incompleto.
- Cloud executando versao antiga apos troca de pacote.
- OPcache/cache nao reiniciado quando necessario.
- Node nao reinicia.
- Diagnostico Operacional inacessivel para supervisor/admin.

## Banco/Migration

- Migration sem aprovacao humana.
- Migration nao aditiva.
- Necessidade de SQL destrutivo.
- Schema essencial ausente apos migration.
- Qualquer pedido de update manual para corrigir conversa/ticket.

## Seguranca

- Segredo exibido em UI, log ou documento.
- Webhook Guard ausente ou enfraquecido.
- Meta Phone Number ID completo exposto.
- Plugin tentando editar `.env`.
- Plugin executando comando de servidor.

## Operacao

- Inbound falha.
- Outbound manual falha.
- Criacao de ticket falha.
- Entidade/memoria falha.
- Delivery status invisivel.
- Reabertura com motivo falha.
- CSAT falha.
- Contratos/Horas falha.
- Console/Dashboard inacessiveis.
- IA aparece ativa para cliente.

## Decisao

- Se ocorrer antes da promocao: abortar.
- Se ocorrer apos promocao: acionar rollback.
- Registrar evidencia, horario, build_id, package_id e responsavel.
