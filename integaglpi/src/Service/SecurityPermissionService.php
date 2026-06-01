<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use Config;
use GlpiPlugin\Integaglpi\Plugin;
use Session;
use Throwable;

final class SecurityPermissionService
{
    public const ROLE_TECNICO   = 'tecnico';
    public const ROLE_SUPERVISAO = 'supervisao';
    public const ROLE_DIRECAO    = 'direcao';
    public const ROLE_UNKNOWN    = 'unknown';

    public const RIGHT_VIEW_CENTRAL                  = 'view_central';
    public const RIGHT_VIEW_OWN_QUEUE                = 'view_own_queue';
    public const RIGHT_VIEW_ALL_QUEUES               = 'view_all_queues';
    public const RIGHT_CLAIM_TICKET                  = 'claim_ticket';
    public const RIGHT_REPLY_OWNED_TICKET            = 'reply_owned_ticket';
    public const RIGHT_REPLY_ANY_TICKET              = 'reply_any_ticket';
    public const RIGHT_TRANSFER_TICKET               = 'transfer_ticket';
    public const RIGHT_SOLVE_OWNED_TICKET            = 'solve_owned_ticket';
    public const RIGHT_SOLVE_TICKET                  = 'solve_ticket';
    public const RIGHT_ADMINISTRATIVE_CLOSE          = 'administrative_close';
    public const RIGHT_SELECT_ENTITY                 = 'select_entity';
    public const RIGHT_OVERRIDE_ENTITY_MEMORY        = 'override_entity_memory';
    public const RIGHT_MANAGE_MESSAGE_SETTINGS       = 'manage_message_settings';
    public const RIGHT_MANAGE_TEMPLATES              = 'manage_templates';
    public const RIGHT_VIEW_AI_CONSOLE               = 'view_ai_console';
    public const RIGHT_USE_COPILOT_AS_DRAFT          = 'use_copilot_as_draft';
    public const RIGHT_MANAGE_AI_SETTINGS            = 'manage_ai_settings';
    public const RIGHT_MANAGE_AI_SECRETS             = 'manage_ai_secrets';
    public const RIGHT_VIEW_AI_ALERTS                = 'view_ai_alerts';
    public const RIGHT_REVIEW_AI_ALERTS              = 'review_ai_alerts';
    public const RIGHT_VIEW_KB_REFERENCE             = 'view_kb_reference';
    public const RIGHT_REVIEW_KB_CANDIDATES          = 'review_kb_candidates';
    public const RIGHT_VIEW_EXTERNAL_RESEARCH        = 'view_external_research';
    public const RIGHT_RUN_EXTERNAL_RESEARCH         = 'run_external_research_controlled';
    public const RIGHT_VIEW_AUDIT_OPERATIONAL        = 'view_audit_operational';
    public const RIGHT_VIEW_AUDIT_READONLY_SANITIZED = 'view_audit_readonly_sanitized';
    public const RIGHT_EXPORT_OPERATIONAL_REPORTS    = 'export_operational_reports';
    public const RIGHT_EXPORT_EXECUTIVE_REPORTS      = 'export_executive_reports';
    public const RIGHT_VIEW_CONTRACTS_READONLY       = 'view_contracts_readonly';
    public const RIGHT_MANAGE_CONTRACTS              = 'manage_contracts';
    public const RIGHT_VIEW_EXECUTIVE_DASHBOARD      = 'view_executive_dashboard';
    public const RIGHT_VIEW_SLA_AGGREGATED           = 'view_sla_aggregated';
    public const RIGHT_VIEW_SECURITY_CENTER          = 'view_security_center';
    public const RIGHT_MANAGE_SECURITY_CENTER        = 'manage_security_center';
    public const RIGHT_ENFORCE_ENTITY_ISOLATION      = 'enforce_entity_isolation';
    public const RIGHT_VIEW_MASKED_PII               = 'view_masked_pii';
    public const RIGHT_VIEW_UNMASKED_PII             = 'view_unmasked_pii';
    public const RIGHT_VIEW_LOGMEIN_CONTEXT          = 'view_logmein_context';
    public const RIGHT_MANAGE_LOGMEIN_MAPPING        = 'manage_logmein_mapping';
    // V7 — remote-access reconciliation.
    public const RIGHT_MANAGE_LOGMEIN_RECONCILIATION = 'manage_logmein_reconciliation';

