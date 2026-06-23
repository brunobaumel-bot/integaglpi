/**
 * V10 Shadow Replay Lab — G2 Isolation Self-Test (async).
 *
 * Metadata-only report. Invokes every null adapter method and asserts each REJECTS
 * with ShadowReplayBlockedError (code = BLOCKED_BY_SHADOW_REPLAY_ISOLATION). No I/O,
 * no raw payload.
 *
 * PHASE: integaglpi_v10_shadow_replay_lab_g2_outbound_null_isolation_001
 */

import {
  SHADOW_REPLAY_BLOCKED_RESULT,
  SHADOW_REPLAY_BUILD_PROFILE,
  evaluateShadowReplayIsolationPolicy,
} from './ShadowReplayIsolationPolicy.js';
import {
  SHADOW_REPLAY_BLOCKED_OPERATIONS,
  ShadowReplayBlockedError,
  createNullOutboundBoundary,
} from './ShadowReplayNullOutboundBoundary.js';

export interface ShadowReplaySelfTestReport {
  ok: boolean;
  shadow_lab_mode: boolean;
  build_profile: typeof SHADOW_REPLAY_BUILD_PROFILE;
  adapters: Record<string, 'null'>;
  operations_checked: number;
  all_operations_blocked: boolean;
  real_adapter_present: false;
  send_allowed: false;
  external_action_allowed: false;
  glpi_mutation_allowed: false;
  cloud_allowed: false;
  credentials_present: false | true;
  policy_reasons: string[];
}

export async function runShadowReplaySelfTest(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ShadowReplaySelfTestReport> {
  const policy = evaluateShadowReplayIsolationPolicy(env);
  const boundary = createNullOutboundBoundary();

  let allBlocked = true;
  for (const op of SHADOW_REPLAY_BLOCKED_OPERATIONS) {
    try {
      await op.invoke(boundary);
      allBlocked = false; // a null method must never resolve
    } catch (err) {
      if (!(err instanceof ShadowReplayBlockedError) || err.code !== SHADOW_REPLAY_BLOCKED_RESULT) {
        allBlocked = false;
      }
    }
  }

  return {
    ok: policy.ok && allBlocked,
    shadow_lab_mode: policy.shadow_lab_mode,
    build_profile: SHADOW_REPLAY_BUILD_PROFILE,
    adapters: {
      meta: 'null',
      outbound: 'null',
      glpi: 'null',
      externalResearch: 'null',
      logmein: 'null',
      email: 'null',
      externalAction: 'null',
    },
    operations_checked: SHADOW_REPLAY_BLOCKED_OPERATIONS.length,
    all_operations_blocked: allBlocked,
    real_adapter_present: false,
    send_allowed: false,
    external_action_allowed: false,
    glpi_mutation_allowed: false,
    cloud_allowed: false,
    credentials_present: policy.banned_env_present,
    policy_reasons: policy.reasons,
  };
}
