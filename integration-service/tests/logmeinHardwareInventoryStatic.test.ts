/**
 * Static contract tests for LogmeinHardwareInventoryService.
 * All assertions are file-content checks — no HTTP calls, no DB, no Redis.
 *
 * PHASE: integaglpi_logmein_hardware_inventory_and_monitoring_001
 * PHASE: integaglpi_logmein_hardware_enrichment_pre_production_hardening_001
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

  // ── Hardening: invalid hostIds (HTTP 400) ────────────────────────────────────

  it('handles LM HTTP 400 with invalid hostIds by filtering and retrying once (SKIP_INVALID_LOGMEIN_HOST)', () => {
    // createReport must detect 400 responses with invalid hostIds list.
    expect(hwSvc).toContain('status === 400');
    expect(hwSvc).toContain('errData.hostIds');
    expect(hwSvc).toContain('SKIP_INVALID_LOGMEIN_HOST');
    // Must filter invalid IDs and build a new request with valid ones only.
    expect(hwSvc).toContain('hostIds.filter');
    expect(hwSvc).toContain('invalidIds.length > 0');
    // Retry attempt must exist.
    expect(hwSvc).toContain("retrying");
    // safeJson helper avoids double-consume of response body.
    expect(hwSvc).toContain('safeJson');
  });

  it('invalid hostIds never crash the batch — batch continues for remaining valid hosts', () => {
    // When all hostIds are invalid, return null-filled map rather than throwing.
    expect(hwSvc).toContain("invalidIds.length < hostIds.length");
    // Graceful degradation path: if report creation ultimately fails, return nulls.
    expect(hwSvc).toContain('return new Map(hostIds.map((id) => [id, null]))');
  });

  // ── Hardening: memories array handling ───────────────────────────────────────

  it('memories field is treated as array and summed — not as single-object', () => {
    // LM v1 reports API returns memories as Array<{size:number,...}>.
    // The old code treated it as object.size which returned undefined for arrays.
    expect(hwSvc).toContain('sumMemoryMb');
    expect(hwSvc).toContain('Array.isArray');
    expect(hwSvc).toContain('memories');
    // sumMemoryMb must use reduce to sum all modules.
    const sumFn = hwSvc.slice(hwSvc.indexOf('function sumMemoryMb'), hwSvc.indexOf('function normalizeHostInventory'));
    expect(sumFn).toContain('reduce');
    expect(sumFn).toContain('.size');
    // The old pattern (memObj.size) must be gone.
    expect(hwSvc).not.toContain('memObj.size');
    expect(hwSvc).not.toContain('const memObj =');
  });

  // ── Hardening: feature flag for local IP ─────────────────────────────────────

  it('LOGMEIN_SYNC_LOCAL_IP=false means ip_address is undefined in payload', () => {
    expect(hwSvc).toContain('LOGMEIN_SYNC_LOCAL_IP');
    expect(hwSvc).toContain('syncLocalIp === true');
    // IP is only passed when explicitly enabled — never by default.
    expect(hwSvc).toContain('ip_address: input.syncLocalIp === true');
  });

  // ── Hardening: PHP ComputerHardwareSyncService — frequence/frequency NOT NULL ─

  it('PHP ComputerHardwareSyncService uses frequence=0 and frequency=0 for unknown speed (NOT NULL fix)', () => {
    // Static check: PHP service file must contain both null-safe frequency writes.
    const { readFileSync: rfs } = require('node:fs');
    const phpSvc = rfs('../integaglpi/src/Service/ComputerHardwareSyncService.php', 'utf8');
    // glpi_deviceprocessors.frequence — must NOT be null when speed is 0.
    expect(phpSvc).toContain("'frequence'       => $speed > 0 ? $speed : 0,");
    // glpi_items_deviceprocessors.frequency — same convention.
    expect(phpSvc).toContain("'frequency'         => $speed > 0 ? $speed : 0,");
    // Both columns must explicitly use 0 as fallback (GLPI convention for "not reported").
    expect(phpSvc).not.toContain("'frequence'   => $speed > 0 ? $speed : null,");
    expect(phpSvc).not.toContain("'frequency'         => $speed > 0 ? $speed : null,");
  });
});
