import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(process.cwd(), '..');
const ticketTabPath = join(repoRoot, 'integaglpi', 'templates', 'ticket_tab.php');
const replyEndpointPath = join(repoRoot, 'integaglpi', 'front', 'ticket.whatsapp.reply.php');
const ticketRuntimePath = join(repoRoot, 'integaglpi', 'src', 'TicketRuntime.php');

describe('PHP WhatsApp ticket tab attachments', () => {
  it('renders an optional file input and posts multipart FormData', async () => {
    const source = await readFile(ticketTabPath, 'utf8');

    expect(source).toContain('js-integaglpi-tab-reply-file');
    expect(source).toContain('accept="application/pdf,image/jpeg,image/png,image/gif"');
    expect(source).toContain('new FormData()');
    expect(source).toContain("payload.set('reply_file', file)");
    expect(source).not.toContain("'Content-Type': 'application/x-www-form-urlencoded'");
  });

  it('keeps Conversas WhatsApp and Contexto WhatsApp as distinct ticket tabs', async () => {
    const template = await readFile(ticketTabPath, 'utf8');
    const runtime = await readFile(ticketRuntimePath, 'utf8');

    expect(runtime).toContain("__('Conversas WhatsApp'");
    expect(runtime).toContain("__('Contexto WhatsApp'");
    expect(runtime).toContain("'conversations'");
    expect(runtime).toContain("'context'");
    expect(template).toContain("$tabView === 'conversations'");
    expect(template).toContain("$tabView === 'context'");
    expect(template).toContain('js-integaglpi-tab-reply-file');
    expect(template).toContain('Correlation ID');
  });

  it('builds a real outbound media payload without logging file content', async () => {
    const source = await readFile(replyEndpointPath, 'utf8');

    expect(source).toContain('integaglpiBuildReplyMediaPayload');
    expect(source).toContain("'content_base64' => base64_encode($content)");
    expect(source).toContain("'message_type'    => $media !== null");
    expect(source).toContain("['application/pdf', 'image/jpeg', 'image/png', 'image/gif']");
    expect(source).not.toContain('X-Integaglpi-Api-Key');
  });
});
