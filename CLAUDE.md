# CLAUDE.md — IntegraGLPI

> Contrato completo: `docs/prompt_contract.md`
> Leia antes de qualquer tarefa.

---

## IDENTIDADE DO PROJETO

Integração GLPI 11 + WhatsApp Cloud API + IA local.

| Pasta | Stack | Responsabilidade |
|---|---|---|
| `integaglpi/` | PHP | Plugin GLPI — UI, Central, hooks, config |
| `integration-service/` | TypeScript/Node.js | Webhooks Meta, FSM, IA, outbound, jobs |
| `infra/` | Docker + SQL | Bootstrap, PostgreSQL schema, migrations |

---

## MODO PADRÃO: CONSULTA_PRELIMINAR

Antes de alterar qualquer arquivo:
1. `git status --short` + `git diff --name-only`
2. Localizar arquivos com `rg`/`Grep` — não abrir repositório inteiro
3. Ler trechos mínimos (limite: 8 arquivos / 800 linhas totais)
4. Propor hipótese + allowlist + riscos
5. **Aguardar autorização para implementar**

---

## AMBIENTES

| Ambiente | Service URL | Postgres | Redis |
|---|---|---|---|
| Teste/Homologação | `http://127.0.0.1:3001` | `:5432` | `:6380` |
| Produção | `http://127.0.0.1:3002` | `:5433` | dedicado |

**Produção: NUNCA alterar automaticamente.**

---

## ACESSO SSH — SERVIDOR HML

> Contrato completo: `docs/ssh_connection_contract.md`

```
Host externo : etica.inf.br        (funciona fora da VPN — preferir este)
Host interno : 10.8.0.1            (apenas via VPN)
Porta        : 43422
Usuário      : azureuser
Chave        : D:\.ssh\codex_integaglpi_hml_ed25519  (ED25519 — nunca ler/imprimir)
Host real    : GLPIv5
```

**Comando padrão (PowerShell):**
```powershell
ssh -i D:\.ssh\codex_integaglpi_hml_ed25519 -p 43422 -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 azureuser@etica.inf.br "<comando>"
```

**Regras obrigatórias:**
- Apenas containers HML: `glpi-integaglpi-{integration,postgres,redis}` — NUNCA `prod-*`
- Operações read-only por padrão (SELECT, SCAN, docker logs, curl GET)
- Usar padrão **base64** para scripts/SQL complexos (PowerShell + SSH quebra aspas)
- Nunca imprimir tokens, senhas, telefones de clientes
- Dados de teste autorizados: tickets `2112319362`/`2112319363`, phone `41988334449`
- Ticket real `2112319360` = cliente real — **NUNCA mutar**

---

## ABSOLUTE_FORBIDDEN (resumo)

- Commit/push automático · Deploy automático · Migration em produção sem confirmação
- Alterar `.env` · Expor tokens/secrets/API keys · Salvar segredo em banco
- `DROP` / `TRUNCATE` / `DELETE` amplo · `docker system prune -a`
- Alterar GLPI core · Mutar ticket/status automaticamente
- Enviar WhatsApp fora de fluxo aprovado · IA responder cliente sozinha
- Publicar KB automaticamente · Habilitar cloud por padrão
- Persistir prompt bruto · Criar ranking punitivo de técnicos
- Misturar com AI-ENGINEER ou Mini CRM

---

## SAFETY FLAGS SEMPRE ATIVOS

```
single_project_only | consultation_first | token_economy_required
reuse_existing_code | allowlist_required | manual_deploy_required
manual_commit_required | cursor_review_required | production_protected
no_env_exposure | no_secret_exposure | no_auto_whatsapp_send
no_ticket_auto_mutation | no_kb_auto_publish | no_cloud_default
no_sql_destructive | no_raw_prompt | pii_masking_required
```

---

## CLASSIFICAÇÃO DE TAREFAS

| Tipo | Descrição |
|---|---|
| `CONSULTA_PRELIMINAR` | Diagnóstico, análise, plano — não altera arquivos |
| `IMPLEMENTACAO` | Altera código — exige allowlist explícita |
| `REVISAO` | Audita diff — retorna CLOSE / FIX / BLOCK |
| `OPERACAO` | Comandos servidor/Docker/banco — priorizar read-only |
| `DOCUMENTACAO` | Runbooks, matrizes — não altera código |
| `HOTFIX` | Correção urgente — escopo mínimo obrigatório |

---

## REGRA FINAL

```
segurança > velocidade
reuso > nova implementação
resposta objetiva > prosa longa
dúvida sobre produção → parar e pedir confirmação
```

---

## TESTES PADRÃO

```bash
git status --short && git diff --name-only && git diff --check
php -l <arquivo.php>
cd integration-service && npx tsc --noEmit
cd integration-service && npm test
curl -s http://127.0.0.1:3001/health
```
