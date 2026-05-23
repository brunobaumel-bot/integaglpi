import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, '../..');

async function readProjectFile(path: string): Promise<string> {
  return await readFile(resolve(repoRoot, path), 'utf8');
}

describe('native GLPI knowledge base read-only adapter static safety', () => {
  it('uses GLPI native KB classes/tables with permission and entity checks', async () => {
    const service = await readProjectFile('integaglpi/src/Service/NativeKnowledgeBaseService.php');

    expect(service).toContain('final class NativeKnowledgeBaseService');
    expect(service).toContain('class_exists');
    expect(service).toContain('KnowbaseItem');
    expect(service).toContain('glpi_knowbaseitems');
    expect(service).toContain('glpi_knowbaseitemcategories');
    expect(service).toContain('can($id, READ)');
    expect(service).toContain('Session::haveAccessToEntity');
    expect(service).toContain('$DB->request');
    expect(service).toContain('CANDIDATE_LIMIT = 50');
    expect(service).toContain('FINAL_LIMIT = 5');
  });

  it('keeps the adapter read-only and away from operational actions', async () => {
    const service = await readProjectFile('integaglpi/src/Service/NativeKnowledgeBaseService.php');
    const front = await readProjectFile('integaglpi/front/kb.native.php');

    expect(service).not.toMatch(/->(?:add|update|delete)\s*\(/i);
    expect(service).not.toMatch(/INSERT\s+INTO|UPDATE\s+glpi_knowbaseitems|DELETE\s+FROM|DROP\s+|TRUNCATE\s+/i);
    expect(front).not.toMatch(/POST|requireCsrf|sendOutbound|ticket\.whatsapp|MetaClient|Ollama|Copiloto|embedding|rag/i);
  });

  it('sanitizes GLPI HTML before showing excerpts or future AI context', async () => {
    const service = await readProjectFile('integaglpi/src/Service/NativeKnowledgeBaseService.php');
    const template = await readProjectFile('integaglpi/templates/native_knowledge_base.php');
    const renderer = await readProjectFile('integaglpi/src/Renderer/NativeKnowledgeBaseRenderer.php');

    expect(service).toContain('sanitizeArticleHtml');
    expect(service).toContain('script|iframe|style');
    expect(service).toContain('data:image');
    expect(service).toContain('access_token|token|bearer|signature|app_secret');
    expect(service).toContain('strip_tags');
    expect(service).toContain('EXCERPT_LIMIT = 800');
    expect(renderer).toContain('Html::cleanInputText');
    expect(template).toContain('$this->escape(');
    expect(template).toContain('Base de Conhecimento GLPI');
    expect(template).not.toMatch(/Enviar WhatsApp|Acionar template|Aplicar sugest/i);
  });

  it('freezes the custom KB menu while preserving files and migration 028', async () => {
    const setup = await readProjectFile('integaglpi/setup.php');
    const migration = await readProjectFile('integration-service/schema-migrations/028_knowledge_base_foundation.sql');

    const menuBlock = setup.match(/\$PLUGIN_HOOKS\[Hooks::MENU_TOADD\][\s\S]+?\];/)?.[0] ?? '';
    expect(menuBlock).not.toContain('KnowledgeBaseMenu::class');
    expect(setup).toContain('\\Plugin::registerClass(KnowledgeBaseMenu::class);');
    expect(migration).toContain('glpi_plugin_integaglpi_kb_articles');
    expect(migration).not.toMatch(/DROP\s+|TRUNCATE\s+|DELETE\s+FROM/i);
  });
});
