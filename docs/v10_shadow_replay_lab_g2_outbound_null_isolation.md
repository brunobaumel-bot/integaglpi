# V10 Shadow Replay Lab — G2 Outbound-Null Isolation

PHASE: `integaglpi_v10_shadow_replay_lab_g2_outbound_null_isolation_001`
Status: **IMPLEMENTED_LOCAL_PENDING_CURSOR** (G2 ainda `IMPLEMENTED_NOT_HML_PROVEN`)
Data: 2026-06-22

> Cria um perfil de build/runtime dedicado, **incapaz por construção** de qualquer side-effect
> externo. Sem deploy HML, sem commit nesta fase, sem Shadow Store/migration/ingest.

---

## 1. Inventário de side-effects (matriz)

| Categoria | Adapter/serviço real (read-only ref) | Composition real | Credencial/env | Efeito | Null adapter G2 | Teste |
|---|---|---|---|---|---|---|
| WhatsApp/Meta | Meta client + outbound orchestrator | operacional | `META_*`/`WHATSAPP_*` | envio WhatsApp | `whatsapp.sendText/sendTemplate` | ✅ |
| E-mail | notificação/SMTP | operacional | `SMTP_*`/`EMAIL_*` | envio e-mail | `email.send` | ✅ |
| LogMeIn | LogMeIn engine | operacional | `LOGMEIN_*` | chamada LogMeIn | `logmein.call` | ✅ |
| GLPI mutation | GLPI client | operacional | `GLPI_API_*` | create/update/follow-up | `glpiMutation.{createTicket,updateTicket,addFollowup}` | ✅ |
| Cloud AI / external research | external research/cloud client | operacional | `OPENAI_*`/`ANTHROPIC_*`/`AZURE_OPENAI_*`/`GEMINI_*` | inferência cloud | `cloudAi.{complete,research}` | ✅ |
| Ação externa genérica | HTTP externo / publisher | operacional | vários | I/O externo | `externalAction.execute` | ✅ |

Todos os adapters reais permanecem **somente leitura** (não importados pelo perfil G2). Não foi
encontrado side-effect sem interface isolável → sem BLOCK.

---

## 2. Arquitetura separada (por construção, não por flag)

```
src/shadowReplay/                      dist-shadow-replay/        imagem Docker dedicada
 ├─ ShadowReplayIsolationPolicy.ts      (build isolado, só          (Dockerfile.shadow-replay)
 ├─ ShadowReplayNullOutboundBoundary.ts  estes módulos)             multi-stage, non-root,
 ├─ ShadowReplayIsolationComposition.ts                              read-only, cap_drop ALL,
 ├─ ShadowReplayIsolationSelfTest.ts                                 sem credenciais, sem portas
 └─ ShadowReplayIsolationEntry.ts
```

- **Composition root dedicado:** `ShadowReplayIsolationComposition` não importa a wiring
  operacional nem qualquer adapter real; instancia **apenas** o null outbound boundary; sem branch
  para adapter real.
- **Build separado:** `tsconfig.shadow-replay.json` (`rootDir: src/shadowReplay`,
  `outDir: dist-shadow-replay`, `removeComments: true`, `noEmitOnError: true`) compila só o subtree
  isolado. Não copia `dist/` operacional nem a árvore de fontes operacional.
- **Perfil imutável (tipos literais):** `build_profile="shadow_replay_null_outbound"`,
  `real_adapter_present=false`, `send_allowed=false`, `external_action_allowed=false`,
  `glpi_mutation_allowed=false`, `cloud_allowed=false`.

---

## 3. Null adapters

Cada operação retorna `BLOCKED_BY_SHADOW_REPLAY_ISOLATION`, com `executed=false`, `real=false`:
- **não executa I/O** (sem `fetch`/`http`/`https`/`net`/`tls`/`dns`; sem import dinâmico);
- produz apenas um **hash de descritor** em memória (`sha256("shadow_replay_null:<canal>:<op>")`);
- **nunca** persiste payload bruto; nunca instancia cliente real.

---

## 4. Kill switch fail-closed

`evaluateShadowReplayIsolationPolicy(env)` — qualquer incerteza → `ok=false`. O entrypoint encerra
**non-zero** quando bloqueado.

