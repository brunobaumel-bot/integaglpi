import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, '../..');

async function readRel(pathFromRepo: string): Promise<string> {
  return readFile(resolve(repoRoot, pathFromRepo), 'utf8');
}

async function fileExists(pathFromRepo: string): Promise<boolean> {
  try {
    await access(resolve(repoRoot, pathFromRepo));
    return true;
  } catch {
    return false;
  }
}

describe('PHP audit, routing safety, ticket context wiring (static)', () => {
  it('front/audit.php uses rich audit stack (renderer or service)', async () => {
    const auditPhp = await readRel('integaglpi/front/audit.php');
    expect(auditPhp).toMatch(/OperationalAuditRenderer|OperationalAuditService/);
    expect(auditPhp).not.toContain('AuditMenu');
  });

  it('operation.log.php delegates to audit.php', async () => {
    const op = await readRel('integaglpi/front/operation.log.php');
    expect(op).toContain("require __DIR__ . '/audit.php'");
  });

  it('routing safety front page exists', async () => {
    expect(await fileExists('integaglpi/front/routing.safety.php')).toBe(true);
    const page = await readRel('integaglpi/front/routing.safety.php');
    expect(page.length).toBeGreaterThan(20);
  });

  it('setup registers RoutingSafetyMenu and not AuditMenu', async () => {
    const setup = await readRel('integaglpi/setup.php');
    expect(setup).toContain('RoutingSafetyMenu::class');
    expect(setup).not.toContain('AuditMenu');
  });

  it('TicketContextService is referenced from TicketTabRenderer or TicketRuntime', async () => {
    const renderer = await readRel('integaglpi/src/Renderer/TicketTabRenderer.php');
    const runtime = await readRel('integaglpi/src/TicketRuntime.php');
    const combined = renderer + '\n' + runtime;
    expect(combined).toContain('TicketContextService');
  });

  it('central template keeps confirm_entity flow and glpi_entity_id', async () => {
    const central = await readRel('integaglpi/templates/central.php');
    expect(central).toContain('confirm_entity');
    expect(central).toContain('glpi_entity_id');
  });

  it('templates do not expose use_default_entity or Usar entidade padrão', async () => {
    const paths = [
      'integaglpi/templates/central.php',
      'integaglpi/templates/config.php',
      'integaglpi/templates/audit.php',
    ];
    for (const p of paths) {
      const src = await readRel(p);
      expect(src).not.toContain('Usar entidade padrão');
      expect(src).not.toContain('use_default_entity');
    }
  });
});
