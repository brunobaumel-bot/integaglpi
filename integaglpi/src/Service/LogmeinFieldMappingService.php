<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use Throwable;

/**
 * Reads and writes LogMeIn → GLPI field mapping configuration from PostgreSQL.
 *
 * Rules enforced unconditionally:
 *  - PII fields (localUsers, windowsProfiles, lastLogonUserName, externalIp, journalEntries)
 *    are blocked and may not be activated via any action.
 *  - Dry-run preview never modifies GLPI.
 *  - No auto-ticket, no alarm engine.
 *  - The `always_update` policy requires explicit user action and logs an audit event.
 *
 * PHASE: integaglpi_logmein_field_mapping_config_001
 */
final class LogmeinFieldMappingService
{
    private const TABLE = 'glpi_plugin_integaglpi_logmein_field_mapping_config';

    /**
     * PII fields that must never be synced, regardless of configuration.
     * Activation attempts for these fields are silently rejected.
     * @var list<string>
     */
    private const FORBIDDEN_FIELDS = [
        'localUsers',
        'windowsProfiles',
        'lastLogonUserName',
        'externalIp',
        'journalEntries',
    ];

    /** @var list<string> */
    private const VALID_POLICIES = [
        'never_overwrite_manual',
        'overwrite_only_logmein_origin',
        'always_update',
    ];

    private PluginConfigService $pluginConfigService;

    private ?PDO $pdo = null;

    public function __construct(?PluginConfigService $pluginConfigService = null)
    {
        $this->pluginConfigService = $pluginConfigService ?? new PluginConfigService();
    }

    // ── Schema ────────────────────────────────────────────────────────────────

    public function isSchemaReady(): bool
    {
        try {
            $pdo = $this->getPdo();
            $stmt = $pdo->query(
                "SELECT to_regclass('public." . self::TABLE . "') IS NOT NULL AS ready"
            );
            $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
            return (bool) ($row['ready'] ?? false);
        } catch (Throwable) {
            return false;
        }
    }

    // ── Reads ──────────────────────────────────────────────────────────────────

