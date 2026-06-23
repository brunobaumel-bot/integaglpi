# V10 Shadow Replay Lab — G15 Curated Sample Pack

PHASE: `integaglpi_v10_shadow_replay_lab_g15_curated_sample_pack_001`
Status: `IMPLEMENTED_PENDING_CURSOR_REVIEW`
Data: 2026-06-23
Base: `b4d0e3edac24dbef43f556e935409585baf1209a` (origin/main G2–G8 merged)

---

## Escopo

Pacote curado de amostras sanitizadas para o Shadow Replay Lab, com:

- 10 envelopes sintéticos G6 (8 válidos + 2 inválidos esperados);
- manifesto de expectativas para validação determinística;
- validador CLI manual (sem DB, sem rede, sem dotenv);
- TypeScript puro para lógica de validação (sem adapters operacionais);
- testes unitários/contratuais.

O pacote cobre as 8 categorias de chamado mais comuns em ambiente HML:
VPN, acesso remoto, senha/login, impressora, rede sem internet, lentidão, e-mail e erro de sistema.

---

## Arquivos produzidos

| Arquivo | Tipo |
|---|---|
| `integration-service/shadow-replay-samples/curated-v1/samples.sanitized.jsonl` | pacote JSONL curado |
| `integration-service/shadow-replay-samples/curated-v1/expected-manifest.json` | manifesto de expectativas |
| `integration-service/shadow-replay-samples/curated-v1/README.md` | instruções do pacote |
| `integration-service/src/shadowReplay/ShadowReplaySamplePackValidator.ts` | validador TypeScript puro |
| `integration-service/scripts/v10ShadowReplayValidateSamplePack.mjs` | CLI validador manual |
| `integration-service/scripts/v10ShadowReplayGenerateSamplePack.mjs` | gerador do pacote (dev) |
| `integration-service/tests/v10ShadowReplaySamplePackValidator.test.ts` | testes unitários/contratuais |
| `docs/v10_shadow_replay_lab_g15_curated_sample_pack.md` | este documento |
| `docs/v10_status_ledger.md` | ledger atualizado |

---

## Formato do pacote

Cada linha do JSONL é um `ShadowReplaySampleEnvelope` G6 sanitizado (`schema_version: g6_sample_envelope_v1`).

Samples válidos: `source_ref_hash` de 64 hex chars, sem chaves `raw_payload`/`messages`/`transcript`, sem `source_ref` cru, sem PII residual.

Samples inválidos (esperados e documentados no manifesto):
1. Linha 9: contém `raw_payload` → rejeitado com código `raw_key_forbidden`
2. Linha 10: contém `source_ref: 'raw-ticket-chamado-ref-12345'` → rejeitado com `source_ref_not_hash`

---

## Manifesto de expectativas

```json
{
  "schema_version": "g15_curated_sample_pack_v1",
  "pack_name": "curated-v1",
  "total_lines": 10,
  "expected_valid": 8,
  "expected_rejected": 2,
  "rejection_codes": ["raw_key_forbidden", "source_ref_not_hash"],
  "categories_covered": [
    "email_issue", "network_no_internet", "password_login", "printer",
    "remote_access", "slow_performance", "system_error", "vpn"
  ]
}
```

---

## Validador CLI

Pré-requisito:

```bash
cd integration-service
npx tsc -p tsconfig.shadow-replay.json
```

Execução:

```bash
node scripts/v10ShadowReplayValidateSamplePack.mjs \
  --input shadow-replay-samples/curated-v1/samples.sanitized.jsonl \
  --expect shadow-replay-samples/curated-v1/expected-manifest.json \
  --format json
```

Opções:
- `--input <file.jsonl>`: obrigatório. Caminho do JSONL relativo à raiz do pacote.
- `--expect <manifest.json>`: obrigatório. Manifesto de expectativas JSON.
- `--format json|markdown`: formato de saída (padrão: json).

Exit code `0` = PASS (`manifest_match && !pii_detected`). Exit code `1` = FAIL ou erro.

O CLI não carrega `.env`, não acessa banco de dados, não faz chamadas de rede e não importa adapters operacionais.

---

## Gerador

Para regenerar o pacote após mudanças no sanitizador G6:

```bash
cd integration-service
npx tsc -p tsconfig.shadow-replay.json
node scripts/v10ShadowReplayGenerateSamplePack.mjs
```

O gerador usa `createShadowReplaySampleEnvelope()` do G6 para garantir hashes e sanitização corretos. Os dois samples inválidos são gerados como objetos brutos propositalmente.

---

## Validação local

```bash
cd integration-service
npx tsc --noEmit
npx tsc -p tsconfig.shadow-replay.json --noEmit
npx vitest run tests/v10ShadowReplaySamplePackValidator.test.ts --reporter=dot
node scripts/v10ShadowReplayValidateSamplePack.mjs \
  --input shadow-replay-samples/curated-v1/samples.sanitized.jsonl \
  --expect shadow-replay-samples/curated-v1/expected-manifest.json
```

Resultado esperado: `tsc` limpo; 20/20 testes PASS; CLI exit 0 com `manifest_match: true`.

---

## Cobertura de testes

- Pacote curado validado contra o manifesto real;
- Todas as 8 categorias encontradas;
- `raw_payload` → `raw_key_forbidden`;
- `messages`/`transcript` → `raw_key_forbidden`;
- `source_ref` cru → `source_ref_not_hash`;
- PII residual → `pii_detected: true` + não ecoado na saída;
- JSON inválido → `invalid_json`;
- Divergência de `total_lines` → `manifest_mismatch`;
- Categoria ausente → `manifest_mismatch`;
- Código de rejeição ausente → `manifest_mismatch`;
- Múltiplos envelopes com múltiplas categorias;
- Serialização JSON e Markdown;
- Isolamento de source (sem DB, Redis, HTTP, GLPI, Meta, IA).

---

## Gates preservados

- `shadow_replay_runtime_allowed=false`
- `production_release_allowed=false`
- sem worker/cron/runtime
- sem `app.ts`
- sem migration/schema
- sem deploy
- sem produção
- sem DB (validador é file-only)
- sem PII nos samples válidos