| Condição | Resultado |
|---|---|
| `SHADOW_LAB_MODE` ausente | bloqueia (`SHADOW_LAB_MODE_MISSING`) |
| `SHADOW_LAB_MODE` ≠ `'true'` exato (ex.: `false`, `YES`) | bloqueia |
| `NODE_ENV`/`APP_ENV` = `production` | bloqueia |
| ambiente ≠ HML/test | bloqueia |
| qualquer env banida presente | bloqueia (valor nunca lido) |

---

## 5. Env allowlist / denylist do container

**Permitidas:** `SHADOW_LAB_MODE`, `APP_ENV`, `NODE_ENV`, `LOG_LEVEL`, `TZ`.

**Banidas (prefixo):** `META_`, `WHATSAPP_`, `SMTP_`, `EMAIL_`, `LOGMEIN_`, `OPENAI_`,
`ANTHROPIC_`, `AZURE_OPENAI_`, `GEMINI_`, `GLPI_API_`.
**Banidas (exato/substring):** `INTEGRATION_SERVICE_API_KEY`, e qualquer chave contendo
`TOKEN`/`SECRET`/`PASSWORD`/`APIKEY`/`API_KEY`/`ACCESS_KEY`/`CREDENTIAL`/`PRIVATE_KEY`.

A presença de qualquer env banida faz o processo **bloquear e encerrar**; valores nunca são lidos
nem impressos (apenas a chave mascarada `X***Y`).

---

## 6. Isolamento Docker

- **Dockerfile.shadow-replay:** multi-stage; estágio final copia **apenas** `dist-shadow-replay`;
  `USER node` (non-root); sem `node_modules` (somente builtins); sem código operacional; sem `.env`;
  sem `EXPOSE`/portas.
- **docker-compose.shadow-replay.hml.yml:** serviço `shadow-replay-proof` atrás de **profile
  explícito** (não auto-start); **sem** arquivo de env injetado; só o allowlist de env; **sem portas
  publicadas**; rede `internal: true`; `read_only: true`; `user: node`; `cap_drop: [ALL]`;
  `security_opt: [no-new-privileges:true]`; `tmpfs: /tmp`; `restart: "no"`.

---

## 7. Self-test (metadata-only)

`runShadowReplaySelfTest(env)` → `ok`, `shadow_lab_mode`, `build_profile`, todos os adapters `null`,
`real_adapter_present=false`, `send_allowed=false`, `external_action_allowed=false`,
`glpi_mutation_allowed=false`, `cloud_allowed=false`, `credentials_present=false`.

---

## 8. Testes & validações

- `tsc --noEmit` (principal) PASS; `tsc -p tsconfig.shadow-replay.json` PASS.
- `v10ShadowReplayOutboundNullIsolation.test.ts` — **34/34 PASS**: kill switch (ausente/falso/inválido/produção/non-HML),
  banned env (14 chaves), adapters todos blocked, sem payload bruto, composição literal-false,
  self-test, scan de fonte (sem import operacional/adapter real/rede/fetch/import dinâmico/endpoints banidos),
  artefato compilado sem módulos operacionais, compose/Dockerfile isolados.
- Smoke `v10ShadowReplayOutboundNullIsolationSmoke.mjs` — `all_pass=true`.
- Regressão V10 (M6.1/M6.2/M5.2/M7) — 190/190 PASS.
- Compose YAML válido (parse). `docker compose config`/build local: **NOT_AVAILABLE** (Docker não instalado na estação).

---

## 9. Limitações / ressalvas

- **NOT_HML_PROVEN:** validado localmente; sem deploy/build/run no servidor HML nesta fase.
- `docker build`/`compose config` não executados (Docker ausente localmente) — validados por contrato/teste + parse YAML.
- O perfil G2 é só a base de isolamento; **não** há Shadow Store, ingest, exporter, outbox, replay
  worker, backfill ou live tee (fora de escopo, bloqueados).

---

## 10. Segurança

