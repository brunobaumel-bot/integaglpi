import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(process.cwd(), '..');
const notificationServicePath = join(repoRoot, 'integaglpi', 'src', 'Service', 'NotificationService.php');

async function readNotificationService(): Promise<string> {
  return await readFile(notificationServicePath, 'utf8');
}

describe('PHP solved-ticket notification source', () => {
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
});
