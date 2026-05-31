<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use PHPUnit\Framework\TestCase;

final class CentralEntitySelectionStaticTest extends TestCase
{
    private function pluginPath(string $relative): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    }

    public function testCentralUsesControlledGlpiEntitySelect(): void
    {
        $template = (string) file_get_contents($this->pluginPath('templates/central.php'));

        self::assertStringContainsString('$glpiEntities', $template);
        self::assertStringContainsString('foreach ($glpiEntities as $entity)', $template);
        self::assertStringContainsString('name="glpi_entity_id"', $template);
        self::assertStringContainsString('js-integaglpi-entity-id', $template);
        self::assertStringNotContainsString('name="glpi_entity_name"', $template);
        self::assertStringNotContainsString("payload.set('glpi_entity_name'", $template);
        self::assertDoesNotMatchRegularExpression('/<input\\b[^>]*name=["\\\']glpi_entity_id["\\\']/i', $template);
    }

    public function testCentralActionAcceptsOnlyValidatedEntityIdField(): void
    {
        $action = (string) file_get_contents($this->pluginPath('front/central.action.php'));

        self::assertStringContainsString("\$_POST['glpi_entity_id'] ?? null", $action);
        self::assertStringContainsString('ctype_digit($trimmed)', $action);
        self::assertStringNotContainsString("\$_POST['entity_id']", $action);
        self::assertStringNotContainsString('glpi_entity_name', $action);
    }

    // ── Phase integaglpi_entity_memory_auto_reuse_and_override_001 ─────────

    public function testTemplateHasApplyMemoryEntityButton(): void
    {
        $template = (string) file_get_contents($this->pluginPath('templates/central.php'));

        // Button class exists in both PHP and JS views.
        self::assertStringContainsString('js-integaglpi-apply-memory-entity', $template);
        // Button uses data-entity-id (server-side integer), not a free-text name field.
        self::assertStringContainsString('data-entity-id=', $template);
        // The apply path does NOT use a glpi_entity_name input (server derives name).
        self::assertStringNotContainsString("data-entity-name-trusted", $template);
        // Button only appears when memory entity is valid (conditional guard present).
        self::assertMatchesRegularExpression('/memoryEntityId\s*>\s*0/', $template);
    }

    public function testApplyMemoryEntityJsPostsConfirmEntityAction(): void
    {
        $template = (string) file_get_contents($this->pluginPath('templates/central.php'));

        // JS handler posts action=confirm_entity.
        self::assertStringContainsString("action', 'confirm_entity'", $template);
        // Payload is built from data-entity-id attribute (integer), not a text input.
        self::assertStringContainsString('memoryApplyButton.dataset.entityId', $template);
        // entity_name is NOT sent in the memory-apply payload — server validates and derives it.
        self::assertStringNotContainsString("memPayload.set('glpi_entity_name'", $template);
    }

    public function testMemoryEntitySourceLabelIsDisplayed(): void
    {
        $template = (string) file_get_contents($this->pluginPath('templates/central.php'));

        // PHP view reads and displays the source label.
        self::assertStringContainsString('$memoryEntitySourceLabel', $template);
        self::assertStringContainsString('memory_entity_source_label', $template);
        // JS dynamic view also reads the source label from row data.
        self::assertStringContainsString('row.memory_entity_source_label', $template);
    }

    public function testAttendanceCenterServiceExposesEntitySourceLabel(): void
    {
        $service = (string) file_get_contents(
            $this->pluginPath('src/Service/AttendanceCenterService.php')
        );

        // resolveEntitySourceLabel() is defined and wired to decorateRows().
        self::assertStringContainsString('memory_entity_source_label', $service);
        self::assertStringContainsString('resolveEntitySourceLabel', $service);
        // Derived from entity_attempt_status (no extra SQL query required).
        self::assertStringContainsString('entity_attempt_status', $service);
        // Safe defaults: no new column created, no migration.
        self::assertStringNotContainsString('ALTER TABLE', $service);
    }

    // ── Phase central_visibility_required_fix ──────────────────────────────

    public function testRepositoryMineOnlyFilterBypassesPreTicketConversations(): void
    {
        $repo = (string) file_get_contents(
            $this->pluginPath('src/External/Repository/ConversationRepository.php')
        );

        // The mine_only SQL condition must include pre-ticket statuses via OR
        // so that awaiting_entity_selection conversations are not hidden.
        self::assertStringContainsString(
            "rt.assigned_user_id = :mine_only_user_id OR c.status IN ('awaiting_entity_selection', 'collecting_contact_profile', 'awaiting_queue_selection')",
            $repo
        );
        // The bypass must NOT be a plain equality-only condition (no OR).
        self::assertDoesNotMatchRegularExpression(
            "/\\\$where\[\]\s*=\s*'rt\.assigned_user_id\s*=\s*:mine_only_user_id'\s*;/",
            $repo
        );
        // The fix comment must reference the visibility requirement.
        self::assertStringContainsString('central_visibility_required_fix', $repo);
    }

    public function testRepositoryEntityIdFilterBypassesPreTicketNullEntity(): void
    {
        $repo = (string) file_get_contents(
            $this->pluginPath('src/External/Repository/ConversationRepository.php')
        );

        // The entity_id SQL condition must allow NULL/0 entity for pre-ticket statuses
        // so that awaiting_entity_selection conversations appear even when filtered by entity.
        self::assertStringContainsString(
            "c.glpi_entity_id = :entity_id OR (c.status IN ('awaiting_entity_selection', 'collecting_contact_profile', 'awaiting_queue_selection') AND (c.glpi_entity_id IS NULL OR c.glpi_entity_id = 0))",
            $repo
        );
        // The plain equality-only condition must not be present for the entity_id case.
        self::assertDoesNotMatchRegularExpression(
            "/\\\$where\[\]\s*=\s*'c\.glpi_entity_id\s*=\s*:entity_id'\s*;/",
            $repo
        );
    }

    public function testAttendanceCenterServiceDecoratesPreTicketNextAction(): void
    {
        $service = (string) file_get_contents(
            $this->pluginPath('src/Service/AttendanceCenterService.php')
        );

        // nextAction() must return a label for awaiting_entity_selection.
        self::assertStringContainsString("'awaiting_entity_selection'", $service);
        self::assertStringContainsString('Selecione a entidade para criar o chamado', $service);
        // can_confirm_entity must be computed in getCentralRefreshData.
        self::assertStringContainsString('can_confirm_entity', $service);
        self::assertStringContainsString("awaiting_entity_selection", $service);
    }

    public function testClaimRequiresRealEntityBeforeAttendance(): void
    {
        $service = (string) file_get_contents($this->pluginPath('src/Service/AttendanceCenterService.php'));
        $runtime = (string) file_get_contents($this->pluginPath('src/Service/TicketRuntimeService.php'));
        $template = (string) file_get_contents($this->pluginPath('templates/central.php'));

        self::assertStringContainsString('$entityId > 0', $service);
        self::assertStringContainsString('entity_required_before_claim', $service);
        self::assertStringContainsString('$entityId > 0', $template);
        self::assertStringContainsString('$entityPending', $runtime);
        self::assertStringContainsString('claim_block_reason', $runtime);
        self::assertStringContainsString('Defina uma entidade GLPI real antes de assumir este atendimento.', $runtime);
    }

    public function testCentralAppliesBackendPiiGuardBeforeRendering(): void
    {
        $service = (string) file_get_contents($this->pluginPath('src/Service/AttendanceCenterService.php'));
        $template = (string) file_get_contents($this->pluginPath('templates/central.php'));

        self::assertStringContainsString('applyPiiGuard', $service);
        self::assertStringContainsString('SecurityPermissionService::RIGHT_VIEW_UNMASKED_PII', $service);
        self::assertStringContainsString('SecurityAuditService::logPiiUnmaskedView', $service);
        self::assertStringContainsString("\$row['phone_e164'] = \$maskedPhone", $service);
        self::assertStringContainsString("\$row['profile_context']['email'] = \$maskedEmail", $service);
        self::assertStringContainsString("!empty(\$row['pii_unmasked']) ? \$phone : \$maskedPhone", $template);
    }
}
