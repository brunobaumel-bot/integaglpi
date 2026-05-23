import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseHistoricalMiningCliArgs } from '../src/historicalMining/cli.js';

const execFileAsync = promisify(execFile);
const integrationServiceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'integaglpi-hist-cli-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('historical mining CLI', () => {
  it('parses dry-run options without requiring DB configuration', () => {
    const options = parseHistoricalMiningCliArgs([
      '--input',
      'tickets.jsonl',
      '--window-start',
      '2026-01-01',
      '--window-end',
      '2026-12-31',
      '--max-rows',
      '50',
      '--dry-run',
    ]);

    expect(options.inputPath).toBe('tickets.jsonl');
    expect(options.maxRows).toBe(50);
    expect(options.dryRun).toBe(true);
  });

  it('runs dry-run from an offline JSONL file and writes a safe summary', async () => {
    const input = join(tempDir, 'tickets.jsonl');
    const output = join(tempDir, 'summary.json');
    await writeFile(input, JSON.stringify({
      ticket_id_hash: '2112319297',
      opened_at: '2026-01-10T10:00:00.000Z',
      solved_at: '2026-01-11T10:00:00.000Z',
      status: 'solved',
      category: 'Ativacao',
      entity: 'Etica',
      group: 'Suporte',
      title_text_sanitized: 'Ativacao recorrente',
      description_text_sanitized: 'Cliente teste@example.com informou demora',
      followup_text_sanitized: 'Sem retorno claro',
      solution_text_sanitized: 'Ativacao refeita com checklist',
      reopened_count: 0,
    }), 'utf8');

    const { stdout } = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/historicalMining/cli.ts', '--input', input, '--dry-run', '--output-summary', output],
      { cwd: integrationServiceRoot },
    );
    const summaryFile = await readFile(output, 'utf8');

    expect(stdout).toContain('"dry_run": true');
    expect(summaryFile).toContain('"rows_processed": 1');
    expect(summaryFile).not.toContain('teste@example.com');
  });
});