Implementação local apenas. Sem deploy HML, sem alteração do runtime operacional / `buildDependencies` /
webhook / adapters reais / GLPI client / plugin (`integaglpi/**` sem diff). Sem PostgreSQL/Redis,
sem migration/schema, sem Shadow Store. Sem Meta/WhatsApp/e-mail/LogMeIn/cloud/HTTP externo, sem
mutação GLPI, sem produção. Sem PII/credenciais. `audit_out/` não staged.

G2 só fica `READY` após Cursor review + commit + smoke HML. Construção Shadow Replay continua bloqueada.

---

## 11. FIX (cursor review) — 2026-06-22

### 11.1 Prova de compatibilidade type-only com os contratos reais
As seis superfícies foram reconciliadas. O inventário anterior listava **cinco** nomes de classe
para **seis** superfícies porque WhatsApp/Meta é coberto por **dois** clientes reais (MetaClient +
OutboundMessageService), enquanto **e-mail** e **ação externa genérica** **não possuem classe real
dedicada** neste código (null defensivo apenas).

| Superfície | Classe/interface real | Métodos side-effect reais | Null boundary | Prova type-only |
|---|---|---|---|---|
| WhatsApp/Meta | `MetaClient` | `sendTextMessage`/`sendTemplateMessage`/`sendDocumentMessage`/`sendImageMessage`/`sendAudioMessage`/`sendVideoMessage` | `whatsapp.sendText/sendTemplate` | `expectTypeOf<MetaClient>().toHaveProperty(...)` |
| (orquestrador) | `OutboundMessageService` | `send` | (idem WhatsApp) | `toHaveProperty('send')` |
| GLPI mutation | `GlpiClient` | `createTicket`/`createRestrictedRequesterUser` | `glpiMutation.*` | `toHaveProperty(...)` |
| Cloud/external research | `ExternalResearchService` | `researchDynamic` | `cloudAi.research/complete` | `toHaveProperty('researchDynamic')` |
| LogMeIn | `LogmeinAlarmEngineService` | `runOnce` | `logmein.call` | `toHaveProperty('runOnce')` |
| E-mail / ação externa genérica | — (sem classe dedicada) | — | `email.send` / `externalAction.execute` | null defensivo |

- A prova vive em `tests/v10ShadowReplayOutboundNullIsolation.test.ts` (`import type` + `Pick<>`/`expectTypeOf`),
  validada por **`vitest --typecheck`** (`Type Errors: no errors`). **Não** vive em `src/shadowReplay`
  porque qualquer `import type` de um módulo operacional puxaria suas dependências transitivas para o
  build isolado (`rootDir: src/shadowReplay` → TS6059), poluindo o artefato. Assim, `dist-shadow-replay`
  permanece sem qualquer módulo operacional (confirmado também na imagem Docker).
- A prova **falha no tsc** se um método real for renomeado/removido (regressão de contrato).

### 11.2 .dockerignore dedicado (deny-all + allowlist)
`integration-service/Dockerfile.shadow-replay.dockerignore` (BuildKit lê `<Dockerfile>.dockerignore`
antes do global): deny-all (`*`) + allowlist mínima (`package.json`, `tsconfig.json`,
`tsconfig.shadow-replay.json`, `src/shadowReplay`). Não endurece o `.dockerignore` global (imagem
operacional intacta). Exclui `src/adapters`, `src/domain`, `dist`, `dist-shadow-replay`, `node_modules`,
arquivos de env, testes, scripts, Dockerfiles/compose operacionais.

### 11.3 Prova Docker em HML (temp dir, sem deploy)
Build/inspeção/execução one-shot em `/tmp/integaglpi_g2_proof_<ts>/` no host HML (Docker presente),
removido ao final; containers operacionais intocados:
- `docker build` → OK (`build_rc=0`).
- `docker image inspect` → `User=[node]` (non-root), `ExposedPorts=[]` (nenhuma), entrypoint = entry isolado.
- Scan da imagem por módulos operacionais → **NONE**.
- `docker run --rm --network none -e SHADOW_LAB_MODE=true …` → `ok:true`, todos adapters `null`, exit **0**.
- `docker run --rm --network none` (sem flag) → bloqueado, exit **1**.
- `docker run --rm --network none -e META_ACCESS_TOKEN=x …` → bloqueado (`BANNED_ENV_PRESENT`), exit **1**.
- Containers operacionais (`glpi-integaglpi-*`, `prod-*`) permaneceram `Up` (não recriados).

