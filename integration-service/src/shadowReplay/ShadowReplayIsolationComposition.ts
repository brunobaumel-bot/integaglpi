/**
 * V10 Shadow Replay Lab — G2 Isolation Composition Root (dedicated).
 *
 * Separate composition root for the Shadow Replay isolation profile.
 * - Does NOT import the operational dependency wiring or composition root.
 * - Has NO branch that could instantiate a real adapter.
 * - Instantiates only the null outbound boundary.
 *
 * PHASE: integaglpi_v10_shadow_replay_lab_g2_outbound_null_isolation_001
 */

import {
  SHADOW_REPLAY_BUILD_PROFILE,
  type ShadowReplayBuildProfile,
  type ShadowReplayPolicyDecision,
  evaluateShadowReplayIsolationPolicy,
} from './ShadowReplayIsolationPolicy.js';
import {
  type NullOutboundBoundary,
  createNullOutboundBoundary,
} from './ShadowReplayNullOutboundBoundary.js';

export interface ShadowReplayIsolationComposition {
  build_profile: ShadowReplayBuildProfile;
  policy: ShadowReplayPolicyDecision;
  boundary: NullOutboundBoundary;
  // Immutable profile guarantees (literal types).
  real_adapter_present: false;
  send_allowed: false;
  external_action_allowed: false;
  glpi_mutation_allowed: false;
  cloud_allowed: false;
}

export class ShadowReplayIsolationBlockedError extends Error {
  public constructor(public readonly reasons: string[]) {
    super(`SHADOW_REPLAY_ISOLATION_BLOCKED: ${reasons.join(',')}`);
    this.name = 'ShadowReplayIsolationBlockedError';
  }
}

/**
 * Compose the isolation profile. Throws ShadowReplayIsolationBlockedError when
 * the fail-closed policy refuses to run (caller must exit non-zero).
 */
export function composeShadowReplayIsolation(
  env: NodeJS.ProcessEnv = process.env,
): ShadowReplayIsolationComposition {
  const policy = evaluateShadowReplayIsolationPolicy(env);
  if (!policy.ok) {
    throw new ShadowReplayIsolationBlockedError(policy.reasons);
  }
  return {
    build_profile: SHADOW_REPLAY_BUILD_PROFILE,
    policy,
    boundary: createNullOutboundBoundary(),
    real_adapter_present: false,
    send_allowed: false,
    external_action_allowed: false,
    glpi_mutation_allowed: false,
    cloud_allowed: false,
  };
}
