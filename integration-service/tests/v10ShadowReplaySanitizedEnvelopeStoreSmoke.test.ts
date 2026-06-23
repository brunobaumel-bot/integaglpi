import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'v10ShadowReplaySanitizedEnvelopeStoreSmoke.mjs');

function scriptSource(): string {
  return readFileSync(SCRIPT, 'utf8');
}

function generatedSql(): string {
  return execFileSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
  });
}

describe('V10 Shadow Replay G7 sanitized envelope store smoke', () => {
  const src = scriptSource();

  it('does not import forbidden runtime modules', () => {
    expect(src).not.toMatch(/from\s+['"]pg['"]/);
    expect(src).not.toMatch(/from\s+['"]ioredis['"]/);
    expect(src).not.toMatch(/from\s+['"]redis['"]/);
    expect(src).not.toMatch(/from\s+['"]node:http['"]/);
    expect(src).not.toMatch(/from\s+['"]node:https['"]/);
    expect(src).not.toMatch(/from\s+['"]node:fetch['"]/);
    expect(src).not.toMatch(/\bprocess\.env\b/);
  });

  it('emits transactional SQL touching only shadow_replay tables', () => {
    const sql = generatedSql();
    expect(sql).toMatch(/\bBEGIN\b/);
    expect(sql).toMatch(/\bROLLBACK\b/);
    expect(sql).not.toMatch(/\bCOMMIT\b/i);
    expect(sql).not.toMatch(/\b2112319360\b/);
    expect(sql).not.toMatch(/\b9999000001\b/);
    expect(sql).not.toMatch(/\b999900\b/);
    expect(sql).not.toMatch(/@/);
    expect(sql).not.toMatch(/\+55/);

    const tableRefs = [...sql.matchAll(/\b(?:INTO|FROM)\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
    expect(tableRefs.length).toBeGreaterThan(0);
    for (const table of tableRefs) {
      expect(table.startsWith('shadow_replay_')).toBe(true);
    }
    expect(sql).toContain('shadow-envelope-smoke-');
    expect(sql).toContain('"phase":"g7"');
    expect(sql).toContain('"sanitized":true');
  });
});