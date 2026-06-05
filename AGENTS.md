# AGENTS.md — IntegraGLPI
# Papel: IMPLEMENTADOR  |  Tokens: respostas compactas (ver §8)

## §1 Papel do Codex

**Implementador cirúrgico.** Aplica patches mínimos conforme prompt aprovado.
Não toma decisão arquitetural nova. Não cria abstração sem escopo.
Entrega diff + validações executadas.

---

## §2 Projeto

GLPI 11 + WhatsApp Cloud API + IA local (Ollama `aya-expanse:8b`).

| Camada | Stack | Papel |
|---|---|---|
| `integaglpi/` | PHP | Plugin — UI, Central, aba ticket, hooks, config, permissões |
| `integration-service/` | TypeScript/Node.js | Meta API, FSM inbound/outbound, IA, jobs assíncronos |
| PostgreSQL | SQL | conversations, messages, routing, runtime, alertas IA |
| GLPI / MariaDB | SQL | tickets, grupos, técnicos, perfis (Node nunca acessa diretamente) |

**Nunca alterar core do GLPI. Node nunca acessa MariaDB/GLPI diretamente.**

---

## §3 Acesso HML (SSH)

```
Host    : etica.inf.br (externo, sem VPN — preferir) ou 10.8.0.1 (interno)
Porta   : 43422  |  Usuário: azureuser
Chave   : D:\.ssh\codex_integaglpi_hml_ed25519  (ED25519 — nunca ler/imprimir)
Contrato: docs/ssh_connection_contract.md
```

```powershell
ssh -i D:\.ssh\codex_integaglpi_hml_ed25519 -p 43422 -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 azureuser@etica.inf.br "<cmd>"
```

Scripts/SQL complexos → padrão base64 (evita quebra de aspas PowerShell+SSH):
```powershell
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("script.sh"))
ssh ... "echo $b64 | base64 -d | bash"
```

- Containers HML: `glpi-integaglpi-{integration,postgres,redis}` — **NUNCA `prod-*`**
- Read-only por padrão. Mutações: somente com autorização explícita.
- AUDIT: tickets `2112319362`/`2112319363`, phone `41988334449`
- Ticket `2112319360` = cliente real — **NUNCA mutar**
- Nunca imprimir tokens, senhas, telefones de clientes, conteúdo de `.env`

---

## §4 Estado atual (2026-06-05)

- Testes: **911 passed / 109 arquivos** · `tsc --noEmit` clean
- Branch `main`, ~90 commits à frente de origin (sem push automático)
- HML: `locks=0`, `dead_letter=0`, `webhook_failed=0`, health `ok`
- RBAC SmartHelp: `canViewPanel()=Plugin::canRead()` · Ticket::can READ em kb_feedback/suggest_kb
- Modelo IA HML: `aya-expanse:8b` · timeout 120s

---

## §5 Cláusula pétrea — fluxos intocáveis

Sem escopo explícito, **nunca alterar**:
- inbound WhatsApp → Node → GLPI
- outbound GLPI → WhatsApp
- roteamento por menu / persistência de `queue_id`
- sync SOLVED/CLOSED → conversation `closed`
- Central de Atendimento validada
- PII Guard / CSRF / RBAC

---

## §6 Arquitetura oficial

### Plugin GLPI — PHP
UI, Central, aba ticket, hooks, permissões, config, integração leve com integration-service.

### Node.js — integration-service
Regras de negócio WhatsApp, FSM, webhooks Meta, integração REST GLPI, decisão inbound,
persistência de mensagens, outbound real para WhatsApp, jobs de IA.

### PostgreSQL externo
conversations · messages · routing_options · queues · conversation_runtime · alertas IA.

### GLPI / MariaDB
tickets · grupos · técnicos · perfis · permissões (lido via API REST pelo Node).

---

## §7 ABSOLUTE_FORBIDDEN

```
commit/push/deploy automático    | migration em prod sem gate manual
alterar .env versionado          | expor tokens/secrets/API keys
DROP/TRUNCATE/DELETE amplo       | docker system prune
alterar core GLPI                | Node acessar MariaDB diretamente
IA enviar WhatsApp automático    | IA alterar ticket automaticamente
KB autopublish                   | cloud sem consentimento + PII Guard
criar ranking punitivo de técnicos
```

---

## §8 Validações obrigatórias antes de entregar

```bash
# PHP (mostrar só erros — omitir "No syntax errors")
find integaglpi -name "*.php" -not -path "*/vendor/*" -print0 | xargs -0 -n1 php -l 2>&1 | grep -v "^No syntax"

# Node
cd integration-service && npx tsc --noEmit
cd integration-service && npx vitest run --reporter=dot 2>&1 | grep -E "Test Files|Tests"

# Git
git diff --check && git status --short
```

---

## §9 Token economy — formato de saída

**Operação rotineira** (commit, lint, test, SSH read-only): máximo 6 linhas.
```
✓ lint · tsc · 911/109 vitest · whitespace clean
commit abc1234 — "mensagem"
```

**Implementação de fase**: diff resumido + arquivos alterados + resultado de validações.

Regras:
- Sem preâmbulo ("Vou...", "Deixa eu verificar...", "Entendido, irei...")
- Não repetir regras de segurança se não foram violadas
- Não listar "No syntax errors" por arquivo — só erros
- Não resumir em parágrafo o que acabou de ser feito
- "faça X" → fazer X direto
