import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(process.cwd(), '..');
const notificationServicePath = join(repoRoot, 'integaglpi', 'src', 'Service', 'NotificationService.php');
const hookPath = join(repoRoot, 'integaglpi', 'hook.php');

async function readNotificationService(): Promise<string> {
  return await readFile(notificationServicePath, 'utf8');
}

describe('PHP solved-ticket notification source', () => {
  it('keys technician assignment notification by ownership transition', async () => {
    const notification = await readNotificationService();
    const runtime = await readFile(join(repoRoot, 'integaglpi', 'src', 'Service', 'TicketRuntimeService.php'), 'utf8');
    const central = await readFile(join(repoRoot, 'integaglpi', 'src', 'Service', 'AttendanceCenterService.php'), 'utf8');

    expect(notification).toContain('?int $previousTechnicianId = null');
    expect(notification).toContain('$previousKeyPart');
    expect(notification).toContain("'notify_ticket_assigned_' . $ticketId . '_' . $conversationId . '_' . $previousKeyPart . '_' . $technicianId");
    // Line-ending agnostic (\r?\n): o checkout Windows usa CRLF nos PHP e a
    // expectativa com \n literal falhava de forma ambiental, não funcional.
    expect(runtime).toMatch(/\$conversationId,\r?\n\s+\$previousAssignedUserId/);
    expect(central).toMatch(/\$conversationId,\r?\n\s+\$previousAssignedUserId/);
  });

  it('selects the latest pending ticket solution instead of an older processed solution', async () => {
    const source = await readNotificationService();

    expect(source).toContain('private function findPendingTicketSolution');
    expect(source).toContain('FROM `glpi_itilsolutions`');
    expect(source).toContain("WHERE `itemtype` = 'Ticket'");
    expect(source).toContain('AND `items_id` = ');
    expect(source).toContain('AND `status` = 2');
    expect(source).toContain('AND `date_approval` IS NULL');
    expect(source).toContain('AND `users_id_approval` = 0');
    expect(source).toContain('ORDER BY `id` DESC');
  });

  it('uses the pending solution id in the solved-notification idempotency key', async () => {
    const source = await readNotificationService();

    expect(source).toContain("'notify_ticket_solved_' . $ticketId . '_' . $resolvedSolutionId");
    expect(source).toContain("'solution_id' => $resolvedSolutionId");
    expect(source).toContain("'solution_content' => $solutionText");
  });

  it('keeps the interactive solved-notification fallback when no pending solution exists', async () => {
    const source = await readNotificationService();
    const noPendingBlock = source.slice(
      source.indexOf("if ($solution === null)"),
      source.indexOf('$resolvedSolutionId = isset'),
    );

    expect(noPendingBlock).toContain('skip_no_pending_solution');
    expect(noPendingBlock).toContain("'notify_ticket_solved_' . $ticketId");
    expect(noPendingBlock).toContain('true');
  });

  it('skips public followup notifications when the followup is the pending solution content', async () => {
    const source = await readNotificationService();

    expect(source).toContain('matchesPendingSolutionContent');
    expect(source).toContain('followup][skip_solution_content');
    expect(source).toContain('hash_equals($solutionText, $followupText)');
  });

  it('sends ticket attachments as outbound media when a supported GLPI document is readable', async () => {
    const source = await readNotificationService();

    expect(source).toContain('buildDocumentOutboundPayload');
    expect(source).toContain("'message_type' => $messageType");
    expect(source).toContain("'content_base64' => base64_encode($content)");
    expect(source).toContain('EVENT_TICKET_DOCUMENT_ADDED');
    expect(source).toContain("if (!isset($payload['message_type']))");
  });

  it('uses an honest fallback when a ticket attachment cannot be sent as media', async () => {
    const source = await readNotificationService();

    expect(source).toContain('Não consegui enviar o anexo pelo WhatsApp. Acesse o GLPI para visualizar o arquivo.');
    expect(source).toContain('porque o arquivo excede o limite permitido');
    expect(source).toContain('Formato de arquivo não suportado para envio via WhatsApp.');
    expect(source).toContain('$mediaPayload !== null');
  });

  it('allows manual ticket document links but skips REST-created inbound media links', async () => {
    const source = await readFile(hookPath, 'utf8');

    expect(source).toContain("$itemtype === \\Ticket::class || $itemtype === 'Ticket'");
    expect(source).toContain("str_contains($requestUri, '/apirest.php')");
    expect(source).toContain('do not echo it back');
    expect(source).toContain('$ticketId = $itemsId;');
  });
});