### 11.4 Higiene de workspace
- `dist-shadow-replay/` é output gerado → **removido ao final** desta fase.
- `docs/roadmap_v10_plano_restante.md`, `.vs/`, `audit_out/` e demais untracked **não** alterados nem
  stageados (hash do roadmap idêntico antes/depois). Sem `git clean` amplo.

### 11.5 Ressalva
- **`compose config` em HML:** o host tem **apenas `docker-compose` v1.25.0** (sem plugin v2,
  pré-`profiles`); não consegue parsear o compose-spec moderno exigido (profile explícito para não
  auto-subir). Compose validado **localmente** (parse YAML + teste de contrato) e o isolamento real foi
  provado por `docker build` + `docker run --network none`. Não foi rebaixado para o formato legado v1
  porque isso removeria `profiles`/`internal`/isolamento exigidos.

---

## 12. FIX 002 (cursor review 002) — 2026-06-22

> Supersede afirmações mais fracas do §11 (prova só por `toHaveProperty`; "ignore exercitado" via
> contexto pré-minimizado; hash do roadmap como prova de escopo). Evidência real abaixo.

### 12.1 Substituibilidade real (assinatura integral)
Os null boundaries deixaram de ser interfaces paralelas — são **classes de adapter** com os mesmos
nomes de método dos contratos reais e assinaturas estruturalmente compatíveis; cada método **sempre
bloqueia** retornando `Promise<never>` que **rejeita** com `ShadowReplayBlockedError`
(`code = BLOCKED_BY_SHADOW_REPLAY_ISOLATION`), sem I/O e sem payload bruto (só hash de descritor).
Prova **type-only de assinatura integral** (vitest `--typecheck` → `no errors`) via **atribuição** a
`Pick<>` do contrato real (não `toHaveProperty`):
`Pick<MetaClient,'sendTextMessage'|...> = new ShadowReplayNullMetaAdapter()`, idem
`OutboundMessageService.send`, `GlpiClient.createTicket|createRestrictedRequesterUser`,
`ExternalResearchService.researchDynamic`, `LogmeinAlarmEngineService.runOnce`. `tsc` falha se a
assinatura real mudar. **E-mail** e **ação externa genérica** = `DEFENSIVE_NULL_SURFACE_NO_REAL_PORT`
(sem classe real dedicada; null defensivo). Bloqueio em runtime testado (rejeição com o code esperado).

### 12.2 Build reproduzível por lockfile
Dockerfile builder: `COPY package.json package-lock.json` + `npm ci --ignore-scripts --no-audit
--no-fund` (sem `npm install typescript@5`); TypeScript vem do lockfile. Imagem final non-root, só
`dist-shadow-replay`, sem source/tests/docs/.env/node_modules (`img_has_node_modules=no`).

### 12.3 Dockerfile-specific ignore exercitado em CONTEXTO COMPLETO (canary audit)
Contexto completo (107 arquivos de `src/domain`+`src/adapters`) + 5 canários (`.env.shadow_ignore_probe`,
`docs/`, `tests/`, `src/domain/`, `dist-shadow-replay/`, sem segredo). Aplicando o conteúdo do ignore
dedicado, o contexto recebido pelo daemon foi APENAS: `Dockerfile.shadow-replay`, `package.json`,
`package-lock.json`, `tsconfig.json`, `tsconfig.shadow-replay.json`, `src/shadowReplay/*` (5).
**`leaked_forbidden=0`** — nenhum canário/source operacional/.env/docs/tests/dist chegou. Contexto NÃO
pré-minimizado: era completo e o ignore filtrou.

### 12.4 Ressalva — BuildKit/buildx ausente no HML
Daemon HML: BuildKit habilitado mas `buildx` ausente/quebrado → a **nomeação** `<Dockerfile>.dockerignore`
(recurso BuildKit) **não é exercitável como-nomeada** no HML. O arquivo per-Dockerfile está correto
(para consumidores BuildKit/CI); seu **conteúdo** foi provado contra o contexto completo via builder
clássico, aplicado como `.dockerignore` em diretório temporário descartável (sem alterar o `.dockerignore`
global/operacional).