    /**
     * @var array<string, list<string>>
     */
    private const ROLE_MATRIX = [
        self::ROLE_TECNICO => [
            self::RIGHT_ENFORCE_ENTITY_ISOLATION,
            self::RIGHT_VIEW_CENTRAL,
            self::RIGHT_VIEW_OWN_QUEUE,
            self::RIGHT_CLAIM_TICKET,
            self::RIGHT_REPLY_OWNED_TICKET,
            self::RIGHT_SOLVE_OWNED_TICKET,
            self::RIGHT_USE_COPILOT_AS_DRAFT,
            self::RIGHT_VIEW_KB_REFERENCE,
            self::RIGHT_VIEW_MASKED_PII,
            self::RIGHT_VIEW_LOGMEIN_CONTEXT,
        ],
        self::ROLE_SUPERVISAO => [
            self::RIGHT_ENFORCE_ENTITY_ISOLATION,
            self::RIGHT_VIEW_CENTRAL,
            self::RIGHT_VIEW_OWN_QUEUE,
            self::RIGHT_VIEW_ALL_QUEUES,
            self::RIGHT_CLAIM_TICKET,
            self::RIGHT_REPLY_OWNED_TICKET,
            self::RIGHT_TRANSFER_TICKET,
            self::RIGHT_SOLVE_TICKET,
            self::RIGHT_ADMINISTRATIVE_CLOSE,
            self::RIGHT_SELECT_ENTITY,
            self::RIGHT_OVERRIDE_ENTITY_MEMORY,
            self::RIGHT_MANAGE_MESSAGE_SETTINGS,
            self::RIGHT_MANAGE_TEMPLATES,
            self::RIGHT_VIEW_AI_CONSOLE,
            self::RIGHT_USE_COPILOT_AS_DRAFT,
            self::RIGHT_VIEW_AI_ALERTS,
            self::RIGHT_REVIEW_AI_ALERTS,
            self::RIGHT_VIEW_KB_REFERENCE,
            self::RIGHT_REVIEW_KB_CANDIDATES,
            self::RIGHT_VIEW_EXTERNAL_RESEARCH,
            self::RIGHT_RUN_EXTERNAL_RESEARCH,
            self::RIGHT_VIEW_AUDIT_OPERATIONAL,
            self::RIGHT_EXPORT_OPERATIONAL_REPORTS,
            self::RIGHT_VIEW_CONTRACTS_READONLY,
            self::RIGHT_VIEW_MASKED_PII,
            self::RIGHT_VIEW_SECURITY_CENTER,
            self::RIGHT_VIEW_LOGMEIN_CONTEXT,
            self::RIGHT_MANAGE_LOGMEIN_MAPPING,
            self::RIGHT_MANAGE_LOGMEIN_RECONCILIATION,
        ],
        self::ROLE_DIRECAO => [
            self::RIGHT_ENFORCE_ENTITY_ISOLATION,
            self::RIGHT_VIEW_EXECUTIVE_DASHBOARD,
            self::RIGHT_VIEW_SLA_AGGREGATED,
            self::RIGHT_VIEW_CONTRACTS_READONLY,
            self::RIGHT_VIEW_AUDIT_READONLY_SANITIZED,
            self::RIGHT_EXPORT_EXECUTIVE_REPORTS,
            self::RIGHT_VIEW_MASKED_PII,
            self::RIGHT_VIEW_LOGMEIN_CONTEXT,
        ],
    ];

