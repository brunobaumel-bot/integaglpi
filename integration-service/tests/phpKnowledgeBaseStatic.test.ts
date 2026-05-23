import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, '../..');

async function readProjectFile(path: string): Promise<string> {
  return await readFile(resolve(repoRoot, path), 'utf8');
}

describe('plugin knowledge base foundation static safety', () => {
  it('protects the KB front controller with login, permissions and CSRF', async () => {
    const front = await readProjectFile('integaglpi/front/kb.php');

    expect(front).toContain('Session::checkLoginUser();');
    expect(front).toContain('Plugin::requireKnowledgeBaseRead();');
    expect(front).toContain('Plugin::requireKnowledgeBaseUpdate();');
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
    expect(front).not.toMatch(/Ollama|ai-quality|sendOutbound|ticket\.whatsapp|MetaClient/);
  });

  it('uses prepared statements and validates allowlists/secrets in the KB service', async () => {
    const service = await readProjectFile('integaglpi/src/Service/KnowledgeBaseService.php');

    expect(service).toContain('private const ARTICLE_TYPES');
    expect(service).toContain('private const STATUSES');
    expect(service).toContain('prepare(');
    expect(service).toContain('bindValue(');
    expect(service).toContain('assertNoExplicitSecret');
    expect(service).toContain('KB_ARTICLE_CREATED');
    expect(service).toContain('KB_ARTICLE_UPDATED');
    expect(service).toContain('KB_ARTICLE_PUBLISHED');
    expect(service).toContain('KB_ARTICLE_ARCHIVED');
    expect(service).toContain('KB_ARTICLE_VERSION_CREATED');
    expect(service).not.toMatch(/\$sql\s*\.=\s*\$_(?:GET|POST|REQUEST)/);
    expect(service).not.toMatch(/DROP\s+|TRUNCATE\s+|DELETE\s+FROM/i);
    expect(service).not.toMatch(/Ollama|embedd|vector|rag/i);
  });

  it('escapes KB template output and has no operational action buttons', async () => {
    const template = await readProjectFile('integaglpi/templates/knowledge_base.php');
    const renderer = await readProjectFile('integaglpi/src/Renderer/KnowledgeBaseRenderer.php');

    expect(renderer).toContain('Html::cleanInputText');
    expect(template).toContain('$this->escape(');
    expect(template).toContain('$this->renderCsrfToken()');
    expect(template).toContain('Sem RAG, embeddings, IA ou envio ao cliente');
    expect(template).not.toMatch(/Enviar WhatsApp|Acionar template|Ollama|Copiloto/i);
  });

  it('registers KB menu and plugin permissions without exposing a public endpoint', async () => {
    const plugin = await readProjectFile('integaglpi/src/Plugin.php');
    const setup = await readProjectFile('integaglpi/setup.php');
    const menu = await readProjectFile('integaglpi/src/KnowledgeBaseMenu.php');

    expect(plugin).toContain('getKnowledgeBaseUrl');
    expect(plugin).toContain('canKnowledgeBaseRead');
    expect(plugin).toContain('requireKnowledgeBaseUpdate');
    expect(setup).toContain('KnowledgeBaseMenu::class');
    expect(menu).toContain('Plugin::canKnowledgeBaseRead()');
  });
});
