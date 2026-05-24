# Rollback Playbook IA V4.1

Ordem preferencial de rollback:
1. Desabilitar feature flags ou manter provider `disabled`.
2. Reverter codigo do plugin/integration-service para release anterior.
3. Reiniciar servicos de TESTE/HOMOLOGACAO.
4. Validar inbound, outbound, roteamento, Central e sync SOLVED/CLOSED.
5. Manter migrations aditivas sem drop; neutralizar por flags e codigo.

Regras de banco:
- Nao executar `DROP`, `TRUNCATE` ou `DELETE` sem autorizacao formal.
- Migrations IA sao aditivas; rollback operacional deve ser por desativacao.
- Retencao ou limpeza, se necessaria, deve ser manual e com dry-run.

Checks pos-rollback:
- Webhook responde sem chamar IA.
- Outbound manual continua funcionando.
- Ticket nao recebe mutacao por IA.
- KB nativa nao recebe escrita automatica.
- Auditoria continua gravando source explicito.

Comunicacao:
- Registrar motivo, hash do release, horario e responsavel.
- Se houver incidente de dados, seguir playbook LGPD antes de novas tentativas.