    /**
     * @var array<string, list<string>>
     */
    private const ROLE_DENIED = [
        self::ROLE_TECNICO => [
            self::RIGHT_VIEW_ALL_QUEUES,
            self::RIGHT_REPLY_ANY_TICKET,
            self::RIGHT_TRANSFER_TICKET,
            self::RIGHT_SOLVE_TICKET,
            self::RIGHT_ADMINISTRATIVE_CLOSE,
            self::RIGHT_OVERRIDE_ENTITY_MEMORY,
            self::RIGHT_MANAGE_MESSAGE_SETTINGS,
            self::RIGHT_MANAGE_TEMPLATES,
            self::RIGHT_MANAGE_AI_SETTINGS,
            self::RIGHT_MANAGE_AI_SECRETS,
            self::RIGHT_REVIEW_AI_ALERTS,
            self::RIGHT_REVIEW_KB_CANDIDATES,
            self::RIGHT_EXPORT_OPERATIONAL_REPORTS,
            self::RIGHT_EXPORT_EXECUTIVE_REPORTS,
            self::RIGHT_VIEW_EXECUTIVE_DASHBOARD,
            self::RIGHT_VIEW_SECURITY_CENTER,
            self::RIGHT_MANAGE_SECURITY_CENTER,
            self::RIGHT_VIEW_UNMASKED_PII,
            self::RIGHT_MANAGE_LOGMEIN_MAPPING,
            self::RIGHT_MANAGE_LOGMEIN_RECONCILIATION,
        ],
        self::ROLE_SUPERVISAO => [
            self::RIGHT_REPLY_ANY_TICKET,
            self::RIGHT_MANAGE_AI_SECRETS,
            self::RIGHT_MANAGE_CONTRACTS,
            self::RIGHT_MANAGE_SECURITY_CENTER,
            self::RIGHT_VIEW_UNMASKED_PII,
        ],
        self::ROLE_DIRECAO => [
            self::RIGHT_REPLY_OWNED_TICKET,
            self::RIGHT_REPLY_ANY_TICKET,
            self::RIGHT_CLAIM_TICKET,
            self::RIGHT_TRANSFER_TICKET,
            self::RIGHT_SOLVE_TICKET,
            self::RIGHT_SOLVE_OWNED_TICKET,
            self::RIGHT_ADMINISTRATIVE_CLOSE,
            self::RIGHT_SELECT_ENTITY,
            self::RIGHT_OVERRIDE_ENTITY_MEMORY,
            self::RIGHT_MANAGE_MESSAGE_SETTINGS,
            self::RIGHT_MANAGE_TEMPLATES,
            self::RIGHT_MANAGE_AI_SETTINGS,
            self::RIGHT_MANAGE_AI_SECRETS,
            self::RIGHT_REVIEW_AI_ALERTS,
            self::RIGHT_MANAGE_SECURITY_CENTER,
            self::RIGHT_VIEW_UNMASKED_PII,
            self::RIGHT_MANAGE_LOGMEIN_MAPPING,
            self::RIGHT_MANAGE_LOGMEIN_RECONCILIATION,
        ],
    ];

    public static function resolveCurrentRole(): string
    {
        try {
            if ((int) Session::getLoginUserID() <= 0) {
                return self::ROLE_UNKNOWN;
            }
        } catch (Throwable $exception) {
            return self::ROLE_UNKNOWN;
        }

        $profileName = strtolower(trim((string) ($_SESSION['glpiactiveprofile']['name'] ?? '')));
        if ($profileName === '') {
            return self::ROLE_UNKNOWN;
        }

        if (strpos($profileName, 'diret') !== false || strpos($profileName, 'executiv') !== false) {
            return self::ROLE_DIRECAO;
        }

        if (strpos($profileName, 'supervis') !== false || strpos($profileName, 'coordenador') !== false) {
            return self::ROLE_SUPERVISAO;
        }

        if (in_array($profileName, ['super-admin', 'super admin', 'admin', 'administrator', 'administrador'], true)) {
            return self::ROLE_SUPERVISAO;
        }

        try {
            if (Session::haveRight(Plugin::RIGHT_NAME, READ)) {
                return self::ROLE_TECNICO;
            }
        } catch (Throwable $exception) {
            return self::ROLE_UNKNOWN;
        }

        return self::ROLE_UNKNOWN;
    }

    public static function hasRight(string $right): bool
    {
        $role = self::resolveCurrentRole();
        if ($role === self::ROLE_UNKNOWN) {
            return false;
        }

        // FIX1: hasRight() now consults the effective matrix (defaults +
        // persisted overrides from the Central de Segurança). ROLE_DENIED is
        // checked downstream inside saveMatrixOverrides, so a hostile override
        // can never relax separation of duties.
        $effective = self::getEffectiveMatrix();
        return in_array($right, $effective[$role] ?? [], true);
    }

    /**
     * @return array<string, list<string>>
     */
    public static function getRoleMatrix(): array
    {
        return self::ROLE_MATRIX;
    }

    /**
     * @return array<string, list<string>>
     */
    public static function getRoleDenied(): array
    {
        return self::ROLE_DENIED;
    }

    /**
     * @return list<string>
     */
    public static function getAllRights(): array
    {
        $all = [];
        foreach (self::ROLE_MATRIX + self::ROLE_DENIED as $rights) {
            foreach ($rights as $right) {
                $all[$right] = true;
            }
        }

        foreach (self::ROLE_DENIED as $rights) {
            foreach ($rights as $right) {
                $all[$right] = true;
            }
        }

        return array_keys($all);
    }

    public static function canSolveTicket(int $assignedUserId = 0, int $currentUserId = 0): bool
    {
        if (self::hasRight(self::RIGHT_SOLVE_TICKET)) {
            return true;
        }

        if (!self::hasRight(self::RIGHT_SOLVE_OWNED_TICKET)) {
            return false;
        }

        return $assignedUserId > 0 && $assignedUserId === $currentUserId;
    }

