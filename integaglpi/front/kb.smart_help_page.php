<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

/**
 * KB Smart Help — standalone page accessible from the plugin menu.
 *
 * Loads the kb_smart_help_widget.php template.
 * GLPI session required. Read access required.
 * Cloud AI blocked. No auto-send. No ticket mutation.
 *
 * Optional GET params:
 *   ?ticket_id=NNN   Pre-fill with ticket context (read-only).
 *
 * Phase: integaglpi_local_kb_rag_technician_copilot_001
 */

Session::checkLoginUser();
Plugin::requireRead();

$pluginBasePath = Plugin::getWebBasePath();
$ticketId       = isset($_GET['ticket_id']) ? (int) $_GET['ticket_id'] : null;
$ticketTitle    = '';
$ticketDesc     = '';

// Pre-fill from ticket if provided (read-only, sanitized, no PII expansion)
if ($ticketId !== null && $ticketId > 0) {
    $ticket = new Ticket();
    if ($ticket->getFromDB($ticketId) && $ticket->can($ticketId, READ)) {
        $ticketTitle = mb_substr(strip_tags((string) $ticket->fields['name']), 0, 200, 'UTF-8');
        $ticketDesc  = mb_substr(strip_tags((string) $ticket->fields['content']), 0, 600, 'UTF-8');
    } else {
        $ticketId = null; // No access or not found
    }
}

Html::header(__('Busca Inteligente na KB', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins');

// Template variables
$csrfToken    = Session::getNewCSRFToken();
$smartHelpUrl = $pluginBasePath . '/front/kb.smart_help.php';
// KB feedback goes through the PHP proxy endpoint
$kbFeedbackUrl = $pluginBasePath . '/front/kb.feedback.php';
// Private note endpoint (is_private=1, human click only — kb.add_note.php enforces is_private server-side)
$addNoteUrl = $pluginBasePath . '/front/kb.add_note.php';

include dirname(__DIR__) . '/templates/kb_smart_help_widget.php';

Html::footer();
