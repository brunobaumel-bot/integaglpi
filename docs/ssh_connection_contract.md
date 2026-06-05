# Contrato de Acesso SSH — Servidor HML IntegraGLPI

> **Versão:** 1.0  
> **Data:** 2026-06-05  
> **Validado em:** conexão externa via `etica.inf.br` (fora de VPN)  
> **Ambiente alvo:** HOMOLOGAÇÃO — nunca produção

---

## 1. Parâmetros de Conexão

| Parâmetro          | Valor                                          |
|--------------------|------------------------------------------------|
| **Host externo**   | `etica.inf.br`                                 |
| **Host interno**   | `10.8.0.1` (via VPN)                           |
| **Porta**          | `43422`                                        |
| **Usuário**        | `azureuser`                                    |
| **Chave privada**  | `D:\.ssh\codex_integaglpi_hml_ed25519`         |
| **Tipo de chave**  | ED25519                                        |
| **Host verificado**| `GLPIv5` (hostname retornado pelo servidor)    |

> **A chave privada nunca é lida, impressa, transmitida ou armazenada além do arquivo local.**  
> Apenas o caminho (`-i`) é referenciado nos comandos.

---

## 2. Comando de Conexão de Referência

```powershell
ssh -i D:\.ssh\codex_integaglpi_hml_ed25519 `
    -p 43422 `
    -o StrictHostKeyChecking=accept-new `
    -o ConnectTimeout=15 `
    azureuser@etica.inf.br `
    "<comando remoto>"
```

`StrictHostKeyChecking=accept-new` aceita automaticamente a host key na primeira conexão, sem prompt interativo — essencial para automação.

---

## 3. Containers HML (únicos alvos permitidos)

| Container                        | Papel                     |
|----------------------------------|---------------------------|
| `glpi-integaglpi-integration`    | Node.js / integration-service |
| `glpi-integaglpi-postgres`       | PostgreSQL HML            |
| `glpi-integaglpi-redis`          | Redis HML                 |

> ⛔ **PROIBIDO** referenciar ou executar comandos em qualquer container `glpi-integaglpi-prod-*`.

---

## 4. Padrão Base64 para Comandos Complexos

PowerShell + SSH + Bash remoto quebram com aspas, parênteses e `&&`.  
**Padrão recomendado** — escrever script localmente, codificar em base64 e decodificar no host:

```powershell
# Script shell
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\caminho\script.sh"))
ssh -i D:\.ssh\codex_integaglpi_hml_ed25519 -p 43422 azureuser@etica.inf.br `
    "echo $b64 | base64 -d | bash"

# SQL read-only
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\caminho\query.sql"))
ssh -i D:\.ssh\codex_integaglpi_hml_ed25519 -p 43422 azureuser@etica.inf.br `
    "echo $b64 | base64 -d | docker exec -i glpi-integaglpi-postgres psql -U glpi_integaglpi -d glpi_integaglpi -A -F '|'"
```

---

## 5. Atalhos Read-Only Validados

```bash
# Health do integration-service
curl -sS http://127.0.0.1:3001/health

# Identidade Postgres
docker exec glpi-integaglpi-postgres \
    psql -U glpi_integaglpi -d glpi_integaglpi -Atc 'select current_database(), now();'

# Redis — contagem de locks
docker exec glpi-integaglpi-redis redis-cli --scan --pattern '*lock*' | wc -l

# Redis — dead-letter
docker exec glpi-integaglpi-redis redis-cli --scan --pattern '*dead*' | wc -l

# Redis — tamanho do banco
docker exec glpi-integaglpi-redis redis-cli dbsize

