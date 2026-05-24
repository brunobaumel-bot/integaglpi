# Checklist de Homologacao IA V4.1

Preflight:
- Workspace revisado por Cursor.
- Migrations aplicadas somente em TESTE.
- Backup e rollback documentados.
- `.env` real nao alterado por automacao.
- Produção intocada.

Flags:
- Cloud disabled.
- Embeddings disabled.
- Provider disabled quando nao houver gate aprovado.
- Dry-run ativo nas fases que suportam.
- Director, DPO, admin opt-in e incident ack false por padrao.

Validacao funcional:
- P1 analise manual com KB nativa.
- P2 CLI offline com dataset sanitizado.
- P3 candidatos revisaveis sem auto publish.
- P4 dashboard read-only.
- P5 rascunho editavel sem auto send.
- P6 score read-only sem alterar status/prioridade.
- P7 bloqueio de cloud por default.
- P8 coaching anti-punitivo.
- P9 preview obrigatório e fontes allowlist.

Validacao de seguranca:
- CSRF em POST.
- Permissoes de supervisor/admin onde aplicavel.
- Escape/XSS em templates.
- Sem texto bruto, anexos, midia, token ou segredo.
- Auditoria com `source` explicito.

