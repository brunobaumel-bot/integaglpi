import { fileURLToPath } from 'node:url';

import { ensureDatabaseSchema, postgresPool } from '../infra/db/postgres.js';
import { generateAndPersistRiskScore, loadRiskScoringInput } from './repository.js';

interface RiskScoreCliOptions {
  conversationId?: string;
  glpiTicketId?: number;
  dryRun: boolean;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function parseRiskScoreCliArgs(args: string[]): RiskScoreCliOptions {
  const conversationId = readFlag(args, '--conversation-id');
  const ticketValue = readFlag(args, '--ticket-id');
  const glpiTicketId = ticketValue ? Number.parseInt(ticketValue, 10) : undefined;
  if (!conversationId && (!glpiTicketId || glpiTicketId <= 0)) {
    throw new Error('RISK_SCORE_TARGET_REQUIRED');
  }
  return {
    conversationId,
    glpiTicketId: glpiTicketId && glpiTicketId > 0 ? glpiTicketId : undefined,
    dryRun: args.includes('--dry-run'),
  };
}

async function main(): Promise<void> {
  const options = parseRiskScoreCliArgs(process.argv.slice(2));
  await ensureDatabaseSchema();
  const input = await loadRiskScoringInput(postgresPool, {
    conversationId: options.conversationId,
    glpiTicketId: options.glpiTicketId,
  });
  const result = options.dryRun
    ? (await import('./engine.js')).calculatePredictiveRiskScore(input)
    : await generateAndPersistRiskScore(postgresPool, input);

  process.stdout.write(`${JSON.stringify({ dry_run: options.dryRun, result }, null, 2)}\n`);
  await postgresPool.end();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(async (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    await postgresPool.end().catch(() => undefined);
    process.exitCode = 1;
  });
}
