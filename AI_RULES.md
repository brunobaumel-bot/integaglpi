# AI_RULES.md — IntegraGLPI
# Regras de comportamento de todas as IAs · Atualizado 2026-06-05

---

## §1 Regra de ouro

**Se algo funcionava antes, deve continuar funcionando depois.**
Nenhuma IA refatora, "melhora" ou reorganiza código validado sem escopo explícito.
Alteração estética nunca justifica regressão.

---

## §2 Papéis por ferramenta

| IA | Papel | Faz | Não faz |
|---|---|---|---|
| **ChatGPT / Gemini** | Estratégia + prompts | roadmap, divisão de fases, prompts seguros, consolidação de retornos | código no repositório |
| **Claude (Code)** | Executor + analisador | analisa arquivos reais, propõe abordagem, executa com escopo, diagnostica causa raiz | inventar contexto, refatorar sem escopo |
| **Codex** | Implementador | patches mínimos, diff, validações (ver AGENTS.md) | decisão arquitetural, abstração nova, alterar fora do escopo |
| **Cursor** | Revisor / validador | revisão de plano e diff, validação de escopo, checklist de regressão (ver .cursorrules) | decidir arquitetura, ampliar escopo |

---

## §3 Acesso HML (SSH) — todos devem conhecer

```
Host    : etica.inf.br (externo, sem VPN) ou 10.8.0.1 (interno)
Porta   : 43422  |  Usuário: azureuser
Chave   : D:\.ssh\codex_integaglpi_hml_ed25519  (nunca ler/imprimir conteúdo)
Contrato completo: docs/ssh_connection_contract.md
```

- Containers HML: `glpi-integaglpi-{integration,postgres,redis}` — **NUNCA `prod-*`**
- Read-only por padrão. Scripts complexos: padrão base64.
- AUDIT: tickets `2112319362`/`2112319363`, phone `41988334449`; ticket `2112319360` = NUNCA mutar

---

## §4 Baseline que nenhuma IA pode quebrar

**Estado atual (2026-06-05):** 911 testes / 109 arquivos · tsc clean · HML ok

Fluxos validados e intocáveis:
- inbound WhatsApp → Node → GLPI
- outbound GLPI → WhatsApp
- roteamento por menu / queue_id / glpi_group_id
- sync SOLVED/CLOSED → conversation/runtime `closed`
- Central lista, filtra, pagina, claim, reply
- PII Guard / CSRF / RBAC (SmartHelp: Plugin::canRead, Ticket::can READ)

Premissas técnicas:
- `assigned_user_id` (não `claimed_by`) para técnico atual
- `claimed_at` somente para claim; reply não altera
- Toda ação mutável valida `conversation_id + ticket_id`
- Reply: só quem tem `runtime.assigned_user_id == usuário logado`

---

## §5 ABSOLUTE_FORBIDDEN (todas as IAs)

```
commit/push/deploy automático    | migration em prod sem gate manual
alterar .env versionado          | expor tokens/secrets
DROP/TRUNCATE/DELETE amplo       | alterar core GLPI
Node acessar MariaDB diretamente | IA enviar WhatsApp automático
IA alterar ticket                | KB autopublish
cloud sem consentimento+PII Guard| ranking punitivo de técnicos
```

---

## §6 Arquivos proibidos sem autorização explícita

Core GLPI, `InboundWebhookService.ts`, `OutboundMessageService.ts`, `GlpiClient.ts`,
`hook.php`, `TicketSyncService.php`, schema/migrations, `.env`.

---

## §7 Regra de conflito

Conflito entre prompt / AGENTS.md / AI_RULES.md / código real / orientação do usuário:
1. **Não implementar**
2. Apontar o conflito
3. Aguardar decisão

---

## §8 Critério mínimo de aceite

Nenhum "terminei" aceito sem:
1. Arquivos alterados listados (diff mínimo)
2. Arquivos proibidos não tocados
3. `php -l` nos PHP alterados (só erros, não "No syntax errors")
4. `tsc --noEmit` + `vitest run` se Node alterado
5. `git diff --check` · `git status --short`
6. inbound / outbound / sync SOLVED/CLOSED preservados
7. Logs sem PII/token

---

## §9 Token economy — regras para todas as IAs

**Resposta rotineira:** máximo 6–10 linhas. Sem preâmbulo.
**Fase formal:** output schema quando explicitamente solicitado.

```
✓ = "✓ lint · tsc · 911/109 · clean"  (não listar cada arquivo)
✗ = mostrar só o erro, sem contexto extra
commit = hash + mensagem  (sem parágrafo de explicação)
```

Proibido em qualquer resposta:
- "Vou...", "Deixa eu...", "Entendido, irei...", "Claro, vou..."
- Repetir regras de segurança que não foram violadas
- Resumir em parágrafo o que acabou de ser executado
- "No syntax errors detected" por arquivo em lint limpo

**Se o usuário diz "faça X" → fazer X.** Sem cerimônia.

---

## §10 Quando parar e pedir confirmação

- Precisa alterar schema / migration
- Precisa alterar Node em fase PHP-only
- Precisa tocar hook/sync fora do escopo
- Encontra divergência entre prompt e código real
- Uma regra deste arquivo ou AGENTS.md impede o escopo pedido
- Qualquer dúvida sobre produção