# Logs do integration-service (últimos 15 min)
docker logs --since 15m glpi-integaglpi-integration 2>&1 | tail -n 120
```

---

## 6. Política de Uso

### 6.1 Permitido

| Operação                        | Detalhe                                              |
|---------------------------------|------------------------------------------------------|
| `SELECT` no Postgres HML        | Apenas leitura; sem `DELETE/TRUNCATE/DROP`           |
| `INFO/SCAN/GET/TTL/DBSIZE` Redis| Apenas leitura; sem `FLUSHDB/DEL`                    |
| `docker logs`                   | Somente containers HML listados na seção 3           |
| `curl` para `:3001/health`      | Health check e endpoints internos de leitura         |
| GLPI API `GET`                  | Apenas endpoints de leitura (`/search`, `/getItem`)  |
| Scripts shell read-only         | Via padrão base64; sem mutações de arquivo ou SO     |

### 6.2 Proibido

| Operação                        | Motivo                                               |
|---------------------------------|------------------------------------------------------|
| Tocar `glpi-integaglpi-prod-*`  | Produção — NUNCA alvo                                |
| `SQL` destrutivo                | `DELETE / TRUNCATE / DROP / UPDATE` não autorizado   |
| Alterar `.env` versionado       | Controle de configuração exclusivo do operador       |
| Executar ou reverter migrations | Exige gate manual do operador                        |
| Imprimir/ecoar tokens/senhas    | Secrets permanecem ocultos; `.env` não é lido        |
| Mensagens WhatsApp automáticas  | Apenas número autorizado `41988334449`, com aprovação|
| Mutações em ticket de cliente real | Ticket `2112319360` e similares são intocáveis    |
| `git push` / deploy / promoção  | Requer gate manual explícito                         |
| Iniciar/parar containers        | Operação reservada ao operador HML                   |

### 6.3 Dados de Teste Autorizados

```yaml
authorized_phone: "41988334449"
audit_entity_id: 237
audit_group_or_queue_id: 9
technician_a_id: 809
technician_b_id: 810
audit_ticket_id: 2112319362
audit_manual_ticket_id: 2112319363
# Ticket real de cliente — NUNCA usar para mutações:
real_ticket_forbidden: 2112319360
```

---

## 7. Segurança de Credenciais

| Item                      | Regra                                                        |
|---------------------------|--------------------------------------------------------------|
| Chave privada SSH         | Nunca lida, nunca impressa, nunca transmitida                |
| Credenciais GLPI UI       | Em `/home/azureuser/projeto/.runtime/audit/glpi_hml_ui.env` (perms 600) — uso interno, nunca ecoado |
| Tokens / API keys         | Nunca impressos em logs ou saída de comandos                 |
| Telefones de clientes     | Jamais exibidos; mascarar em qualquer grep/log               |
| Arquivo `.env`            | Nunca abrido, nunca alterado por automação                   |

---

## 8. Referências do Projeto no Host

```
/home/azureuser/projeto/
├── integaglpi/            ← plugin GLPI PHP
├── integration-service/   ← Node.js / TypeScript
├── infra/                 ← Docker, SQL, migrations
├── docs/                  ← documentação
├── docker-compose.dev.yml ← stack HML
└── .runtime/audit/        ← credenciais e artefatos de auditoria (600)
```

---

## 9. Resultado da Validação Inicial (2026-06-05)

```
Host externo : etica.inf.br:43422
Hostname     : GLPIv5
Usuário      : azureuser
Containers   : glpi-integaglpi-{integration,postgres,redis} UP
Health       : ok=true | postgres ok | redis configured | version 0.1.0
Redis locks  : 0
Dead-letter  : 0
Prod         : glpi-integaglpi-prod-* presentes e IGNORADOS
```

> Conexão confirmada **fora da VPN** via `etica.inf.br`, porta `43422`, chave ED25519.

---

## 10. Escopo do Acesso por Ambiente

| Ambiente       | Acesso permitido | Mutações | Notas                        |
|----------------|-----------------|----------|------------------------------|
| HML (`dev-*`)  | ✅ Sim           | Com gate | Apenas dados AUDIT-*          |
| Produção (`prod-*`) | ⛔ Nunca   | ⛔ Nunca | Containers ignorados ativamente |