    /**
     * @return list<array<string, mixed>>
     */
    public function listAll(): array
    {
        return $this->query("SELECT * FROM " . self::TABLE . " ORDER BY logmein_field_key");
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listActive(): array
    {
        return $this->query(
            "SELECT * FROM " . self::TABLE . " WHERE is_active = TRUE ORDER BY logmein_field_key"
        );
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findById(int $id): ?array
    {
        $rows = $this->query("SELECT * FROM " . self::TABLE . " WHERE id = ?", [$id]);
        return $rows[0] ?? null;
    }

    // ── Writes ─────────────────────────────────────────────────────────────────

    /**
     * Activates or deactivates a mapping.
     * Silently rejects activation of forbidden PII fields.
     *
     * @return array{ok: bool, message: string}
     */
    public function setActive(int $id, bool $active, int $glpiUserId): array
    {
        try {
            $mapping = $this->findById($id);
            if ($mapping === null) {
                return ['ok' => false, 'message' => __('Mapeamento não encontrado.', 'glpiintegaglpi')];
            }
            if ($active && in_array($mapping['logmein_field_key'], self::FORBIDDEN_FIELDS, true)) {
                return ['ok' => false, 'message' => __('Campo proibido (PII): não pode ser ativado.', 'glpiintegaglpi')];
            }
            $this->execute(
                "UPDATE " . self::TABLE . " SET is_active = ?, updated_at = NOW() WHERE id = ?",
                [(int) $active, $id]
            );
            return ['ok' => true, 'message' => __('Mapeamento atualizado.', 'glpiintegaglpi')];
        } catch (Throwable $e) {
            error_log('[integaglpi][field_mapping][setActive] ' . mb_substr(strip_tags($e->getMessage()), 0, 160));
            return ['ok' => false, 'message' => __('Erro ao atualizar mapeamento.', 'glpiintegaglpi')];
        }
    }

    /**
     * Updates the overwrite policy of a mapping.
     * The `always_update` policy is permitted only explicitly by the admin.
     *
     * @return array{ok: bool, message: string}
     */
    public function setPolicy(int $id, string $policy, int $glpiUserId): array
    {
        if (!in_array($policy, self::VALID_POLICIES, true)) {
            return ['ok' => false, 'message' => __('Política de sobrescrita inválida.', 'glpiintegaglpi')];
        }
        try {
            $mapping = $this->findById($id);
            if ($mapping === null) {
                return ['ok' => false, 'message' => __('Mapeamento não encontrado.', 'glpiintegaglpi')];
            }
            if (in_array($mapping['logmein_field_key'], self::FORBIDDEN_FIELDS, true)) {
                return ['ok' => false, 'message' => __('Campo proibido (PII): política não pode ser alterada.', 'glpiintegaglpi')];
            }
            $this->execute(
                "UPDATE " . self::TABLE . " SET overwrite_policy = ?, updated_at = NOW() WHERE id = ?",
                [$policy, $id]
            );
            if ($policy === 'always_update') {
                error_log(sprintf(
                    '[integaglpi][field_mapping][POLICY_ALWAYS_UPDATE] user=%d field=%s',
                    $glpiUserId,
                    (string) ($mapping['logmein_field_key'] ?? '')
                ));
            }
            return ['ok' => true, 'message' => __('Política atualizada.', 'glpiintegaglpi')];
        } catch (Throwable $e) {
            error_log('[integaglpi][field_mapping][setPolicy] ' . mb_substr(strip_tags($e->getMessage()), 0, 160));
            return ['ok' => false, 'message' => __('Erro ao atualizar política.', 'glpiintegaglpi')];
        }
    }

    // ── Dry-run ────────────────────────────────────────────────────────────────

    /**
     * Produces a dry-run preview for the active mappings.
     * THIS METHOD NEVER MODIFIES GLPI.
     *
     * @param array<string, string|null> $currentGlpiValues  current field values from GLPI
     * @param array<string, string|null> $proposedValues     values coming from LM inventory
     * @param bool $syncLocalIp  reflects LOGMEIN_SYNC_LOCAL_IP flag
     * @return array{dry_run_only: true, auto_ticket: false, alarm_engine: false, fields: list<array<string, mixed>>, summary: array<string, int>}
     */
    public function dryRun(array $currentGlpiValues, array $proposedValues, bool $syncLocalIp = false): array
    {
        $mappings = $this->listActive();
        $fields = [];
        $summary = ['would_update' => 0, 'would_skip' => 0, 'blocked_by_policy' => 0, 'field_unavailable' => 0, 'blocked_pii' => 0, 'blocked_flag' => 0];

        foreach ($mappings as $m) {
            $key    = (string) ($m['logmein_field_key'] ?? '');
            $target = (string) ($m['glpi_target_field'] ?? '');
            $policy = (string) ($m['overwrite_policy'] ?? 'never_overwrite_manual');
            $flag   = isset($m['requires_flag']) ? (string) $m['requires_flag'] : null;

            if (in_array($key, self::FORBIDDEN_FIELDS, true)) {
                $fields[] = $this->fieldResult($m, 'blocked_pii', null, null);
                $summary['blocked_pii']++;
                continue;
            }

            if ($flag === 'LOGMEIN_SYNC_LOCAL_IP' && !$syncLocalIp) {
                $fields[] = $this->fieldResult($m, 'blocked_flag', null, null);
                $summary['blocked_flag']++;
                $summary['would_skip']++;
                continue;
            }

            $proposed = $proposedValues[$key] ?? null;
            if ($proposed === null || $proposed === '') {
                $fields[] = $this->fieldResult($m, 'field_unavailable', $currentGlpiValues[$target] ?? null, null);
                $summary['field_unavailable']++;
                continue;
            }

            $current = $currentGlpiValues[$target] ?? null;
            $status  = $this->evaluatePolicy($policy, $current, $proposed);
            // Mask sensitive fields in dry-run output.
            $safeProposed = in_array($key, ['NetworkConnectionMacAddress', 'NetworkConnectionIPAddress'], true) ? '[redacted]' : $proposed;
            $safeCurrent  = in_array($target, ['mac_address', 'ip_address'], true) ? '[redacted]' : $current;
            $fields[] = $this->fieldResult($m, $status, $safeCurrent, $safeProposed);
            $summary[$status] = ($summary[$status] ?? 0) + 1;
        }

        return [
            'dry_run_only' => true,
            'auto_ticket'  => false,
            'alarm_engine' => false,
            'fields'       => $fields,
            'summary'      => $summary,
        ];
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    /**
     * @return list<string>
     */
    public function getForbiddenFields(): array
    {
        return self::FORBIDDEN_FIELDS;
    }

    /**
     * @return list<string>
     */
    public function getValidPolicies(): array
    {
        return self::VALID_POLICIES;
    }

    /**
     * @param array<string, mixed> $mapping
     * @return array<string, mixed>
     */
    private function fieldResult(array $mapping, string $status, ?string $current, ?string $proposed): array
    {
        return [
            'logmein_field_key' => $mapping['logmein_field_key'],
            'glpi_target_type'  => $mapping['glpi_target_type'],
            'glpi_target_field' => $mapping['glpi_target_field'],
            'overwrite_policy'  => $mapping['overwrite_policy'],
            'status'            => $status,
            'current_glpi_value'=> $current,
            'proposed_value'    => $proposed,
        ];
    }

    private function evaluatePolicy(string $policy, ?string $current, ?string $proposed): string
    {
        if ($current === null || $current === '') {
            return 'would_update';
        }
        return match ($policy) {
            'never_overwrite_manual'        => 'blocked_by_policy',
            'overwrite_only_logmein_origin' => 'would_update',
            'always_update'                 => 'would_update',
            default                         => 'blocked_by_policy',
        };
    }

    // ── Database ───────────────────────────────────────────────────────────────

    /**
     * @param list<mixed> $params
     * @return list<array<string, mixed>>
     */
    private function query(string $sql, array $params = []): array
    {
        try {
            $pdo  = $this->getPdo();
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            return is_array($rows) ? array_values($rows) : [];
        } catch (Throwable $e) {
            error_log('[integaglpi][field_mapping][query] ' . mb_substr(strip_tags($e->getMessage()), 0, 160));
            return [];
        }
    }

    /**
     * @param list<mixed> $params
     */
    private function execute(string $sql, array $params = []): void
    {
        $pdo  = $this->getPdo();
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
    }

    private function getPdo(): PDO
    {
        if ($this->pdo instanceof PDO) {
            return $this->pdo;
        }
        $config    = $this->pluginConfigService->getExternalDbConfig();
        $this->pdo = ExternalDatabase::getConnection($config);
        return $this->pdo;
    }
}