### 12.5 Build/run real (HML, full context, npm ci)
`build_rc=0`; `User=[node]`, `ExposedPorts=[]`, entrypoint isolado; `img_canary_operational_count=0`;
sem node_modules. Run matrix endurecido (`--network none --read-only --cap-drop ALL --security-opt
no-new-privileges --tmpfs /tmp`): safe `ok:true`/`all_operations_blocked` exit 0; missing/invalid/
production/banned exit 1. Containers operacionais intocados; imagem/temp removidos.

### 12.6 Runbook oficial HML (sem compose up)
HML tem `docker-compose` v1.25 (não valida compose-spec moderno) e sem buildx → **runbook oficial G2**
é o `docker run` endurecido one-shot acima. Compose moderno = artefato futuro/CI;
`compose_config_status = NOT_VALIDATABLE` no HML.

### 12.7 Workspace / status
- G2 alterado só nos arquivos da allowlist; worktree detached do HEAD usado para gerar o contexto
  completo limpo; `roadmap`, `.vs`, `audit_out` não alterados/stageados; `dist-shadow-replay/` removido.
- **G2 = `FIXED_PENDING_CURSOR_003`**; `g2_outbound_null_ready=false`; `shadow_replay_construction_allowed=false`.

---

## 13. FIX 003 (cursor review 003) — 2026-06-22

> Resolve os dois bloqueadores objetivos restantes (lockfile não versionado; compatibilidade de
> assinatura sem parâmetros/retorno exatos). Sem exagerar evidências.

### 13.1 Lockfile versionado (reprodutibilidade)
`integration-service/package-lock.json` estava ignorado (`.gitignore:7`). Adicionada exceção
**escopada** após a regra: `!integration-service/package-lock.json` (outros lockfiles — root
`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` — permanecem ignorados).
- `git check-ignore integration-service/package-lock.json` → **não ignorado**; aparece como candidato `??`.
- lockfile `lockfileVersion: 3`; sha256 `4ad178ac6b0dfaa175493b645e83750e43e0f501ec391df4924b6b756a05b600`.
- scan: sem token de auth/senha/URL-com-credencial/dependência local (`file:`/`link:`/`git+ssh`)/`localhost`/caminho absoluto;
  registry único `registry.npmjs.org`.
- O lockfile **será incluído no mesmo commit G2** (ainda **não** commitado nesta fase).

### 13.2 Reprodutibilidade por árvore candidata limpa
Árvore Git candidata montada via **alternate index** (índice principal permanece vazio), sem
roadmap/audit_out/.vs/arquivos de outras fases. O valor de hash da árvore candidata calculado nesta
rodada foi removido desta documentação: docs/ledger pertencem à própria árvore medida, portanto
persistir esse valor dentro deles torna a evidência autorreferente. O valor final deve existir apenas
no JSON de fase, revisão Cursor e evidência de commit.

Extração limpa (sem overlay local): `npm ci --ignore-scripts` → 365 pacotes, exit 0;
`tsc -p tsconfig.shadow-replay.json` PASS; `vitest --typecheck` → **no errors**. Nenhum arquivo fora
da árvore candidata foi necessário.

### 13.3 Compatibilidade de assinatura EXATA (Parameters + ReturnType)
`Pick<>` isolado **não** provava parâmetros (funções com menos parâmetros são atribuíveis). Adicionado o
factory genérico `shadowReplayNullMethod<F>` (totalmente genérico; sem import operacional no runtime
isolado): quando ligado a `F` = tipo do método real, produz `(...args: Parameters<F>) => ReturnType<F>`
(corpo lança ANTES de qualquer I/O — corpo `never` atribuível a `ReturnType<F>` sem cast). No teste
(`import type` dos contratos reais) usa-se um `Equal<A,B>` estrito (sem casts) e `Assert<true>`:
- `Equal<Parameters<typeof exact*>, Parameters<RealMethod>>` = `true` para todos: MetaClient
  `sendTextMessage`/`sendTemplateMessage`/`sendDocumentMessage`, `OutboundMessageService.send`,
  `GlpiClient.createTicket`/`createRestrictedRequesterUser`, `ExternalResearchService.researchDynamic`,
  `LogmeinAlarmEngineService.runOnce`;
