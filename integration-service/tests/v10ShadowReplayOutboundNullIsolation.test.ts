import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SHADOW_REPLAY_BLOCKED_RESULT,
  SHADOW_REPLAY_BUILD_PROFILE,
  evaluateShadowReplayIsolationPolicy,
} from '../src/shadowReplay/ShadowReplayIsolationPolicy.js';
import {
  SHADOW_REPLAY_BLOCKED_OPERATIONS,
  ShadowReplayBlockedError,
  createNullOutboundBoundary,
} from '../src/shadowReplay/ShadowReplayNullOutboundBoundary.js';
import {
  ShadowReplayIsolationBlockedError,
  composeShadowReplayIsolation,
} from '../src/shadowReplay/ShadowReplayIsolationComposition.js';
import { runShadowReplaySelfTest } from '../src/shadowReplay/ShadowReplayIsolationSelfTest.js';

import type { MetaClient } from '../src/adapters/meta/MetaClient.js';
import type { GlpiClient } from '../src/adapters/glpi/GlpiClient.js';
import type { OutboundMessageService } from '../src/domain/services/OutboundMessageService.js';
import type { ExternalResearchService } from '../src/domain/services/ExternalResearchService.js';
import type { LogmeinAlarmEngineService } from '../src/domain/services/LogmeinAlarmEngineService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SR_DIR = join(__dirname, '..', 'src', 'shadowReplay');
const ROOT = join(__dirname, '..', '..');
const CLEAN = { SHADOW_LAB_MODE: 'true', APP_ENV: 'hml', NODE_ENV: 'hml', LOG_LEVEL: 'info' };

