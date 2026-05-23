import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, '../..');

async function readRel(pathFromRepo: string): Promise<string> {
  return readFile(resolve(repoRoot, pathFromRepo), 'utf8');
}

describe('PHP AI supervisor integration (static)', () => {
  it('keeps AI supervisor hidden by default behind a PHP feature flag', async () => {
    const plugin = await readRel('integaglpi/src/Plugin.php');
    const configService = await readRel('integaglpi/src/Service/PluginConfigService.php');

    expect(plugin).toContain('getAiQualityUrl');
    expect(plugin).toContain('isAiSupervisorEnabled');
    expect(plugin).toContain("getRuntimeConfigValue('AI_SUPERVISOR_ENABLED')");
    expect(plugin).toContain('new PluginConfigService()');
    expect(plugin).toContain('public static function getRuntimeConfigValue(string $key): string');
    expect(plugin).toContain("getenv($key)");
    expect(plugin).toContain("$GLOBALS['CFG_GLPI']['plugin_integaglpi']");
    expect(plugin).toContain("$GLOBALS['PLUGIN_INTEGAGLPI_CONFIG']");
    expect(plugin).toContain("['1', 'true', 'yes', 'on']");
    expect(configService).toContain('getAiSupervisorEnabledRaw');
    expect(configService).toContain("return $value !== '' ? $value : '0';");
    expect(configService).toContain('self::AI_SUPERVISOR_ENABLED_KEY => 0');
    expect(configService).toContain('TINYINT(1) NOT NULL DEFAULT 0');
    expect(configService).toContain('ai_supervisor_enabled');
    expect(configService).not.toContain('getConfigurationValues');
    expect(configService).not.toContain('setConfigurationValues');
  });

  it('protects manual AI analysis actions with supervisor read and CSRF checks', async () => {
    const front = await readRel('integaglpi/front/ai.quality.php');

    expect(front).toContain('Plugin::requireSupervisorRead()');
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
    expect(front).toContain('Plugin::isAiSupervisorEnabled()');
    expect(front).toContain('NativeKnowledgeBaseService');
    expect(front).toContain("'kb_context' => $kbContext");
    expect(front).toContain('requestAiQualityAnalysis');
    expect(front).toContain('submitAiQualityFeedback');
    expect(front).not.toContain('sendOutbound');
    expect(front).not.toContain('updateTicketStatus');
  });

  it('bridges PHP runtime config for internal Bearer auth without logging the secret', async () => {
    const client = await readRel('integaglpi/src/Service/IntegrationServiceClient.php');

    expect(client).toContain('Plugin::getRuntimeConfigValue(\'INTEGRATION_SERVICE_API_KEY\')');
    expect(client).toContain('integration_auth_key');
    expect(client).toContain("'Authorization: Bearer ' . $this->getAuthKey()");
    expect(client).not.toContain('getenv(\'INTEGRATION_SERVICE_API_KEY\')');
    expect(client).not.toContain('error_log($this->getAuthKey');
  });

  it('renders plugin AI config without exposing the stored integration key', async () => {
    const template = await readRel('integaglpi/templates/config.php');

    expect(template).toContain('name="ai_supervisor_enabled"');
    expect(template).toContain('type="checkbox"');
    expect(template).toContain('$configService->isAiSupervisorEnabled()');
    expect(template).toContain('name="integration_auth_key"');
    expect(template).toContain('value=""');
    expect(template).not.toContain('$connectionConfig[\'integration_auth_key\']');
    expect(template).not.toContain('$connectionConfig["integration_auth_key"]');
  });

  it('renders AI block and supervisor feedback in Contexto WhatsApp without exposing raw payloads', async () => {
    const template = await readRel('integaglpi/templates/ticket_tab.php');

    expect(template).toContain('Análise IA — revisão humana obrigatória');
    expect(template).toContain('Aderência à KB GLPI');
    expect(template).toContain('Artigos relacionados da Base GLPI');
    expect(template).toContain('Qualidade de comunicação');
    expect(template).toContain('Analisar conversa');
    expect(template).toContain('Salvar feedback');
    expect(template).toContain('name="feedback"');
    expect(template).not.toContain('payload_json');
    expect(template).not.toContain('access_token');
    expect(template).not.toContain('base64');
  });

  it('integrates AI status into the supervisor backoffice review table', async () => {
    const repository = await readRel('integaglpi/src/External/Repository/SupervisorBackofficeRepository.php');
    const service = await readRel('integaglpi/src/Service/SupervisorBackofficeService.php');
    const template = await readRel('integaglpi/templates/supervisor_backoffice.php');

    expect(repository).toContain('findLatestAiQualityByTicketIds');
    expect(repository).toContain('glpi_plugin_integaglpi_ai_quality_analyses');
    expect(service).toContain('findLatestAiQualityByTicketIds');
    expect(template).toContain('Analisar conversa');
    expect(template).toContain('$this->getAiQualityUrl()');
  });
});