- `Equal<ReturnType<...>, ReturnType<RealMethod>>` = `true` para todos;
- **Negativos não-vacuosos**: `Equal<Equal<[], Parameters<sendTextMessage>>, false>` etc. = `true`
  (provam que assinatura zero-param/alterada NÃO passaria).
`vitest --typecheck` → **no errors**; `tsc` falha se um contrato real mudar. Sem `any`/`unknown as`/cast
duplo/`@ts-ignore`/`@ts-expect-error`. E-mail e ação genérica permanecem defensivos (sem port real).
Runtime: bloqueio testado (lança `ShadowReplayBlockedError` com code antes de I/O; argumentos nunca
inspecionados/persistidos/logados).

### 13.4 Prova Docker da árvore candidata
Contexto = árvore candidata COMPLETA (operacional + lockfile) + canários; ignore dedicado aplicado como
`.dockerignore` temporário (HML sem `buildx`; nomeação per-Dockerfile não exercitável). Modo:
`FULL_CANDIDATE_TREE_WITH_TEMP_CLASSIC_IGNORE_CONTENT_COPY`. Canary audit `leaked_forbidden=0`; build
`npm ci` OK; imagem non-root/sem portas/sem canário/sem node_modules; matriz safe=0 / missing,invalid,
production,banned=1; containers operacionais intocados; imagem/temp removidos.

### 13.5 Status / ressalvas honestas
- `Pick<>` isolado não bastava (corrigido com `Equal<Parameters/ReturnType>`).
- Nomeação `<Dockerfile>.dockerignore` continua **não suportada no HML** (sem buildx); só o **conteúdo**
  foi exercitado (builder clássico). Compose moderno `NOT_VALIDATABLE` no HML (docker-compose v1.25).
- Lockfile **preparado** para versionar no commit G2 (não declarado como já commitado).
- **G2 = `FIXED_PENDING_CURSOR_005`**; `g2_outbound_null_ready=false`; `shadow_replay_construction_allowed=false`.

---

## 14. FIX 004 (cursor review 004) — 2026-06-22

### 14.1 Worktree Git real
- Worktree detached `@128d529`: `D:/Integracao GLPI Whats.g2-fix004-worktree` (visível em `git worktree list`).
- Diff limitado aos **15 paths** da allowlist; stage vazio; workspace principal preserva `roadmap` dirty **fora** do candidato.

### 14.2 Factory runtime nos adapters efetivos
- `createNullOutboundBoundary()` instancia adapters cujos métodos públicos são **todos** `shadowReplayNullMethod<F>` (sem `unknown[]`, sem `block()` paralelo).
- Prova type-only usa `ReturnType<typeof createNullOutboundBoundary>` — assinaturas dos adapters **realmente** usados.
- Cast duplo `null as unknown as _ProofMarkers` removido; prova via `_ProofCount` type-only.

### 14.3 Meta outbound alcançável (8 métodos)
- `sendTextMessage`, `sendTemplateMessage`, `sendDocumentMessage`, `sendImageMessage`, `sendAudioMessage`, `sendVideoMessage`, `sendReplyButtons`, `sendListMessage`.

### 14.4 Output gerado
- `/integration-service/dist-shadow-replay/` em `.gitignore`; diretório removido após build local de prova.

### 14.5 Regressão
- V10 M5.2/M6.1/M6.2/M7: **190/190** PASS.

### 14.6 Docker (renovado pós-runtime)
- Modo: `FULL_CANDIDATE_TREE_WITH_TEMP_CLASSIC_IGNORE_CONTENT_COPY`.
- `named_dockerfile_ignore_exercised=false`; conteúdo do ignore aplicado como `.dockerignore` temporário.
- `build_subset_hash` registrado no JSON da fase (não embarcado nos arquivos do subset). Esta evidência
  foi superseded pelo algoritmo canônico `g2_build_subset_hash_v1` da seção 15.
- Compose HML: `NOT_VALIDATABLE` (docker-compose v1.25); runbook = `docker run` endurecido.

