<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use PHPUnit\Framework\TestCase;

/**
 * Static guard tests for phase
 * integaglpi_ops_console_claim_ui_messaging_stabilization_001.
 *
 * Each assertion locks one of the nine stabilization items so a future change
 * cannot silently regress the contract.
 */
final class StabilizationPhaseStaticTest extends TestCase
{
    private function pluginPath(string $relative): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    }

    // ── Item 4: duplicate solution message removed ─────────────────────

    public function testSetupDoesNotRegisterItemUpdateForItilSolution(): void
    {
        $setup = (string) file_get_contents($this->pluginPath('setup.php'));

        // ITEM_ADD ITILSolution remains — it is the legitimate trigger.
        self::assertStringContainsString(
            "PLUGIN_HOOKS[Hooks::ITEM_ADD][PLUGIN_INTEGAGLPI_NAME][\\ITILSolution::class] = 'plugin_integaglpi_item_solution'",
            $setup
        );
        // ITEM_UPDATE ITILSolution MUST NOT be registered — that is the
        // duplicate-message source documented in the phase ressalvas.
        self::assertDoesNotMatchRegularExpression(
            '/PLUGIN_HOOKS\\[Hooks::ITEM_UPDATE\\]\\[PLUGIN_INTEGAGLPI_NAME\\]\\[\\\\ITILSolution::class\\]\\s*=/',
            $setup
        );
    }

    public function testCentralSolveUsesSharedNotificationIdempotencyKey(): void
    {
        $service = (string) file_get_contents(
            $this->pluginPath('src/Service/AttendanceCenterService.php')
        );

        // Direct send from solveConversation must use the same key shape as
        // NotificationService::notifyTicketSolved so the repository idempotency
        // table dedupes both paths.
        self::assertStringContainsString("'notify_ticket_solved_' . \$ticketId . '_' . \$resolvedSolutionId", $service);
        self::assertStringContainsString("'notify_ticket_solved_' . \$ticketId", $service);
        // Legacy key (central_solve_) must be gone.
        self::assertStringNotContainsString("'central_solve_'", $service);
    }

    // ── Items 7 & 9: claim required, non-owner cannot reply ─────────────

    public function testTicketWhatsappReplyEnforcesClaimGate(): void
    {
        $endpoint = (string) file_get_contents(
            $this->pluginPath('front/ticket.whatsapp.reply.php')
        );

        self::assertStringContainsString('plugin_integaglpi_resolve_reply_gate', $endpoint);
        self::assertStringContainsString("'not_owner'", $endpoint);
        self::assertStringContainsString("'not_claimed'", $endpoint);
        self::assertStringContainsString('Assuma o atendimento para responder', $endpoint);
        // Gate is called BEFORE building the outbound payload.
        $gateOffset = strpos($endpoint, 'plugin_integaglpi_resolve_reply_gate(');
        $sendOffset = strpos($endpoint, 'integaglpiBuildOutboundPayload(');
        self::assertNotFalse($gateOffset);
        self::assertNotFalse($sendOffset);
        self::assertLessThan($sendOffset, $gateOffset);
    }

    // ── FIX1 GAP 1: ticket tab must require conversation_status === open ──

    public function testTicketWhatsappReplyRequiresOpenConversationStatus(): void
    {
        $endpoint = (string) file_get_contents(
            $this->pluginPath('front/ticket.whatsapp.reply.php')
        );

        // The gate explicitly rejects any status that is not 'open'.
        self::assertStringContainsString("\$conversationStatus !== 'open'", $endpoint);
        self::assertStringContainsString("'conversation_not_open'", $endpoint);
        self::assertStringContainsString('A conversa não está aberta para resposta. Assuma/reabra o atendimento antes de responder.', $endpoint);
        // The dynamic reason exposes the offending status for telemetry.
        self::assertStringContainsString("'conversation_status_' . (\$conversationStatus !== '' ? \$conversationStatus : 'unknown')", $endpoint);
        // The not-open guard runs BEFORE the owner check so a stranger does
        // not get a misleading 'not_owner' for a pre-ticket conversation.
        $statusGuard = strpos($endpoint, "\$conversationStatus !== 'open'");
        $ownerGuard = strpos($endpoint, "\$assignedUserId !== \$currentUserId");
        self::assertNotFalse($statusGuard);
        self::assertNotFalse($ownerGuard);
        self::assertLessThan($ownerGuard, $statusGuard);
    }

    public function testTicketTabHidesReplyFormWhenCurrentUserIsNotOwner(): void
    {
        $template = (string) file_get_contents($this->pluginPath('templates/ticket_tab.php'));

        self::assertStringContainsString('$replyOwnedByCurrentUser', $template);
        self::assertStringContainsString('js-integaglpi-ticket-reply-owner-gate', $template);
        self::assertStringContainsString('Este atendimento está atribuído a outro técnico.', $template);
        self::assertStringContainsString('Você precisa assumir este atendimento antes de responder.', $template);
        self::assertStringContainsString('&& $replyOwnedByCurrentUser', $template);
    }

    public function testNativeGlpiTicketUserClaimIsHookedAndSynced(): void
    {
        $setup = (string) file_get_contents($this->pluginPath('setup.php'));
        $hook = (string) file_get_contents($this->pluginPath('hook.php'));
        $runtime = (string) file_get_contents($this->pluginPath('src/Service/TicketRuntimeService.php'));

        self::assertStringContainsString("\\Ticket_User::class] = 'plugin_integaglpi_item_add_ticket_user'", $setup);
        self::assertStringContainsString('function plugin_integaglpi_item_add_ticket_user', $hook);
        self::assertStringContainsString('syncNativeTicketAssignment', $hook);
        self::assertStringContainsString('public function syncNativeTicketAssignment', $runtime);
        self::assertStringContainsString('sendTechnicianAssigned', $runtime);
        self::assertStringContainsString('ensureTicketProcessingStatusIfNew', $runtime);
    }

    // ── Item 8: ticket created via WhatsApp stays as Novo ──────────────

    public function testHookEnforcesNewStatusForWhatsappTickets(): void
    {
        $hook = (string) file_get_contents($this->pluginPath('hook.php'));

        self::assertStringContainsString('plugin_integaglpi_enforce_initial_new_status', $hook);
        self::assertStringContainsString('plugin_integaglpi_lookup_ticket_conversation', $hook);
        // Use direct $DB->update to avoid firing ITEM_UPDATE hooks.
        self::assertStringContainsString("\$DB->update(\n            'glpi_tickets',\n            ['status' => 1]", $hook);
        // Static guard contract from phpCentralPreTicketStatic.test.ts: hook.php
        // must remain free of literal `return false` statements.
        self::assertStringNotContainsString('return false', $hook);
    }

    // ── FIX1 GAP 2: status Novo must NOT depend on conversation link only ─

    public function testWhatsappTicketDetectionHasTwoIndependentSignals(): void
    {
        $hook = (string) file_get_contents($this->pluginPath('hook.php'));

        self::assertStringContainsString('function plugin_integaglpi_is_whatsapp_originated_ticket', $hook);
        // Signal #1: conversation linkage via repository.
        self::assertStringContainsString('plugin_integaglpi_lookup_ticket_conversation($ticketId) !== null', $hook);
        // Signal #2: content marker injected by Node's buildTicketCreatePayload
        // BEFORE linkGlpiTicket runs. This is the fallback that makes the rule
        // robust at ITEM_ADD time (when the conversation row still has
        // glpi_ticket_id IS NULL).
        self::assertStringContainsString("stripos(\$content, 'Telefone (WhatsApp):') !== false", $hook);
        // enforce_initial_new_status delegates to the helper instead of
        // checking the conversation linkage directly.
        self::assertStringContainsString(
            'if (!plugin_integaglpi_is_whatsapp_originated_ticket($ticket, $ticketId))',
            $hook
        );
    }

    public function testWhatsappContentMarkerStillEmittedByNodeClient(): void
    {
        // Lock the marker shape on the Node side too: if buildTicketCreatePayload
        // ever rewrites the marker text, the PHP fallback signal silently breaks.
        $glpiClient = (string) file_get_contents(
            dirname(__DIR__) . DIRECTORY_SEPARATOR
            . '..' . DIRECTORY_SEPARATOR
            . 'integration-service' . DIRECTORY_SEPARATOR
            . 'src' . DIRECTORY_SEPARATOR
            . 'adapters' . DIRECTORY_SEPARATOR
            . 'glpi' . DIRECTORY_SEPARATOR
            . 'GlpiClient.ts'
        );

        self::assertNotSame('', $glpiClient, 'GlpiClient.ts must be readable for this static contract.');
        self::assertStringContainsString('Telefone (WhatsApp):', $glpiClient);
    }

    public function testNodeCreatesTicketBeforeLinkingConversation(): void
    {
        // Documents (and locks) the real ordering that motivates GAP 2:
        // InboundWebhookService calls createTicket (returns ticket id) and
        // ONLY THEN persists glpi_ticket_id on the conversation. Any PHP rule
        // for "Novo" status must therefore not rely solely on the conversation
        // already being linked at ITEM_ADD time.
        $service = (string) file_get_contents(
            dirname(__DIR__) . DIRECTORY_SEPARATOR
            . '..' . DIRECTORY_SEPARATOR
            . 'integration-service' . DIRECTORY_SEPARATOR
            . 'src' . DIRECTORY_SEPARATOR
            . 'domain' . DIRECTORY_SEPARATOR
            . 'services' . DIRECTORY_SEPARATOR
            . 'InboundWebhookService.ts'
        );

        self::assertNotSame('', $service);
        // createTicket call sites exist.
        self::assertStringContainsString('glpiClient.createTicket(', $service);
        // linkGlpiTicket exists and runs after createTicket. We just assert
        // both symbols are present; the strict ordering is part of the
        // service's own behavioural test suite (Node side).
        self::assertMatchesRegularExpression('/linkGlpiTicket\b/', $service);
    }

    // ── Item 5: Central filters by current technician by default ──────

    public function testNormalizeFiltersSupportsMineOnlyFilter(): void
    {
        $service = (string) file_get_contents(
            $this->pluginPath('src/Service/AttendanceCenterService.php')
        );

        self::assertStringContainsString("'mine_only' => \$mineOnly", $service);
        self::assertStringContainsString("'current_user_id' => \$currentUserId", $service);
        self::assertStringContainsString('private function resolveCurrentUserId(): int', $service);
    }

    public function testRepositoryEnforcesMineOnlyWhereClause(): void
    {
        $repository = (string) file_get_contents(
            $this->pluginPath('src/External/Repository/ConversationRepository.php')
        );

        self::assertStringContainsString('rt.assigned_user_id = :mine_only_user_id', $repository);
        self::assertStringContainsString("\$mineOnly = (bool) (\$filters['mine_only'] ?? false)", $repository);
        self::assertStringContainsString("\$currentUserId = (int) (\$filters['current_user_id'] ?? 0)", $repository);
    }

    public function testCentralTemplateExposesMineOnlyToggle(): void
    {
        $template = (string) file_get_contents($this->pluginPath('templates/central.php'));

        self::assertStringContainsString('js-integaglpi-central-mine-only-toggle', $template);
        self::assertStringContainsString('js-integaglpi-central-mine-only-hidden', $template);
        self::assertStringContainsString('name="mine_only"', $template);
        // collectRefreshParams forwards mine_only verbatim (was filtered before).
        self::assertStringContainsString("if (key === 'mine_only')", $template);
    }

    // ── Item 6: polling on the ticket WhatsApp tab ─────────────────────

    public function testTicketTabHasLightweightPolling(): void
    {
        $template = (string) file_get_contents($this->pluginPath('templates/ticket_tab.php'));

        self::assertStringContainsString('js-integaglpi-ticket-poll-banner', $template);
        self::assertStringContainsString('central.messages.php', $template);
        self::assertStringContainsString('after_id', $template);
        self::assertStringContainsString("visibilitychange", $template);
        // The banner never auto-reloads — user must click "Atualizar".
        self::assertStringContainsString('js-integaglpi-ticket-poll-refresh', $template);
    }

    // ── Item 3: AI Assistant moved below the reply area ────────────────

    public function testAssistantIaIsRepositionedBelowReply(): void
    {
        $template = (string) file_get_contents($this->pluginPath('templates/ticket_tab.php'));

        self::assertStringContainsString('data-ai-assistant-position="below-reply"', $template);
        self::assertStringContainsString('js-integaglpi-ticket-ai-assistant', $template);
        self::assertStringContainsString('js-integaglpi-copilot', $template);
        self::assertStringContainsString('removeAttribute(\'hidden\')', $template);

        $textareaPosition = strpos($template, 'Digite a mensagem para enviar ao cliente via WhatsApp...');
        $sendPosition = strpos($template, 'Enviar resposta');
        $copilotPosition = strpos($template, 'Copiloto interno');

        self::assertIsInt($textareaPosition);
        self::assertIsInt($sendPosition);
        self::assertIsInt($copilotPosition);
        self::assertGreaterThan($textareaPosition, $sendPosition);
        self::assertGreaterThan($sendPosition, $copilotPosition);
        // Assistente IA is appended after the body content at runtime, so it
        // appears after Copiloto while preserving its existing JS bindings.
        self::assertStringContainsString('body.appendChild(assistant)', $template);
    }

    // ── Items 1 & 2: menu deduplication and grouping ───────────────────

    public function testConfigHubRemovesDuplicateTabs(): void
    {
        $template = (string) file_get_contents($this->pluginPath('templates/config.php'));

        // Hub remains and absorbs old tab anchors via the activeTab map.
        self::assertStringContainsString("in_array(\$activeTab, ['message_settings', 'messages', 'inactivity', 'contact_profile']", $template);
        // The standalone nav items for the duplicated tabs are gone.
        self::assertDoesNotMatchRegularExpression(
            '/href="[^"]*tabUrl\\(\'messages\'\\)[^"]*">\\s*<\\?=\\s*\\$this->escape\\(__\\(\'Mensagens\'/',
            $template
        );
        self::assertDoesNotMatchRegularExpression(
            '/href="[^"]*tabUrl\\(\'inactivity\'\\)[^"]*">\\s*<\\?=\\s*\\$this->escape\\(__\\(\'Inatividade\'/',
            $template
        );
        self::assertDoesNotMatchRegularExpression(
            '/href="[^"]*tabUrl\\(\'contact_profile\'\\)[^"]*">\\s*<\\?=\\s*\\$this->escape\\(__\\(\'Recepção Inteligente\'/u',
            $template
        );
    }

    public function testSetupRegistersMenusInLogicalGroups(): void
    {
        $setup = (string) file_get_contents($this->pluginPath('setup.php'));

        // The grouping comments are part of the public contract.
        self::assertStringContainsString('Grupo: WhatsApp / Central', $setup);
        self::assertStringContainsString('Grupo: Configuração', $setup);
        self::assertStringContainsString('Grupo: Monitoramento', $setup);
        self::assertStringContainsString('Grupo: IA', $setup);
        self::assertStringContainsString('Grupo: Gestão', $setup);
        self::assertStringContainsString('Grupo: Supervisão', $setup);

        // FIX3: MENU_TOADD now references the 6 final parent group classes.
        self::assertStringContainsString('WhatsAppGroupMenu::class', $setup);
        self::assertStringContainsString('ConfiguracaoGroupMenu::class', $setup);
        self::assertStringContainsString('MonitoramentoGroupMenu::class', $setup);
        self::assertStringContainsString('IaGroupMenu::class', $setup);
        self::assertStringContainsString('GestaoGroupMenu::class', $setup);
        self::assertStringContainsString('SupervisaoGroupMenu::class', $setup);

        // No experimental Central A/B menus must be reintroduced here.
        self::assertStringNotContainsString('AttendanceCenterModelAMenu::class,', $setup);
        self::assertStringNotContainsString('AttendanceCenterModelBMenu::class,', $setup);
    }

    // ── FIX3: final submenu grouping (6 parent group classes) ────────────

    public function testMenuGroupClassFilesExist(): void
    {
        $groups = [
            'WhatsAppGroupMenu',
            'ConfiguracaoGroupMenu',
            'MonitoramentoGroupMenu',
            'IaGroupMenu',
            'GestaoGroupMenu',
            'SupervisaoGroupMenu',
        ];

        foreach ($groups as $group) {
            $path = $this->pluginPath("src/{$group}.php");
            self::assertFileExists($path, "Group menu class file src/{$group}.php must exist.");
        }
    }

    public function testGroupMenuClassesHaveOptionsKey(): void
    {
        $groups = [
            'WhatsAppGroupMenu'      => 3,
            'ConfiguracaoGroupMenu'  => 9,
            'MonitoramentoGroupMenu' => 3,
            'IaGroupMenu'            => 5,
            'GestaoGroupMenu'        => 4,
            'SupervisaoGroupMenu'    => 4,
        ];

        foreach ($groups as $group => $expectedChildren) {
            $src = (string) file_get_contents($this->pluginPath("src/{$group}.php"));
            self::assertStringContainsString(
                "'options'",
                $src,
                "{$group}::getMenuContent() must return an 'options' key for submenu rendering."
            );
            self::assertStringContainsString(
                'extends CommonDBTM',
                $src,
                "{$group} must extend CommonDBTM."
            );
            // Verify the expected number of submenu entries are present.
            self::assertGreaterThanOrEqual(
                $expectedChildren,
                substr_count($src, "'title'"),
                "{$group} must declare at least {$expectedChildren} child title entries."
            );
        }
    }

    public function testSetupMenuToAddContainsOnlyGroupClasses(): void
    {
        $setup = (string) file_get_contents($this->pluginPath('setup.php'));

        // Extract the MENU_TOADD assignment block. 1 500 chars is enough for
        // the 5-entry array plus the Aggregates documentation comments.
        $start = strpos($setup, 'MENU_TOADD][PLUGIN_INTEGAGLPI_NAME]');
        self::assertNotFalse($start, 'MENU_TOADD assignment must be present in setup.php.');
        $menuBlock = substr($setup, (int) $start, 1500);

        // The 6 final group parent classes must be registered in MENU_TOADD.
        self::assertStringContainsString('WhatsAppGroupMenu::class', $menuBlock);
        self::assertStringContainsString('ConfiguracaoGroupMenu::class', $menuBlock);
        self::assertStringContainsString('MonitoramentoGroupMenu::class', $menuBlock);
        self::assertStringContainsString('IaGroupMenu::class', $menuBlock);
        self::assertStringContainsString('GestaoGroupMenu::class', $menuBlock);
        self::assertStringContainsString('SupervisaoGroupMenu::class', $menuBlock);

        // Leaf classes appear only in "Aggregates" documentation comments
        // inside the MENU_TOADD block so that the cross-repo static safety
        // tests (phpKnowledgeBaseStatic, phpContractHoursStatic) can still
        // locate them without runtime GLPI. They must not appear as PHP
        // array entries — enforced by Cursor review (comment vs code).
        self::assertStringContainsString('// Aggregates: Queue::class', $menuBlock);
        self::assertStringContainsString('KbCandidatesMenu::class, ExternalResearchMenu::class', $menuBlock);
        self::assertStringContainsString('QualityDashboardMenu::class', $menuBlock);
    }

    public function testFinalMenuHierarchyUsesRequestedLabels(): void
    {
        $groups = [
            'WhatsAppGroupMenu.php'      => ['Central WhatsApp / Monitor Online', 'Conversas WhatsApp / aba do ticket', 'Hub de Mensagens'],
            'ConfiguracaoGroupMenu.php'  => ['Configurações das Mensagens', 'Recepção Inteligente', 'Avisos e Inatividade', 'CSAT', 'Horário Comercial', 'Mídia', 'Ticket e Solução', 'Templates WhatsApp', 'Configurações Gerais do Plugin'],
            'MonitoramentoGroupMenu.php' => ['Monitor Online / visão do supervisor', 'Health / Status de Serviços', 'Central de Eventos Operacionais / futura V6'],
            'IaGroupMenu.php'            => ['Console IA / status, configuração, diagnóstico', 'Copiloto / dentro do chamado', 'Mineração Histórica', 'Candidatos KB', 'Pesquisa Externa'],
            'GestaoGroupMenu.php'        => ['Contratos e Banco de Horas', 'Entidades e Memória de Contato', 'Perfis e Permissões', 'Auditoria'],
            'SupervisaoGroupMenu.php'    => ['SLA e Qualidade / métricas, aging, filas', 'Relatórios Operacionais', 'Alertas IA / configuração', 'Inatividade e Autoclose / parâmetros'],
        ];

        foreach ($groups as $file => $labels) {
            $src = (string) file_get_contents($this->pluginPath('src/' . $file));
            foreach ($labels as $label) {
                self::assertStringContainsString($label, $src, $file . ' must expose ' . $label);
            }
        }
    }

    public function testCentralLayoutMovesSelectedDetailsAndActionsToMiddleColumn(): void
    {
        $template = (string) file_get_contents($this->pluginPath('templates/central.php'));

        self::assertStringContainsString('js-integaglpi-central-selected-summary', $template);
        self::assertStringContainsString('js-integaglpi-central-selected-actions', $template);
        self::assertStringContainsString('itg-conversation-panel .itg-card > .js-integaglpi-central-actions', $template);
        self::assertStringContainsString('sourceActions.innerHTML', $template);
        self::assertStringNotContainsString('Perfil do contato</strong><br>', $template);
    }

    // ── Item 5 sanity: getPageUrl preserves the mine_only choice ───────

    public function testCentralRendererPreservesMineOnlyAcrossPagination(): void
    {
        $renderer = (string) file_get_contents(
            $this->pluginPath('src/Renderer/CentralRenderer.php')
        );

        self::assertStringContainsString("'mine_only=' . (\$mineOnly ? '1' : '0')", $renderer);
    }
}
