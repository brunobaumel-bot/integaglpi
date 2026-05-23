import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readProjectFile(path: string): Promise<string> {
  return await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('AI pilot static safety', () => {
  it('keeps plugin UI supervisor-only and operationally inert', async () => {
    const front = await readProjectFile('../integaglpi/front/ai.pilot.php');
    const template = await readProjectFile('../integaglpi/templates/ai_pilot.php');
    const service = await readProjectFile('../integaglpi/src/Service/AiPilotService.php');

    expect(front).toContain('Plugin::requireAiPilotRead()');
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
    expect(template).toContain('Nenhum WhatsApp, ticket ou KB é alterado');
    expect(template).toContain('Payload com PII/segredo/base64 será bloqueado');
    expect(service).toContain('/internal/glpi/ai-pilot/status');
    expect(service).toContain('/internal/glpi/ai-pilot/test');
    expect(`${front}\n${template}\n${service}`).not.toMatch(/sendOutbound|ticket\.whatsapp|knowbaseitem\.form\.php\?id=.*POST|publish|template Meta/i);
  });

  it('keeps cloud and embeddings disabled by default in env example', async () => {
    const envExample = await readProjectFile('.env.example');

    expect(envExample).toContain('AI_PILOT_CLOUD_ENABLED=false');
    expect(envExample).toContain('AI_PILOT_EMBEDDINGS_ENABLED=false');
    expect(envExample).toContain('AI_PILOT_PROVIDER=disabled');
    expect(envExample).toContain('AI_PILOT_DPO_APPROVED=false');
    expect(envExample).not.toMatch(/OPENAI_API_KEY=sk-|ANTHROPIC_API_KEY|GOOGLE_API_KEY/);
  });

  it('does not wire the pilot into webhook, inbound or outbound services', async () => {
    const inbound = await readProjectFile('src/domain/services/InboundWebhookService.ts');
    const outbound = await readProjectFile('src/domain/services/OutboundMessageService.ts');
    const app = await readProjectFile('src/app.ts');

    expect(inbound).not.toContain('AiPilot');
    expect(outbound).not.toContain('AiPilot');
    expect(app).toContain('/internal/glpi/ai-pilot/status');
    expect(app).toContain('/internal/glpi/ai-pilot/test');
    expect(app).not.toContain('/webhook/meta/ai-pilot');
  });
});