function srSource(): string {
  return readdirSync(SR_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(join(SR_DIR, f), 'utf8'))
    .join('\n');
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? ((<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false)
    : false;
type Assert<T extends true> = T;

type Boundary = ReturnType<typeof createNullOutboundBoundary>;

// ─── Actual composition-root adapter signatures (positive) ────────────────────

type _MetaTextArgs = Assert<
  Equal<Parameters<Boundary['meta']['sendTextMessage']>, Parameters<MetaClient['sendTextMessage']>>
>;
type _MetaTextReturn = Assert<
  Equal<ReturnType<Boundary['meta']['sendTextMessage']>, ReturnType<MetaClient['sendTextMessage']>>
>;
type _MetaTemplateArgs = Assert<
  Equal<Parameters<Boundary['meta']['sendTemplateMessage']>, Parameters<MetaClient['sendTemplateMessage']>>
>;
type _MetaTemplateReturn = Assert<
  Equal<ReturnType<Boundary['meta']['sendTemplateMessage']>, ReturnType<MetaClient['sendTemplateMessage']>>
>;
type _MetaDocumentArgs = Assert<
  Equal<Parameters<Boundary['meta']['sendDocumentMessage']>, Parameters<MetaClient['sendDocumentMessage']>>
>;
type _MetaDocumentReturn = Assert<
  Equal<ReturnType<Boundary['meta']['sendDocumentMessage']>, ReturnType<MetaClient['sendDocumentMessage']>>
>;
type _MetaImageArgs = Assert<
  Equal<Parameters<Boundary['meta']['sendImageMessage']>, Parameters<MetaClient['sendImageMessage']>>
>;
type _MetaImageReturn = Assert<
  Equal<ReturnType<Boundary['meta']['sendImageMessage']>, ReturnType<MetaClient['sendImageMessage']>>
>;
type _MetaAudioArgs = Assert<
  Equal<Parameters<Boundary['meta']['sendAudioMessage']>, Parameters<MetaClient['sendAudioMessage']>>
>;
type _MetaAudioReturn = Assert<
  Equal<ReturnType<Boundary['meta']['sendAudioMessage']>, ReturnType<MetaClient['sendAudioMessage']>>
>;
type _MetaVideoArgs = Assert<
  Equal<Parameters<Boundary['meta']['sendVideoMessage']>, Parameters<MetaClient['sendVideoMessage']>>
>;
type _MetaVideoReturn = Assert<
  Equal<ReturnType<Boundary['meta']['sendVideoMessage']>, ReturnType<MetaClient['sendVideoMessage']>>
>;
type _MetaReplyButtonsArgs = Assert<
  Equal<Parameters<Boundary['meta']['sendReplyButtons']>, Parameters<MetaClient['sendReplyButtons']>>
>;
type _MetaReplyButtonsReturn = Assert<
  Equal<ReturnType<Boundary['meta']['sendReplyButtons']>, ReturnType<MetaClient['sendReplyButtons']>>
>;
type _MetaListArgs = Assert<
  Equal<Parameters<Boundary['meta']['sendListMessage']>, Parameters<MetaClient['sendListMessage']>>
>;
type _MetaListReturn = Assert<
  Equal<ReturnType<Boundary['meta']['sendListMessage']>, ReturnType<MetaClient['sendListMessage']>>
>;
type _OutboundSendArgs = Assert<
  Equal<Parameters<Boundary['outbound']['send']>, Parameters<OutboundMessageService['send']>>
>;
type _OutboundSendReturn = Assert<
  Equal<ReturnType<Boundary['outbound']['send']>, ReturnType<OutboundMessageService['send']>>
>;
type _GlpiCreateTicketArgs = Assert<
  Equal<Parameters<Boundary['glpi']['createTicket']>, Parameters<GlpiClient['createTicket']>>
>;
type _GlpiCreateTicketReturn = Assert<
  Equal<ReturnType<Boundary['glpi']['createTicket']>, ReturnType<GlpiClient['createTicket']>>
>;
type _GlpiCreateUserArgs = Assert<
  Equal<
    Parameters<Boundary['glpi']['createRestrictedRequesterUser']>,
    Parameters<GlpiClient['createRestrictedRequesterUser']>
  >
>;
type _GlpiCreateUserReturn = Assert<
  Equal<
    ReturnType<Boundary['glpi']['createRestrictedRequesterUser']>,
    ReturnType<GlpiClient['createRestrictedRequesterUser']>
  >
>;
type _ResearchArgs = Assert<
  Equal<
    Parameters<Boundary['externalResearch']['researchDynamic']>,
    Parameters<ExternalResearchService['researchDynamic']>
  >
>;
type _ResearchReturn = Assert<
  Equal<
    ReturnType<Boundary['externalResearch']['researchDynamic']>,
    ReturnType<ExternalResearchService['researchDynamic']>
  >
>;
type _RunOnceArgs = Assert<
  Equal<Parameters<Boundary['logmein']['runOnce']>, Parameters<LogmeinAlarmEngineService['runOnce']>>
>;
type _RunOnceReturn = Assert<
  Equal<ReturnType<Boundary['logmein']['runOnce']>, ReturnType<LogmeinAlarmEngineService['runOnce']>>
>;

// ─── Negative signature checks (non-vacuous) ──────────────────────────────────

type _NegZeroParamMeta = Assert<
  Equal<Equal<[], Parameters<MetaClient['sendTextMessage']>>, false>
>;
type _NegVoidGlpiReturn = Assert<
  Equal<Equal<void, ReturnType<GlpiClient['createTicket']>>, false>
>;
type _NegZeroParamOutbound = Assert<
  Equal<Equal<[], Parameters<OutboundMessageService['send']>>, false>
>;
type _NegOptionalRemovedGlpi = Assert<
  Equal<
    Equal<
      Parameters<(input: { title: string }) => Promise<number>>,
      Parameters<GlpiClient['createTicket']>
    >,
    false
  >
>;
type _NegRequiredMadeOptionalResearch = Assert<
  Equal<
    Equal<
      Parameters<(input?: ExternalResearchService['researchDynamic'] extends (i: infer I) => unknown ? I : never) => Promise<unknown>>,
      Parameters<ExternalResearchService['researchDynamic']>
    >,
    false
  >
>;

type _ProofMarkers = [
  _MetaTextArgs,
  _MetaTextReturn,
  _MetaTemplateArgs,
  _MetaTemplateReturn,
  _MetaDocumentArgs,
  _MetaDocumentReturn,
  _MetaImageArgs,
  _MetaImageReturn,
  _MetaAudioArgs,
  _MetaAudioReturn,
  _MetaVideoArgs,
  _MetaVideoReturn,
  _MetaReplyButtonsArgs,
  _MetaReplyButtonsReturn,
  _MetaListArgs,
  _MetaListReturn,
  _OutboundSendArgs,
  _OutboundSendReturn,
  _GlpiCreateTicketArgs,
  _GlpiCreateTicketReturn,
  _GlpiCreateUserArgs,
  _GlpiCreateUserReturn,
  _ResearchArgs,
  _ResearchReturn,
  _RunOnceArgs,
  _RunOnceReturn,
  _NegZeroParamMeta,
  _NegVoidGlpiReturn,
  _NegZeroParamOutbound,
  _NegOptionalRemovedGlpi,
  _NegRequiredMadeOptionalResearch,
];

type _ProofCount = Assert<Equal<_ProofMarkers['length'], 31>>;

// ─── Policy fail-closed ───────────────────────────────────────────────────────

describe('Isolation policy — fail-closed', () => {
  it('clean HML env passes', () => {
    expect(evaluateShadowReplayIsolationPolicy(CLEAN).ok).toBe(true);
  });
  it('missing SHADOW_LAB_MODE blocks', () => {
    const d = evaluateShadowReplayIsolationPolicy({ APP_ENV: 'hml', NODE_ENV: 'hml' });
    expect(d.ok).toBe(false);
    expect(d.reasons).toContain('SHADOW_LAB_MODE_MISSING');
  });
  it('SHADOW_LAB_MODE=false blocks', () => {
    expect(evaluateShadowReplayIsolationPolicy({ ...CLEAN, SHADOW_LAB_MODE: 'false' }).ok).toBe(false);
  });
  it('SHADOW_LAB_MODE invalid blocks', () => {
    const d = evaluateShadowReplayIsolationPolicy({ ...CLEAN, SHADOW_LAB_MODE: 'YES' });
    expect(d.ok).toBe(false);
    expect(d.reasons).toContain('SHADOW_LAB_MODE_NOT_EXACT_TRUE');
  });
  it('production blocks', () => {
    expect(evaluateShadowReplayIsolationPolicy({ ...CLEAN, NODE_ENV: 'production' }).ok).toBe(false);
    expect(evaluateShadowReplayIsolationPolicy({ ...CLEAN, APP_ENV: 'production' }).ok).toBe(false);
  });
  it('non-HML/test env blocks', () => {
    expect(
      evaluateShadowReplayIsolationPolicy({ SHADOW_LAB_MODE: 'true', APP_ENV: 'dev', NODE_ENV: 'dev' }).ok,
    ).toBe(false);
  });
});

describe('Banned env fail-closed', () => {
  const banned = [
    'META_ACCESS_TOKEN',
    'WHATSAPP_PHONE_ID',
    'SMTP_HOST',
    'EMAIL_FROM',
    'LOGMEIN_API',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'AZURE_OPENAI_KEY',
    'GEMINI_KEY',
    'GLPI_API_BASE_URL',
    'INTEGRATION_SERVICE_API_KEY',
    'SOME_SECRET',
    'A_TOKEN',
    'X_PASSWORD',
  ];
  for (const key of banned) {
    it(`blocks when ${key} present (value never read)`, () => {
      const d = evaluateShadowReplayIsolationPolicy({ ...CLEAN, [key]: 'should-not-be-read' });
      expect(d.ok).toBe(false);
      expect(d.banned_env_present).toBe(true);
      expect(JSON.stringify(d.banned_env_keys_masked)).not.toContain('should-not-be-read');
    });
  }
});

describe('Null outbound boundary (composition-root adapters)', () => {
  const b = createNullOutboundBoundary();

  it('every operation rejects with BLOCKED code (synthetic args)', async () => {
    expect(SHADOW_REPLAY_BLOCKED_OPERATIONS.length).toBe(15);
    for (const op of SHADOW_REPLAY_BLOCKED_OPERATIONS) {
      let err: unknown = null;
      try {
        await op.invoke(b);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ShadowReplayBlockedError);
      const e = err as ShadowReplayBlockedError;
      expect(e.code).toBe(SHADOW_REPLAY_BLOCKED_RESULT);
      expect(e.executed).toBe(false);
      expect(e.real).toBe(false);
      expect(e.descriptor_hash).toMatch(/^[a-f0-9]{64}$/);
      const serialized = JSON.stringify({ c: e.code, h: e.descriptor_hash });
      expect(serialized).not.toContain('message_body');
      expect(serialized).not.toContain('raw_payload');
      expect(serialized).not.toContain('phone');
    }
  });

  it('boundary flags are literal false', () => {
    expect(b.real_adapter_present).toBe(false);
    expect(b.send_allowed).toBe(false);
    expect(b.external_action_allowed).toBe(false);
    expect(b.glpi_mutation_allowed).toBe(false);
    expect(b.cloud_allowed).toBe(false);
  });
});

describe('Isolation composition', () => {
  it('throws blocked error on closed policy', () => {
    expect(() => composeShadowReplayIsolation({ APP_ENV: 'hml', NODE_ENV: 'hml' })).toThrow(
      ShadowReplayIsolationBlockedError,
    );
  });
  it('composes on clean env with literal-false guarantees', () => {
    const c = composeShadowReplayIsolation(CLEAN);
    expect(c.build_profile).toBe(SHADOW_REPLAY_BUILD_PROFILE);
    expect(c.real_adapter_present).toBe(false);
    expect(c.send_allowed).toBe(false);
  });
});

describe('Self-test', () => {
  it('reports ok + all blocked under clean env', async () => {
    const r = await runShadowReplaySelfTest(CLEAN);
    expect(r.ok).toBe(true);
    expect(r.all_operations_blocked).toBe(true);
    expect(r.operations_checked).toBe(15);
    expect(r.credentials_present).toBe(false);
  });
});

describe('Source isolation (by construction)', () => {
  const src = srSource();
  it('does not import operational wiring', () => {
    expect(src).not.toContain('buildDependencies');
  });
  it('does not import real outbound adapters/services', () => {
    expect(src).not.toContain('adapters/meta/MetaClient');
    expect(src).not.toContain('OutboundMessageService');
  });
  it('does not use network modules or dynamic import', () => {
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/\bimport\s*\(/);
  });
});

describe('Docker isolation files', () => {
  it('compose hardened profile', () => {
    const compose = readFileSync(join(ROOT, 'docker-compose.shadow-replay.hml.yml'), 'utf8');
    expect(compose).not.toMatch(/env_file/);
    expect(compose).toMatch(/internal:\s*true/);
    expect(compose).toMatch(/read_only:\s*true/);
  });
  it('Dockerfile npm ci + lockfile', () => {
    const df = readFileSync(join(__dirname, '..', 'Dockerfile.shadow-replay'), 'utf8');
    expect(df).toMatch(/npm ci/);
    expect(df).toMatch(/package-lock\.json/);
  });
  it('dedicated dockerignore deny-all + lockfile', () => {
    const di = readFileSync(join(__dirname, '..', 'Dockerfile.shadow-replay.dockerignore'), 'utf8');
    expect(di).toContain('**');
    expect(di).toContain('!package-lock.json');
    expect(di).toContain('!src/shadowReplay');
  });
});

describe('Compiled artifact isolation', () => {
  const dist = join(__dirname, '..', 'dist-shadow-replay');
  it('dist has no operational references when built', () => {
    if (!existsSync(dist)) {
      return;
    }
    const out = readdirSync(dist)
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(join(dist, f), 'utf8'))
      .join('\n')
      .toLowerCase();
    expect(out).not.toContain('builddependencies');
    expect(out).not.toContain('metaclient');
  });
});
