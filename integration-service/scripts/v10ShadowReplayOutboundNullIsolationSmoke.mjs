/**
 * V10 Shadow Replay Lab — G2 Outbound-Null Isolation smoke (local, metadata-only).
 *
 * Requires a prior build: `npx tsc -p tsconfig.shadow-replay.json`.
 * Imports ONLY the compiled isolated artifact (dist-shadow-replay). No network,
 * no operational modules, no credentials. Demonstrates:
 *   1. clean env -> ok:true, all adapters null/blocked
 *   2. missing SHADOW_LAB_MODE -> blocked
 *   3. SHADOW_LAB_MODE=false -> blocked
 *   4. production -> blocked
 *   5. banned credential env -> blocked
 *
 * PHASE: integaglpi_v10_shadow_replay_lab_g2_outbound_null_isolation_001
 */

import { runShadowReplaySelfTest } from '../dist-shadow-replay/ShadowReplayIsolationSelfTest.js';
import { evaluateShadowReplayIsolationPolicy } from '../dist-shadow-replay/ShadowReplayIsolationPolicy.js';

const CLEAN = { SHADOW_LAB_MODE: 'true', APP_ENV: 'hml', NODE_ENV: 'hml', LOG_LEVEL: 'info' };

const report = await runShadowReplaySelfTest(CLEAN);
const cases = {
  clean_ok: report.ok === true && report.all_operations_blocked === true,
  build_profile_ok: report.build_profile === 'shadow_replay_null_outbound',
  send_blocked: report.send_allowed === false,
  glpi_blocked: report.glpi_mutation_allowed === false,
  cloud_blocked: report.cloud_allowed === false,
  external_blocked: report.external_action_allowed === false,
  credentials_absent: report.credentials_present === false,
  missing_flag_blocks: evaluateShadowReplayIsolationPolicy({ APP_ENV: 'hml', NODE_ENV: 'hml' }).ok === false,
  false_flag_blocks: evaluateShadowReplayIsolationPolicy({ ...CLEAN, SHADOW_LAB_MODE: 'false' }).ok === false,
  invalid_flag_blocks: evaluateShadowReplayIsolationPolicy({ ...CLEAN, SHADOW_LAB_MODE: 'YES' }).ok === false,
  production_blocks: evaluateShadowReplayIsolationPolicy({ ...CLEAN, NODE_ENV: 'production' }).ok === false,
  banned_env_blocks: evaluateShadowReplayIsolationPolicy({ ...CLEAN, META_ACCESS_TOKEN: 'x' }).ok === false,
};

const allPass = Object.values(cases).every(Boolean);
console.log(JSON.stringify({ smoke: 'v10_shadow_replay_outbound_null_isolation', all_pass: allPass, cases, report }, null, 2));
process.exit(allPass ? 0 : 1);
