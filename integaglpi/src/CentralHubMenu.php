<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * CentralHubMenu — F3 Central Hub Operacional
 *
 * Menu entry under the Supervisão group.
 * Gated by canSupervisorRead() — same permission as other operational views.
 *
 * Safety invariants (F3 contract):
 *   - Read-only: no ticket, no WhatsApp, no remote action.
 *   - No PII exposed in menu registration.
 *   - CENTRAL_HUB_ENABLED=false is handled at render level in the view service.
 *
 * Phase: integaglpi_v9_central_hub_001 — F3_7
 */
final class CentralHubMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Hub Operacional', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Hub Operacional', 'glpiintegaglpi');
    }

    public static function getIcon(): string
    {
        return 'ti ti-layout-grid';
    }

    public static function canView(): bool
    {
        return Plugin::canSupervisorRead();
    }
}
