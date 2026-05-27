import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, '../..');

async function readProjectFile(path: string): Promise<string> {
  return readFile(resolve(repoRoot, path), 'utf8');
}

describe('AI online supervisor observer static safety', () => {
  it('creates an additive parser-safe alerts table with constrained values', async () => {
    const migration = await readProjectFile('integration-service/schema-migrations/041_ai_online_supervisor_alerts.sql');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_ai_online_alerts');
    expect(migration).toContain('alert_id TEXT NOT NULL UNIQUE');
    expect(migration).toContain('evidence_summary_sanitized TEXT NOT NULL');
    expect(migration).toContain('recommended_human_action TEXT NOT NULL');
    expect(migration).toContain('source_signals_json JSONB NOT NULL DEFAULT');
    expect(migration).toContain("status IN ('open', 'reviewed', 'dismissed', 'false_positive', 'resolved')");
    expect(migration).toContain("severity IN ('low', 'medium', 'high')");
    expect(migration).toContain('confidence_score BETWEEN 0 AND 100');
    expect(migration).toContain('glpi_intega_ai_online_alert_conversation_status_idx');
    expect(migration).toContain('glpi_intega_ai_online_alert_technician_status_idx');
    expect(migration).not.toMatch(/\b(?:DROP TABLE|TRUNCATE|DELETE FROM)\b/i);
    expect(migration).not.toMatch(/DO\s+\$\$|END IF|CREATE FUNCTION/i);
  });

  it('keeps the worker bounded, locked, rate-limited and off the webhook path', async () => {
    const service = await readProjectFile('integration-service/src/domain/services/AiOnlineSupervisorAlertService.ts');
    const worker = await readProjectFile('integration-service/src/jobs/aiOnlineSupervisorAlertWorker.ts');

    for (const alertType of [
      'long_waiting_client',
      'high_risk_reopen',
      'possible_frustration',
      'supervisor_requested',
      'long_inactivity_risk',
      'queue_accumulation',
      'no_responsible_technician',
    ]) {
      expect(service).toContain(alertType);
    }

    expect(service).toContain('maxConversationsPerRun: 50');
    expect(service).toContain('maxExecutionTimeSeconds: 120');
    expect(service).toContain('cooldownMinutes: 45');
    expect(service).toContain('maxAlertsGlobalPerHour: 50');
    expect(service).toContain('withLock(`ai_online_alert:${conversation.conversationId}`');
    expect(service).toContain('AI_ONLINE_ALERT_CREATED');
    expect(service).toContain('AI_ONLINE_ALERT_SUPPRESSED');
    expect(service).toContain('AI_ONLINE_ALERT_ENRICHED');
    expect(service).toContain('n[aã]o gostei');
    expect(service).toContain('procon');
    expect(worker).toContain('runAiOnlineSupervisorAlertWorker');
    expect(worker).toContain('AI_ONLINE_ALERT_WORKER_LOOP');
    expect(worker).toContain('AI_ONLINE_ALERT_WORKER_INTERVAL_SECONDS');
    expect(worker).toContain('RedisKeyLock');
    expect(`${service}\n${worker}`).not.toMatch(/sendOutbound|MetaClient|KnowbaseItem::add|Ticket::update/i);
    expect(`${service}\n${worker}`).not.toMatch(/whatsapp\.send|sendTemplate|publishKb/i);
  });

  it('adds supervisor-only read-only UI with human feedback and no ticket mutation', async () => {
    const front = await readProjectFile('integaglpi/front/online.monitor.php');
    const renderer = await readProjectFile('integaglpi/src/Renderer/OnlineMonitorRenderer.php');
    const service = await readProjectFile('integaglpi/src/Service/AiOnlineAlertService.php');
    const template = await readProjectFile('integaglpi/templates/online_monitor.php');

    expect(front).toContain('AiOnlineAlertService');
    expect(front).toContain('Plugin::canOnlineMonitorSupervisorRead()');
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
    expect(renderer).toContain('loadOpenBadgeCounts');
    expect(service).toContain('getPanelData');
    expect(service).toContain('handleFeedback');
    expect(service).toContain('AI_ONLINE_ALERT_REVIEWED');
    expect(service).toContain('AI_ONLINE_ALERT_FALSE_POSITIVE');
    expect(service).toContain('AI_ONLINE_ALERT_DISMISSED');
    expect(template).toContain('Alertas gerados por IA são sinais de apoio à supervisão e melhoria contínua');
    expect(template).toContain('name="ai_alert_action" value="feedback"');
    expect(template).toContain('Silenciar por 24h');
    expect(template).toContain('revisão humana obrigatória');
    expect(template).toContain('IA');
    expect(`${front}\n${renderer}\n${service}\n${template}`).not.toMatch(/sendOutbound|MetaClient|KnowbaseItem::add|Ticket::update/i);
    expect(`${front}\n${renderer}\n${service}\n${template}`).not.toMatch(/UPDATE\s+glpi_tickets|UPDATE\s+public\.glpi_plugin_integaglpi_conversations/i);
  });

  it('masks PII and avoids raw prompt or raw payload storage', async () => {
    const nodeService = await readProjectFile('integration-service/src/domain/services/AiOnlineSupervisorAlertService.ts');
    const phpService = await readProjectFile('integaglpi/src/Service/AiOnlineAlertService.php');

    expect(nodeService).toContain('[email]');
    expect(nodeService).toContain('[telefone]');
    expect(nodeService).toContain('[documento]');
    expect(nodeService).toContain('password|senha|token|bearer|api[_-]?key|app[_-]?secret');
    expect(phpService).toContain('[email]');
    expect(phpService).toContain('[telefone]');
    expect(phpService).toContain('[documento]');
    expect(phpService).toContain('[redacted]');
    expect(phpService).toContain("$signals['raw_prompt']");
    expect(`${nodeService}\n${phpService}`).not.toMatch(/INSERT[\s\S]{0,300}(?:prompt_raw|raw_prompt|payload_raw|raw_payload)/i);
    expect(`${nodeService}\n${phpService}`).not.toMatch(/erro do técnico|falha do técnico|conduta errada|ranking|punição|negligência/i);
  });
});