### 14.7 Roadmap
- `docs/roadmap_v10_plano_restante.md` **excluído** da árvore candidata; dirty no workspace principal preservado unstaged (fora do changeset G2).

---

## 15. FIX 006 (hash/evidência canônica) — 2026-06-22

### 15.1 Algoritmo canônico
Criado `integration-service/scripts/v10ShadowReplayBuildSubsetHash.mjs` para eliminar divergência
Windows/HML. O algoritmo `g2_build_subset_hash_v1`:
- recebe uma raiz de projeto;
- usa paths POSIX relativos à raiz informada (`project_root_posix_relative_paths`);
- ordena paths lexicograficamente;
- lê bytes reais dos arquivos;
- calcula `sha256` e `size_bytes` por arquivo;
- monta JSON canônico com `algorithm_version`, `root_policy`, `paths` e `files`;
- calcula `build_subset_hash = sha256(canonical_json_utf8_lf)`;
- imprime somente JSON e não lê `.env`, rede, docs, tests, dist, node_modules ou fonte operacional.

### 15.2 Build subset congelado
`build_subset_hash local == HML` autoritativo para o commit `e933fda`:
`04727b9a9919b9b1a1496a286323d4db68cb4d3fbb5ec17f9fc36dc0e3f99054`.

Paths do subset:
- `integration-service/Dockerfile.shadow-replay`
- `integration-service/Dockerfile.shadow-replay.dockerignore`
- `integration-service/package-lock.json`
- `integration-service/package.json`
- `integration-service/src/shadowReplay/ShadowReplayIsolationComposition.ts`
- `integration-service/src/shadowReplay/ShadowReplayIsolationEntry.ts`
- `integration-service/src/shadowReplay/ShadowReplayIsolationPolicy.ts`
- `integration-service/src/shadowReplay/ShadowReplayIsolationSelfTest.ts`
- `integration-service/src/shadowReplay/ShadowReplayNullOutboundBoundary.ts`
- `integration-service/tsconfig.json`
- `integration-service/tsconfig.shadow-replay.json`

Hash anterior `baafb11eb04a956eeaca0d0e332e115c21772f79b0c63bcc49bca093c467f25f`
fica marcado como `STALE`: foi calculado em checkout Windows com CRLF, diferente dos bytes usados
por `git archive`/HML Linux para o build subset canônico. Hashes mais antigos de build subset
continuam superseded: eram evidências geradas por algoritmos/raízes/formato de manifesto diferentes,
não o estado canônico atual.

### 15.3 Prova Docker renovada
- Modo real: `MINIMAL_BUILD_SUBSET_TAR`.
- `docker_tar_sha256 = cdf605ca04f2ab91f44a27debf39caee91e8809756d2353c3affd222c2541383`.
- HML recomputou o mesmo `build_subset_hash` autoritativo antes do build.
- `named_ignore_exercised=false`; `full_context_ignore_exercised=false`.
- A nomeação `<Dockerfile>.dockerignore` não foi exercitada no builder legado HML.
- Full-context ignore/canary não é a prova principal desta rodada; esta rodada prova build/runtime do
  subset mínimo validado via `MINIMAL_BUILD_SUBSET_TAR`.
- `docker build --no-cache` PASS.
- Imagem final: `USER node`, sem portas expostas, entrypoint isolado, sem `/app/src`, sem
  `/app/node_modules`, somente `dist-shadow-replay`.
- Matriz one-shot endurecida: safe exit 0; missing/invalid/production/banned-env exit non-zero.
- Containers operacionais permaneceram com o mesmo fingerprint antes/depois; imagem e diretório HML
  temporários removidos.

### 15.4 Status
- **G2 = `READY_AFTER_HASH_RECONCILIATION_DOC_COMMIT`**.
- `g2_outbound_null_ready=true` após este commit documental.
- `shadow_replay_construction_allowed=false`.
- Sem deploy HML, sem produção, sem schema/migration, sem Shadow Store/ingest/exporter/outbox/replay
  worker/live tee.
- Hash da árvore candidata final não deve ser persistido neste documento; ele deve ser retornado no
  JSON da fase/revisão e evidência de commit para evitar autorreferência.
