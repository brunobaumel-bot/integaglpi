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
}
