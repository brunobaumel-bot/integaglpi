<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use Throwable;

/**
 * Read-only catalog of native GLPI Forms (glpi_forms_forms).
 *
 * Designed to be called by the Node GlpiFormCatalogAdapter via the
 * integaglpi/front/form.catalog.php endpoint. Never writes to any table.
 * Never accesses the PostgreSQL integration DB.
 *
 * PHASE: integaglpi_v8_service_catalog_gap_fix_and_bridge_001
 */
final class FormCatalogService
{
    private const TABLE = 'glpi_forms_forms';

    /**
     * Returns active, non-deleted, non-draft Forms visible in the given entity scope.
     *
     * When $entitiesId === 0, returns Forms from all entities (no entity filter).
     * The returned `name` field is HTML-escaped to prevent XSS if output is used
     * in a browser context; Node consumers should decode it before display.
     *
     * @return array<int, array{id: int, name: string, entities_id: int}>
     */
    public function getActiveFormsByEntity(int $entitiesId = 0): array
    {
        global $DB;

        if (!$this->tableExists(self::TABLE)) {
            return [];
        }

        $criteria = [
            'SELECT' => ['id', 'name', 'entities_id'],
            'FROM'   => self::TABLE,
            'WHERE'  => [
                'is_active'  => 1,
                'is_deleted' => 0,
                'is_draft'   => 0,
            ],
            'ORDER'  => 'name ASC',
        ];

        if ($entitiesId > 0) {
            $criteria['WHERE']['entities_id'] = $entitiesId;
        }

        $forms = [];
        try {
            foreach ($DB->request($criteria) as $row) {
                $forms[] = [
                    'id'          => (int)  $row['id'],
                    'name'        => htmlspecialchars((string) ($row['name'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8'),
                    'entities_id' => (int)  $row['entities_id'],
                ];
            }
        } catch (Throwable) {
            return [];
        }

        return $forms;
    }

    private function tableExists(string $table): bool
    {
        global $DB;
        try {
            return (bool) $DB->tableExists($table);
        } catch (Throwable) {
            return false;
        }
    }
}
