<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * Menu entry for LogMeIn Alarm Rules administration.
 * Registered under the Monitoramento group in GLPI sidebar.
 *
 * RBAC: requires plugin_integaglpi UPDATE right (same as other admin pages).
 * PHASE: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
 */
final class LogmeinAlarmMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Alarmes LogMeIn', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Alarmes LogMeIn', 'glpiintegaglpi');
    }

    public static function getIcon(): string
    {
        return 'ti ti-bell-ringing';
    }

    public static function canView(): bool
    {
        return Plugin::canRead();
    }

    public static function canCreate(): bool
    {
        return Plugin::canWrite();
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        if (!self::canView()) {
            return [];
        }

        return [
            'title' => self::getMenuName(),
            'page'  => Plugin::getWebDir(true) . '/front/logmein.alarm.php',
            'icon'  => self::getIcon(),
        ];
    }
}
