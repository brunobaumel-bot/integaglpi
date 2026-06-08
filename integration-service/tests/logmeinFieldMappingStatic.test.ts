/**
 * Static contract tests for LogmeinFieldMappingService.
 * All assertions are file-content checks — no HTTP calls, no DB, no Redis.
 *
 * Verified contracts:
 *  - Forbidden PII fields are blocked unconditionally.
 *  - Dry-run never modifies GLPI (no glpiClient calls, no bridge calls).
 *  - Each overwrite policy is implemented and named correctly.
 *  - IP address requires LOGMEIN_SYNC_LOCAL_IP flag.
 *  - No auto-ticket, no alarm engine.
 *  - Migration is additive only (no DROP/TRUNCATE/DELETE).
 *
 * PHASE: integaglpi_logmein_field_mapping_config_001
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const fieldSvc = readFileSync('src/domain/services/LogmeinFieldMappingService.ts', 'utf8');
const repo = readFileSync('src/repositories/postgres/PostgresLogmeinFieldMappingRepository.ts', 'utf8');
const hwSvc = readFileSync('src/domain/services/LogmeinHardwareInventoryService.ts', 'utf8');
const controller = readFileSync('src/controllers/createLogmeinFieldMappingController.ts', 'utf8');
const glpiTypes = readFileSync('src/adapters/glpi/glpiTypes.ts', 'utf8');
const migration = readFileSync('../integration-service/schema-migrations/047_logmein_field_mapping_config.sql', 'utf8');
const phpSvc = readFileSync('../integaglpi/src/Service/LogmeinFieldMappingService.php', 'utf8');
const phpFront = readFileSync('../integaglpi/front/logmein.fieldmapping.php', 'utf8');
const phpTemplate = readFileSync('../integaglpi/templates/logmein_fieldmapping.php', 'utf8');

describe('LogmeinFieldMappingService contract', () => {
  // ── PII / forbidden fields ─────────────────────────────────────────────────

  it('FORBIDDEN_FIELDS set blocks all PII fields', () => {
    const piiFields = ['localUsers', 'windowsProfiles', 'lastLogonUserName', 'externalIp', 'journalEntries'];
    for (const f of piiFields) {
      expect(fieldSvc).toContain(`'${f}'`);
    }
    expect(fieldSvc).toContain('LOGMEIN_FORBIDDEN_FIELDS');
    expect(fieldSvc).toContain('new Set<string>');
  });

  it('isFieldForbidden blocks unknown fields not in the allowed set', () => {
    expect(fieldSvc).toContain('LOGMEIN_ALLOWED_FIELD_KEYS');
    expect(fieldSvc).toContain('isFieldForbidden');
    expect(fieldSvc).toContain('LOGMEIN_FORBIDDEN_FIELDS.has(fieldKey)');
    expect(fieldSvc).toContain('!LOGMEIN_ALLOWED_FIELD_KEYS.has(fieldKey)');
  });

  it('PHP service also blocks forbidden PII fields with the same list', () => {
    const piiFields = ['localUsers', 'windowsProfiles', 'lastLogonUserName', 'externalIp', 'journalEntries'];
    for (const f of piiFields) {
      expect(phpSvc).toContain(`'${f}'`);
    }
    expect(phpSvc).toContain('FORBIDDEN_FIELDS');
  });

  it('PHP service uses canonical external PostgreSQL connection config', () => {
    expect(phpSvc).toContain('$this->pluginConfigService->getConnectionConfig()');
    expect(phpSvc).toContain('ExternalDatabase::getConnection($config)');
    expect(phpSvc).not.toContain('getExternalDbConfig');
  });

  // ── Overwrite policies ─────────────────────────────────────────────────────

  it('all three overwrite policies are implemented in TypeScript service', () => {
    expect(fieldSvc).toContain("'never_overwrite_manual'");
    expect(fieldSvc).toContain("'overwrite_only_logmein_origin'");
    expect(fieldSvc).toContain("'always_update'");
    // evaluatePolicy must handle all three.
    expect(fieldSvc).toContain('evaluatePolicy');
  });

  it('all three overwrite policies are implemented in PHP service', () => {
    expect(phpSvc).toContain("'never_overwrite_manual'");
    expect(phpSvc).toContain("'overwrite_only_logmein_origin'");
    expect(phpSvc).toContain("'always_update'");
    expect(phpSvc).toContain('VALID_POLICIES');
    expect(phpSvc).toContain('evaluatePolicy');
  });

  it('glpiTypes declares all policy literals and mapping interfaces', () => {
    expect(glpiTypes).toContain("'never_overwrite_manual'");
    expect(glpiTypes).toContain("'overwrite_only_logmein_origin'");
    expect(glpiTypes).toContain("'always_update'");
    expect(glpiTypes).toContain('LogmeinFieldMapping');
    expect(glpiTypes).toContain('LogmeinHardwareDryRun');
    expect(glpiTypes).toContain('LogmeinFieldDryRunResult');
    expect(glpiTypes).toContain('LogmeinFieldDryRunStatus');
    expect(glpiTypes).toContain("'context_only'");
    expect(glpiTypes).toContain("'alarm_context'");
  });

  // ── Dry-run contract ───────────────────────────────────────────────────────

  it('dry-run result always has dryRunOnly: true and never calls bridge/glpiClient', () => {
    expect(fieldSvc).toContain('dryRunOnly: true');
    expect(fieldSvc).toContain('DRY_RUN');
    // dry-run must not call the bridge or syncComputerHardware.
    const dryRunFn = fieldSvc.slice(fieldSvc.indexOf('public async dryRun'), fieldSvc.indexOf('public async filterPayload'));
    expect(dryRunFn).not.toContain('syncComputerHardware');
    expect(dryRunFn).not.toContain('glpiClient');
    expect(dryRunFn).not.toContain('bridge');
  });

  it('dry-run reports all status variants', () => {
    expect(fieldSvc).toContain("'would_update'");
    expect(fieldSvc).toContain("'would_skip'");
    expect(fieldSvc).toContain("'blocked_by_policy'");
    expect(fieldSvc).toContain("'field_unavailable'");
    expect(fieldSvc).toContain("'blocked_pii'");
    expect(fieldSvc).toContain("'blocked_flag'");
  });

  it('dry-run masks MAC and IP in output (no plaintext sensitive values)', () => {
    expect(fieldSvc).toContain("'[redacted for dry-run]'");
    expect(fieldSvc).toContain('NetworkConnectionMacAddress');
    expect(fieldSvc).toContain('NetworkConnectionIPAddress');
    expect(fieldSvc).toContain('LOGMEIN_NETWORK_SENSITIVE_FIELDS');
    expect(fieldSvc).toContain('NetworkConnectionDefaultGateway');
    expect(fieldSvc).toContain('NetworkConnectionPrimaryDNS');
  });

  it('PHP dry-run also marks dry_run_only: true and never modifies GLPI', () => {
    expect(phpSvc).toContain("'dry_run_only'");
    expect(phpSvc).toContain("=> true");
    expect(phpSvc).toContain("'auto_ticket'");
    expect(phpSvc).toContain("=> false");
    expect(phpSvc).toContain("'alarm_engine'");
    // Must not call any GLPI write methods inside dryRun.
    const dryRunMethod = phpSvc.slice(phpSvc.indexOf('public function dryRun'), phpSvc.indexOf('// ── Helpers'));
    expect(dryRunMethod).not.toContain('->update(');
    expect(dryRunMethod).not.toContain('->add(');
    expect(dryRunMethod).not.toContain('->delete(');
  });

  // ── IP local flag ──────────────────────────────────────────────────────────

  it('NetworkConnectionIPAddress requires LOGMEIN_SYNC_LOCAL_IP flag', () => {
    expect(fieldSvc).toContain('LOGMEIN_SYNC_LOCAL_IP');
    expect(fieldSvc).toContain('blocked_flag');
    // Flag check must be present for the IP field.
    expect(fieldSvc).toContain("requiresFlag === 'LOGMEIN_SYNC_LOCAL_IP'");
    expect(fieldSvc).toContain('!syncLocalIp');
  });

  it('IP defaults to inactive in migration seed', () => {
    expect(migration).toContain("'NetworkConnectionIPAddress'");
    expect(migration).toContain("'LOGMEIN_SYNC_LOCAL_IP'");
    // IP row must be seeded with is_active = FALSE.
    const ipLine = migration
      .split('\n')
      .find((l) => l.includes('NetworkConnectionIPAddress'));
    expect(ipLine).toBeDefined();
    expect(ipLine).toContain('FALSE');
  });

  // ── No auto-ticket / no alarm engine ──────────────────────────────────────

  it('field mapping service has no auto_ticket, alarm, or createTicket logic', () => {
    const combined = `${fieldSvc}\n${repo}\n${controller}`;
    expect(combined).not.toMatch(/auto_ticket\s*[:=]\s*true/i);
    expect(combined).not.toMatch(/createTicket|openTicket|insertTicket/i);
    expect(combined).not.toMatch(/alarm_engine\s*[:=]\s*true/i);
    expect(combined).not.toMatch(/LOGMEIN_AUTO_TICKET|alarm_rules|alarm_events/i);
  });

  it('PHP files have no auto_ticket or alarm engine logic', () => {
    const combined = `${phpSvc}\n${phpFront}\n${phpTemplate}`;
    // auto_ticket may appear as a key with value false — must never be true.
    expect(combined).not.toMatch(/auto_ticket\s*[=:>]+\s*true/i);
    // alarm_engine may appear as a key with value false — must never be true.
    expect(combined).not.toMatch(/alarm_engine\s*[=:>]+\s*true/i);
    // Must never create tickets automatically.
    expect(combined).not.toMatch(/createTicket|addTicket/i);
  });

  // ── Migration constraints ──────────────────────────────────────────────────

  it('migration 047 is additive only — no DROP, TRUNCATE, or DELETE', () => {
    expect(migration).not.toMatch(/\bDROP\b/i);
    expect(migration).not.toMatch(/\bTRUNCATE\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS');
    expect(migration).toContain('ON CONFLICT');
    expect(migration).toContain('DO NOTHING');
  });

  it('migration seeds default mappings for all major hardware fields', () => {
    const expectedSeeds = [
      'ServiceTag', 'HardwareManufacturer', 'HardwareModel',
      'CpuType', 'CpuNumberOfProcessors', 'CpuSpeed', 'MemorySize', 'MemoryModules',
      'DriveDiskType', 'DriveMediaType', 'PartitionFreeSpace', 'PartitionTotalSize',
      'MotherboardChipset', 'PrimaryScreenResolution',
      'NetworkConnectionMacAddress',
    ];
    for (const field of expectedSeeds) {
      expect(migration).toContain(`'${field}'`);
    }
  });

  it('migration classifies non-native fields as context_only or alarm_context', () => {
    expect(migration).toContain("'context_only'");
    expect(migration).toContain("'alarm_context'");
    expect(migration).toContain("'PartitionFreeSpace',         'alarm_context'");
    expect(migration).toContain("'DisplayProvider',            'context_only'");
  });

  it('migration keeps local network internals inactive and behind LOGMEIN_SYNC_LOCAL_IP', () => {
    const networkFields = [
      'NetworkConnectionDefaultGateway',
      'NetworkConnectionDHCPServer',
      'NetworkConnectionPrimaryDNS',
      'NetworkConnectionSubnetMask',
    ];
    for (const field of networkFields) {
      const line = migration.split('\n').find((l) => l.includes(`'${field}'`));
      expect(line).toBeDefined();
      expect(line).toContain('FALSE');
      expect(line).toContain('LOGMEIN_SYNC_LOCAL_IP');
    }
  });

  it('does not invent antivirus or operating-system mappings absent from the discovered HML fields endpoint', () => {
    expect(migration).not.toMatch(/Antivirus|AntiVirus|OperatingSystem|OSVersion|OsName/);
    expect(fieldSvc).not.toMatch(/Antivirus|AntiVirus|OperatingSystem|OSVersion|OsName/);
  });

  it('migration CHECK constraint enforces valid policies only', () => {
    expect(migration).toContain('CHECK (overwrite_policy IN');
    expect(migration).toContain("'never_overwrite_manual'");
    expect(migration).toContain("'overwrite_only_logmein_origin'");
    expect(migration).toContain("'always_update'");
  });

  // ── Hardware sync integration ──────────────────────────────────────────────

  it('LogmeinHardwareInventoryService accepts optional fieldMappingService', () => {
    expect(hwSvc).toContain('LogmeinFieldMappingService');
    expect(hwSvc).toContain('fieldMappingService?');
    expect(hwSvc).toContain('filterPayloadByMappings');
  });

  it('enrichGlpiComputerFromLogmein calls filterPayloadByMappings when available', () => {
    const enrichFn = hwSvc.slice(hwSvc.indexOf('public async enrichGlpiComputerFromLogmein'), hwSvc.indexOf('public async dryRunHardwareSync'));
    expect(enrichFn).toContain('filterPayloadByMappings');
    expect(enrichFn).toContain('fieldMappingService');
  });

  it('dryRunHardwareSync never modifies GLPI', () => {
    const dryFn = hwSvc.slice(hwSvc.indexOf('public async dryRunHardwareSync'), hwSvc.indexOf('/** Lists all available'));
    expect(dryFn).not.toContain('syncComputerHardware');
    expect(dryFn).not.toContain('updateComputerHardware');
    expect(dryFn).toContain('dryRunOnly: true');
  });

  // ── RBAC / PHP front ───────────────────────────────────────────────────────

  it('PHP front requires GLPI login and read permission before processing', () => {
    expect(phpFront).toContain('Session::checkLoginUser()');
    expect(phpFront).toContain('Plugin::canRead()');
    expect(phpFront).toContain('Html::displayRightError()');
  });

  it('PHP front validates CSRF token before any state mutation', () => {
    expect(phpFront).toContain('Plugin::isCsrfValid');
    expect(phpFront).toContain("'danger'");
  });

  it('template includes dry_run_only marker and no auto-ticket notice', () => {
    expect(phpTemplate).toContain('dry_run_only');
    expect(phpTemplate).toContain('Nenhum chamado é criado automaticamente');
    expect(phpTemplate).toContain('auto_ticket');
    expect(phpTemplate).toContain('blocked_pii');
    expect(phpTemplate).toContain('Contexto / somente leitura');
    expect(phpTemplate).toContain('Contexto para alarmes');
    expect(phpTemplate).not.toMatch(/auto_ticket\s*=\s*true/i);
  });
});