    public static function canViewSecurityCenter(): bool
    {
        return self::hasRight(self::RIGHT_VIEW_SECURITY_CENTER)
            || self::canManageSecurityCenter();
    }

    /**
     * FIX1: operational role is no longer the gate for managing security —
     * Super-Admin/admin in GLPI must always be able to govern the matrix,
     * even if they sit in ROLE_SUPERVISAO for day-to-day work.
     *
     * canManageSecurityCenter() now delegates to isSecurityAdmin(), and
     * isSecurityAdmin() recognises any session that holds the canonical
     * GLPI admin signals (config UPDATE, user UPDATE, profile UPDATE), with
     * the well-known profile-name list as a fast path and the plugin's own
     * UPDATE right as a fall-back. Profile/User IDs are NEVER hard-coded.
     */
    public static function canManageSecurityCenter(): bool
    {
        return self::isSecurityAdmin();
    }

    public static function isSecurityAdmin(): bool
    {
        try {
            if ((int) Session::getLoginUserID() <= 0) {
                return false;
            }
        } catch (Throwable $exception) {
            return false;
        }

        // (1) Strong native signals: anyone who can configure GLPI, manage
        // users or manage profiles is a Super-Admin from GLPI's point of view.
        $strongRights = [
            ['config', UPDATE],
            ['user', UPDATE],
            ['profile', UPDATE],
        ];
        foreach ($strongRights as [$right, $level]) {
            try {
                if (Session::haveRight($right, $level)) {
                    return true;
                }
            } catch (Throwable $exception) {
                // continue
            }
        }

        // (2) Known admin profile names + UPDATE on the plugin's own right.
        $profileName = strtolower(trim((string) ($_SESSION['glpiactiveprofile']['name'] ?? '')));
        $adminNames = ['super-admin', 'super admin', 'admin', 'administrator', 'administrador'];
        if ($profileName !== '' && in_array($profileName, $adminNames, true)) {
            try {
                if (Session::haveRight(Plugin::RIGHT_NAME, UPDATE)) {
                    return true;
                }
            } catch (Throwable $exception) {
                // fall through
            }
        }

        return false;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Matrix persistence — FIX1.
    //
    // Defaults come from ROLE_MATRIX (declared in code). Overrides are stored
    // through GLPI's Config::setConfigurationValues('plugin:integaglpi', …),
    // which writes to the GLPI-managed `glpi_configs` table. We do NOT touch
    // GLPI core, we do NOT create a new table, we do NOT run DDL at runtime.
    // ─────────────────────────────────────────────────────────────────────

    public const CONFIG_CONTEXT  = 'plugin:integaglpi';
    public const CONFIG_KEY      = 'security_matrix_overrides';

    /**
     * Returns the effective matrix: ROLE_MATRIX defaults merged with any
     * persisted overrides. Persisted overrides may only narrow or extend
     * the granted list per role; ROLE_DENIED is authoritative and cannot be
     * relaxed via the UI (defence in depth).
     *
     * @return array<string, list<string>>
     */
    public static function getEffectiveMatrix(): array
    {
        $defaults = self::ROLE_MATRIX;
        $overrides = self::loadMatrixOverrides();
        if ($overrides === []) {
            return $defaults;
        }

        $effective = $defaults;
        foreach ([self::ROLE_TECNICO, self::ROLE_SUPERVISAO, self::ROLE_DIRECAO] as $role) {
            if (!isset($overrides[$role]) || !is_array($overrides[$role])) {
                continue;
            }
            $rights = [];
            foreach ($overrides[$role] as $right) {
                if (!is_string($right)) {
                    continue;
                }
                // Never let a saved override grant a right that ROLE_DENIED
                // explicitly forbids — separation of duties is not editable.
                if (in_array($right, self::ROLE_DENIED[$role] ?? [], true)) {
                    continue;
                }
                $rights[] = $right;
            }
            $effective[$role] = array_values(array_unique($rights));
        }

        return $effective;
    }

    /**
     * @return array<string, list<string>>
     */
    public static function loadMatrixOverrides(): array
    {
        try {
            if (!class_exists('Config') || !method_exists('Config', 'getConfigurationValues')) {
                return [];
            }
            $values = Config::getConfigurationValues(self::CONFIG_CONTEXT);
            if (!is_array($values) || !isset($values[self::CONFIG_KEY])) {
                return [];
            }
            $decoded = json_decode((string) $values[self::CONFIG_KEY], true);
            if (!is_array($decoded)) {
                return [];
            }
            $out = [];
            foreach ([self::ROLE_TECNICO, self::ROLE_SUPERVISAO, self::ROLE_DIRECAO] as $role) {
                if (isset($decoded[$role]) && is_array($decoded[$role])) {
                    $out[$role] = array_values(array_filter(
                        array_map(static fn ($v): string => is_string($v) ? $v : '', $decoded[$role]),
                        static fn (string $v): bool => $v !== ''
                    ));
                }
            }
            return $out;
        } catch (Throwable $exception) {
            error_log('[integaglpi][security_matrix][load_failed] ' . $exception->getMessage());
            return [];
        }
    }

    /**
     * Persists a new matrix. Returns a diff (per role: added/removed) so the
     * caller can audit SECURITY_PERMISSION_CHANGED with non-secret details.
     *
     * @param array<string, list<string>> $newMatrix
     * @return array<string, array{added: list<string>, removed: list<string>}>
     */
    public static function saveMatrixOverrides(array $newMatrix): array
    {
        $allowedRights = self::getAllRights();
        $clean = [];
        foreach ([self::ROLE_TECNICO, self::ROLE_SUPERVISAO, self::ROLE_DIRECAO] as $role) {
            $rights = is_array($newMatrix[$role] ?? null) ? $newMatrix[$role] : [];
            $filtered = [];
            foreach ($rights as $right) {
                if (!is_string($right)) {
                    continue;
                }
                if (!in_array($right, $allowedRights, true)) {
                    continue;
                }
                if (in_array($right, self::ROLE_DENIED[$role] ?? [], true)) {
                    continue;
                }
                $filtered[] = $right;
            }
            $clean[$role] = array_values(array_unique($filtered));
        }

        $current = self::getEffectiveMatrix();
        $diff = [];
        foreach ([self::ROLE_TECNICO, self::ROLE_SUPERVISAO, self::ROLE_DIRECAO] as $role) {
            $before = $current[$role] ?? [];
            $after = $clean[$role] ?? [];
            $diff[$role] = [
                'added'   => array_values(array_diff($after, $before)),
                'removed' => array_values(array_diff($before, $after)),
            ];
        }

        try {
            if (class_exists('Config') && method_exists('Config', 'setConfigurationValues')) {
                Config::setConfigurationValues(self::CONFIG_CONTEXT, [
                    self::CONFIG_KEY => json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                ]);
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][security_matrix][save_failed] ' . $exception->getMessage());
            throw $exception;
        }

        return $diff;
    }

    public static function enforceEntityScope(int $entityId): bool
    {
        if ($entityId <= 0) {
            return false;
        }

        try {
            if (class_exists('\Session') && method_exists('\Session', 'haveAccessToEntity')) {
                return (bool) \Session::haveAccessToEntity($entityId);
            }
        } catch (Throwable $exception) {
            return false;
        }

        $entities = $_SESSION['glpiactiveentities'] ?? [];
        if (!is_array($entities)) {
            return false;
        }

        return in_array($entityId, array_map('intval', $entities), true);
    }

    public static function maskPiiForUser(string $rawValue, string $field = 'phone'): string
    {
        $value = trim($rawValue);
        if ($value === '') {
            return '';
        }

        if (self::hasRight(self::RIGHT_VIEW_UNMASKED_PII)) {
            return $value;
        }

        if ($field === 'email' || strpos($value, '@') !== false) {
            $parts = explode('@', $value, 2);
            $local = $parts[0] ?? '';
            $domain = $parts[1] ?? '';
            return substr($local, 0, 2) . str_repeat('*', max(0, strlen($local) - 2)) . '@' . $domain;
        }

        $digits = preg_replace('/\D+/', '', $value) ?? '';
        $len = strlen($digits);
        if ($len <= 4) {
            return str_repeat('*', $len);
        }

        return substr($digits, 0, max(0, $len - 4)) . '****';
    }

    /**
     * @return array{ok: bool, http_status: int, error: string, message: string}
     */
    public static function requirePermissionOrDeny(string $right, array $context = []): array
    {
        if (self::hasRight($right) || ($right === self::RIGHT_MANAGE_SECURITY_CENTER && self::canManageSecurityCenter())) {
            return [
                'ok' => true,
                'http_status' => 200,
                'error' => '',
                'message' => '',
            ];
        }

        SecurityAuditService::logAccessDenied($right, $context);

        return [
            'ok' => false,
            'http_status' => 403,
            'error' => 'forbidden',
            'message' => __('Você não tem permissão para executar esta ação.', 'glpiintegaglpi'),
        ];
    }
}
