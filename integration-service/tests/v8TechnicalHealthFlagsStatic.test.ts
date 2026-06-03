import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string): Promise<string> => readFile(resolve(repoRoot, p), 'utf8');

describe('V8 Technical Health — feature flags & migrations (read-only, redacted)', () => {
  it('TechnicalHealthDashboardService surfaces flags + migrations and stays read-only/redacted', async () => {
    const svc = await read('integaglpi/src/Service/TechnicalHealthDashboardService.php');

    // New read-only sections wired into the snapshot.
    expect(svc).toContain("'feature_flags'");
    expect(svc).toContain("'migrations'");
    expect(svc).toContain('function safeFeatureFlags');
    expect(svc).toContain('function safeMigrations');
    expect(svc).toContain("'read_only'              => true");

    // Critical flags requested by the spec are present as keys.
    expect(svc).toContain('AI_SUPERVISOR_ENABLED');
    expect(svc).toContain('OUTBOUND_SEND_MODE');
    expect(svc).toContain('EXTERNAL_RESEARCH_CLOUD_ENABLED');
    expect(svc).toContain('LOGMEIN_INTEGRATION_ENABLED');
    expect(svc).toContain('GLPI_KB_SEARCH_URL');

    // Unknown Node flags are honestly marked, never fabricated.
    expect(svc).toContain('não exposto pelo diagnóstico');

    // URLs are reduced to host only — never the full URL/credentials.
    expect(svc).toContain('function redactUrlToHost');
    expect(svc).toContain("return '[redacted]'");
    expect(svc).toContain('parse_url');

    // Migrations are file-checked only (no DB access, no mutation).
    expect(svc).toContain('migration044SchemaStatus');
    expect(svc).toContain('045_performance_scale_lgpd_indexes');
    expect(svc).toContain('file_check_only_no_db_mutation');
  });

  it('does not call LogMeIn, cloud or mutate state from the health service additions', async () => {
    const svc = await read('integaglpi/src/Service/TechnicalHealthDashboardService.php');

    // No real LogMeIn API call, no cloud invocation, no DB writes introduced.
    expect(svc).not.toMatch(/LogmeinApiClient|logmein.*->(get|post|request)\(/i);
    expect(svc).not.toMatch(/->update\(|->insert\(|->delete\(|Db::update|Db::insert|Db::delete/);
    expect(svc).not.toMatch(/sendOutbound|sendWhatsApp/i);

    // Secret-like fields must never be echoed by the flags section.
    expect(svc).not.toMatch(/getIntegrationAuthKey\s*\(\)\s*;?\s*$/m);
    // Existing sanitizer for credential fragments is preserved.
    expect(svc).toContain('redacted');
  });

  it('technical_health template renders flags + migrations read-only with masking', async () => {
    const tpl = await read('integaglpi/templates/technical_health.php');

    expect(tpl).toContain("\$snapshot['feature_flags']");
    expect(tpl).toContain("\$snapshot['migrations']");
    expect(tpl).toContain('Flags Críticas e Ambiente');
    expect(tpl).toContain('Migrations Críticas');
    expect(tpl).toContain('somente leitura');
    // Values are escaped before output.
    expect(tpl).toContain('$escape($flag');
    expect(tpl).toContain('$escape($mig');
    // No raw secret/token field is printed in the template.
    expect(tpl).not.toMatch(/auth_key|authKey|db_password|integration_auth_key/i);
  });
});
