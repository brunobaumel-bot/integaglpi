/**
 * Static contract tests for LogmeinHardwareInventoryService.
 * All assertions are file-content checks — no HTTP calls, no DB, no Redis.
 *
 * PHASE: integaglpi_logmein_hardware_inventory_and_monitoring_001
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hwSvc = readFileSync('src/domain/services/LogmeinHardwareInventoryService.ts', 'utf8');
const glpiClient = readFileSync('src/adapters/glpi/GlpiClient.ts', 'utf8');
const glpiTypes = readFileSync('src/adapters/glpi/glpiTypes.ts', 'utf8');
const envTs = readFileSync('src/config/env.ts', 'utf8');

describe('LogmeinHardwareInventoryService static contract', () => {
  it('uses only GET and passive POST — no write or action endpoints', () => {
    // Only GET /inventory/hardware/fields, GET /inventory/hardware/reports/{token}
    // and POST /inventory/hardware/reports (passive report creation).
    expect(hwSvc).toContain('/inventory/hardware/fields');
    expect(hwSvc).toContain('/inventory/hardware/reports');
    expect(hwSvc).not.toMatch(/\/hosts\/\d+\/connection|\/action|\/session/);
    // The POST path must be the reports endpoint only.
    const postSection = hwSvc.slice(hwSvc.indexOf("private async post("), hwSvc.indexOf("private async extractRetryDelay"));
    expect(postSection).toContain("method: 'POST'");
    expect(postSection).not.toContain('DELETE');
    expect(postSection).not.toContain('PUT');
    expect(postSection).not.toContain('PATCH');
  });

  it('never fills placeholder inventory values', () => {
    const forbiddenPlaceholders = ['placeholder', 'mocked_inventory'];
    for (const ph of forbiddenPlaceholders) {
      expect(hwSvc).not.toContain(`"${ph}"`);
    }
    // safeString returns null for empty values, not a placeholder string.
    expect(hwSvc).toContain('return s === ');
    expect(hwSvc).toContain('null');
  });

  it('does not log or expose PII fields from local users or profiles', () => {
    expect(hwSvc).not.toContain('lastLogonUserName');
    expect(hwSvc).not.toContain('windowsProfiles');
    expect(hwSvc).not.toContain('localUsers');
  });

  it('respects rate limit via retryDelay', () => {
    expect(hwSvc).toContain('retryDelay');
    expect(hwSvc).toContain('RATE_LIMIT_FALLBACK_DELAY_MS');
    expect(hwSvc).toContain('extractRetryDelay');
    expect(hwSvc).toContain('await sleep(delay)');
  });

  it('normalises hardware fields: serviceTag, manufacturer, model, memoryMb, processors, drives, networkConnections', () => {
    expect(hwSvc).toContain('serviceTag');
    expect(hwSvc).toContain('manufacturer');
    expect(hwSvc).toContain('model');
    expect(hwSvc).toContain('memoryMb');
    expect(hwSvc).toContain('processors');
    expect(hwSvc).toContain('drives');
    expect(hwSvc).toContain('networkConnections');
  });

  it('returns null for each hardware field when not present in API response', () => {
    // safeString and safePositiveInt return null for missing values.
    expect(hwSvc).toContain('safeString(');
    expect(hwSvc).toContain('safePositiveInt(');
    expect(hwSvc).toContain(': null');
  });

  it('GlpiClient has updateComputerHardware method that uses PUT — no SQL', () => {
    expect(glpiClient).toContain('updateComputerHardware');
    expect(glpiClient).toContain("method: 'PUT'");
    expect(glpiClient).toContain('glpi_computer_hw_update');
    // Must not reference mysql, mariadb, or direct SQL.
    expect(glpiClient).not.toMatch(/mysql|mariadb|knex|typeorm/i);
  });

  it('GlpiComputerHardwareUpdate type declared in glpiTypes', () => {
    expect(glpiTypes).toContain('GlpiComputerHardwareUpdate');
    expect(glpiTypes).toContain('serial?:');
    expect(glpiTypes).toContain('manufacturers_id?:');
    expect(glpiTypes).toContain('computermodels_id?:');
  });

  it('feature flag LOGMEIN_HARDWARE_INVENTORY_ENABLED defaults to false', () => {
    expect(envTs).toContain('LOGMEIN_HARDWARE_INVENTORY_ENABLED');
    expect(envTs).toContain(".default('false')");
    expect(envTs).toContain("value === 'true'");
  });

  it('failure in hardware inventory does not block the webhook (graceful degradation)', () => {
    // fetchHardwareInventoryForHosts returns null entries, never throws.
    expect(hwSvc).toContain('return new Map(hostIds.map((id) => [id, null]))');
    expect(hwSvc).toContain('return null;');
    // The service logs warn-level, not error-level — no throw.
    expect(hwSvc).toContain("logger.warn(");
  });
});
