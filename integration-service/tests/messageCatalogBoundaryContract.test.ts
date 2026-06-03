import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MESSAGE_CATALOG_BOUNDARY_CONTRACT,
  NODE_MESSAGE_CATALOG_KEYS,
} from '../src/domain/contracts/MessageCatalogContract.js';

const integrationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(integrationRoot, '..');

function readRepo(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function readIntegration(relativePath: string): string {
  return readFileSync(resolve(integrationRoot, relativePath), 'utf8');
}

function listTypeScriptFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];

  for (const entry of entries) {
    const path = resolve(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listTypeScriptFiles(path));
    } else if (path.endsWith('.ts')) {
      files.push(path);
    }
  }

  return files;
}

describe('message catalog PHP/Node boundary contract', () => {
  it('keeps every Node runtime message key present in PHP defaults, sync filter, and schema', () => {
    const settingsService = readIntegration('src/domain/services/SettingsService.ts');
    const pluginConfig = readRepo('integaglpi/src/Service/PluginConfigService.php');
    const externalSync = readRepo('integaglpi/src/Service/ExternalSettingsSyncService.php');
    const postgresRepository = readIntegration('src/repositories/postgres/PostgresSettingsRepository.ts');

    for (const key of NODE_MESSAGE_CATALOG_KEYS) {
      expect(settingsService, `SettingsService fallback for ${key}`).toContain(`${key}:`);
      expect(pluginConfig, `PluginConfigService default for ${key}`).toContain(`'${key}'`);
      expect(externalSync, `ExternalSettingsSyncService column/filter for ${key}`).toContain(`'${key}'`);
      expect(postgresRepository, `PostgresSettingsRepository reads contract key ${key}`).toContain(
        'NODE_MESSAGE_CATALOG_KEYS',
      );
    }
  });

  it('documents one producer/sync/consumer contract without changing runtime behavior', () => {
    expect(MESSAGE_CATALOG_BOUNDARY_CONTRACT).toMatchObject({
      producer: 'integaglpi PluginConfigService.saveMessageConfig',
      sync: 'integaglpi ExternalSettingsSyncService.syncMessageSettings',
      consumer: 'integration-service SettingsService.getMessage/formatMessage',
      storageContext: 'message',
    });
    expect(MESSAGE_CATALOG_BOUNDARY_CONTRACT.placeholders).toContain('ticket_id');
  });

  it('keeps PHP message settings synced through ExternalSettingsSyncService', () => {
    const pluginConfig = readRepo('integaglpi/src/Service/PluginConfigService.php');
    const externalSync = readRepo('integaglpi/src/Service/ExternalSettingsSyncService.php');

    expect(pluginConfig).toContain('public function saveMessageConfig(array $input): ?string');
    expect(pluginConfig).toContain('syncMessageSettings($payload)');
    expect(externalSync).toContain('public function syncMessageSettings(array $values): ?string');
    expect(externalSync).toContain("self::upsertContext($pdo, 'message'");
    expect(externalSync).toContain('self::filterKnownMessageValues($values)');
  });

  it('keeps Node free from GLPI MariaDB direct access', () => {
    const forbidden =
      /from ['"](mysql2?|mariadb|mysqli)['"]|require\(['"](mysql2?|mariadb|mysqli)['"]\)|new PDO\b|PDO::|createConnection\([^)]*3306/i;
    const offenders = listTypeScriptFiles(resolve(integrationRoot, 'src'))
      .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
      .filter(({ source }) => forbidden.test(source))
      .map(({ path }) => path.replace(repoRoot, ''));

    expect(offenders).toEqual([]);
  });

  it('preserves CSRF and RBAC guards on critical PHP WhatsApp actions', () => {
    const critical = [
      'integaglpi/front/central.action.php',
      'integaglpi/front/ticket.whatsapp.action.php',
      'integaglpi/front/ticket.whatsapp.reply.php',
    ];

    for (const relativePath of critical) {
      const source = readRepo(relativePath);
      expect(source, `${relativePath} keeps CSRF`).toContain('Plugin::isCsrfValid($_POST)');
      expect(source, `${relativePath} keeps RBAC`).toContain('requirePermissionOrDeny');
    }

    const centralAction = readRepo('integaglpi/front/central.action.php');
    expect(centralAction).toContain('conversation_id');
    expect(centralAction).toContain('ticket_id');

    const ticketReply = readRepo('integaglpi/front/ticket.whatsapp.reply.php');
    expect(ticketReply).toContain('RIGHT_REPLY_OWNED_TICKET');
    expect(ticketReply).toContain('assigned_user_id');
  });
});
