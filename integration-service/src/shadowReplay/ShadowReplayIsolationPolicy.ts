/**
 * V10 Shadow Replay Lab — G2 Outbound-Null Isolation Policy.
 *
 * Fail-closed gate for the Shadow Replay isolation profile. Protection is BY
 * CONSTRUCTION: this module imports nothing from the operational dependency
 * wiring or any real adapter — only node:crypto for in-memory hashing.
 *
 * The process MUST refuse to run unless:
 *   - SHADOW_LAB_MODE === 'true' (exact string),
 *   - NODE_ENV !== 'production',
 *   - APP_ENV / NODE_ENV resolve to an HML/test runtime,
 *   - NO banned operational credential/env key is present.
 *
 * PHASE: integaglpi_v10_shadow_replay_lab_g2_outbound_null_isolation_001
 */

export const SHADOW_REPLAY_BUILD_PROFILE = 'shadow_replay_null_outbound' as const;
export type ShadowReplayBuildProfile = typeof SHADOW_REPLAY_BUILD_PROFILE;

export const SHADOW_REPLAY_BLOCKED_RESULT = 'BLOCKED_BY_SHADOW_REPLAY_ISOLATION' as const;

const HML_ENVS = new Set([
  'hml', 'homolog', 'homologation', 'homologacao', 'homologação', 'staging', 'test',
]);

/** Env key prefixes that indicate an operational outbound credential/config. */
export const BANNED_ENV_PREFIXES = [
  'META_', 'WHATSAPP_', 'SMTP_', 'EMAIL_', 'LOGMEIN_',
  'OPENAI_', 'ANTHROPIC_', 'AZURE_OPENAI_', 'GEMINI_', 'GLPI_API_',
] as const;

/** Exact banned keys / substrings that indicate secrets. */
export const BANNED_ENV_EXACT = ['INTEGRATION_SERVICE_API_KEY'] as const;
export const BANNED_ENV_SUBSTRINGS = ['TOKEN', 'SECRET', 'PASSWORD', 'APIKEY', 'API_KEY', 'ACCESS_KEY', 'CREDENTIAL', 'PRIVATE_KEY'] as const;

/** Env keys explicitly allowed in the isolation container (documented set). */
export const ALLOWED_ENV_KEYS = ['SHADOW_LAB_MODE', 'APP_ENV', 'NODE_ENV', 'LOG_LEVEL', 'TZ'] as const;

export interface ShadowReplayPolicyDecision {
  ok: boolean;
  build_profile: ShadowReplayBuildProfile;
  shadow_lab_mode: boolean;
  reasons: string[];
  /** True if any banned credential/env key was detected in the environment. */
  banned_env_present: boolean;
  banned_env_keys_masked: string[];
  // Hard guarantees — literal types.
  real_adapter_present: false;
  send_allowed: false;
  external_action_allowed: false;
  glpi_mutation_allowed: false;
  cloud_allowed: false;
}

function isBannedEnvKey(rawKey: string): boolean {
  const key = rawKey.toUpperCase();
  if ((BANNED_ENV_EXACT as readonly string[]).includes(key)) return true;
  if (BANNED_ENV_PREFIXES.some((p) => key.startsWith(p))) return true;
  if (BANNED_ENV_SUBSTRINGS.some((s) => key.includes(s))) return true;
  return false;
}

/** Detect banned operational credential/env keys present in the environment. */
export function detectBannedEnvKeys(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env)
    .filter((k) => isBannedEnvKey(k))
    // never expose values; mask the key name to first/last char only
    .map((k) => (k.length <= 2 ? k : `${k[0]}***${k[k.length - 1]}`));
}

/**
 * Evaluate the isolation policy. Fail-closed: any uncertainty → ok=false.
 */
export function evaluateShadowReplayIsolationPolicy(
  env: NodeJS.ProcessEnv = process.env,
): ShadowReplayPolicyDecision {
  const reasons: string[] = [];

  const shadowLabMode = env.SHADOW_LAB_MODE === 'true';
  if (env.SHADOW_LAB_MODE === undefined) {
    reasons.push('SHADOW_LAB_MODE_MISSING');
  } else if (env.SHADOW_LAB_MODE !== 'true') {
    reasons.push('SHADOW_LAB_MODE_NOT_EXACT_TRUE');
  }

  const nodeEnv = (env.NODE_ENV ?? '').toLowerCase();
  const appEnv = (env.APP_ENV ?? '').toLowerCase();
  if (nodeEnv === 'production' || appEnv === 'production') {
    reasons.push('PRODUCTION_ENV_BLOCKED');
  }
  if (!HML_ENVS.has(nodeEnv) && !HML_ENVS.has(appEnv)) {
    reasons.push('NON_HML_TEST_ENV_BLOCKED');
  }

  const bannedKeys = detectBannedEnvKeys(env);
  if (bannedKeys.length > 0) {
    reasons.push(`BANNED_ENV_PRESENT:${bannedKeys.length}`);
  }

  return {
    ok: reasons.length === 0,
    build_profile: SHADOW_REPLAY_BUILD_PROFILE,
    shadow_lab_mode: shadowLabMode,
    reasons,
    banned_env_present: bannedKeys.length > 0,
    banned_env_keys_masked: bannedKeys,
    real_adapter_present: false,
    send_allowed: false,
    external_action_allowed: false,
    glpi_mutation_allowed: false,
    cloud_allowed: false,
  };
}
