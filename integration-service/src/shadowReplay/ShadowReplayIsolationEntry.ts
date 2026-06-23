/**
 * V10 Shadow Replay Lab — G2 Isolation Entrypoint.
 *
 * Standalone process entry for the isolation proof container.
 * Fail-closed: if the policy refuses (missing/false/invalid SHADOW_LAB_MODE,
 * production, non-HML env, or any banned credential present), the process
 * prints a masked reason and exits NON-ZERO. Otherwise prints the metadata-only
 * self-test report and exits 0.
 *
 * No network, no operational imports, no secret values printed.
 *
 * PHASE: integaglpi_v10_shadow_replay_lab_g2_outbound_null_isolation_001
 */

import { ShadowReplayIsolationBlockedError, composeShadowReplayIsolation } from './ShadowReplayIsolationComposition.js';
import { runShadowReplaySelfTest } from './ShadowReplayIsolationSelfTest.js';

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  try {
    composeShadowReplayIsolation(env);
  } catch (err) {
    if (err instanceof ShadowReplayIsolationBlockedError) {
      // Reasons are codes only (no values/secrets).
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ ok: false, blocked: true, reasons: err.reasons }));
      return 1;
    }
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ ok: false, blocked: true, reasons: ['UNEXPECTED_ERROR'] }));
    return 1;
  }

  const report = await runShadowReplaySelfTest(env);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report));
  return report.ok ? 0 : 1;
}

// Direct execution guard (ESM): run main() and set exit code.
// import.meta.url comparison avoids running during test imports.
const isDirectRun = (() => {
  try {
    return Boolean(process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? ''));
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  void main().then((code) => process.exit(code));
}
