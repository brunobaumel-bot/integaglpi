<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use Throwable;

/**
 * LogmeinAlarmAdminService
 *
 * Serviço PHP de administração de regras de alarme LogMeIn.
 * Lê e grava no PostgreSQL de integração — nunca no banco GLPI (MariaDB).
 *
 * Operações:
 *   - Listar regras (read-only)
 *   - Criar regra (enabled=false por padrão)
 *   - Habilitar / desabilitar regra
 *   - Excluir regra
 *   - Listar eventos recentes
 *   - Verificar schema (migrações 048 + 049)
 *
 * Guards obrigatórios (espelham LogmeinAlarmRulesService.ts):
 *   - alarm_type deve estar na lista permitida
 *   - glpi_entities_id > 0
 *   - create_ticket=true exige glpi_group_id + glpi_itil_category_id
 *   - Tipos proibidos bloqueados: high_cpu, disk_health_smart, network_bandwidth, software_compliance
 *   - Tipos alert-only não podem ter create_ticket=true
 *
 * PHASE: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
 */
final class LogmeinAlarmAdminService
{
    private const RULES_TABLE   = 'integaglpi_logmein_alarm_rules';
    private const EVENTS_TABLE  = 'integaglpi_logmein_alarm_events';
    private const TARGETS_TABLE = 'integaglpi_logmein_alarm_targets';

    private const AUTO_TICKET_TYPES = ['host_offline', 'host_not_seen'];
    private const ALERT_ONLY_TYPES  = [
        'missing_equipment_tag',
        'missing_entity_mapping',
        'hardware_change',
        'low_disk',
        'low_memory',
    ];
    private const FORBIDDEN_TYPES = [
        'high_cpu',
        'disk_health_smart',
        'network_bandwidth',
        'software_compliance',
    ];
    private const VALID_TYPES = [
        'host_offline',
        'host_not_seen',
        'missing_equipment_tag',
        'missing_entity_mapping',
        'hardware_change',
        'low_disk',
        'low_memory',
    ];

    private const AUTO_TICKET_MIN_COOLDOWN = 60;
    private const MIN_NOT_SEEN_DAYS        = 7;

    private PluginConfigService $config;

    private ?PDO $pdo = null;

    public function __construct(?PluginConfigService $config = null)
    {
        $this->config = $config ?? new PluginConfigService();
    }

    // ── Schema ────────────────────────────────────────────────────────────────

    public function isSchemaReady(): bool
    {
        try {
            $pdo  = $this->getPdo();
            $stmt = $pdo->query(
                "SELECT to_regclass('public." . self::RULES_TABLE . "') IS NOT NULL
                    AND to_regclass('public." . self::EVENTS_TABLE . "') IS NOT NULL
                    AND to_regclass('public." . self::TARGETS_TABLE . "') IS NOT NULL AS ready"
            );
            $row  = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : null;
            return ($row['ready'] ?? false) === true;
        } catch (Throwable) {
            return false;
        }
    }

    public function hasGuardsColumns(): bool
    {
        try {
            $pdo  = $this->getPdo();
            $stmt = $pdo->query(
                "SELECT column_name FROM information_schema.columns
                  WHERE table_name = '" . self::RULES_TABLE . "'
                    AND column_name = 'min_consecutive_checks'"
            );
            return $stmt && $stmt->fetch(PDO::FETCH_ASSOC) !== false;
        } catch (Throwable) {
            return false;
        }
    }

    // ── Rules: read ────────────────────────────────────────────────────────────

    /**
     * @return list<array<string, mixed>>
     */
    public function listAllRules(): array
    {
        try {
            $pdo  = $this->getPdo();
            $stmt = $pdo->query(
                'SELECT id, rule_name, alarm_type, enabled, cooldown_minutes,
                        condition_payload, glpi_entities_id, glpi_group_id,
                        glpi_itil_category_id, create_ticket,
                        COALESCE(min_consecutive_checks, 1) AS min_consecutive_checks,
                        COALESCE(consecutive_check_interval_minutes, 5) AS consecutive_check_interval_minutes,
                        created_at, updated_at
                   FROM ' . self::RULES_TABLE . '
                  ORDER BY created_at ASC'
            );
            if (!$stmt) {
                return [];
            }
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            return is_array($rows) ? array_values($rows) : [];
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getRuleById(string $id): ?array
    {
        try {
            $pdo  = $this->getPdo();
            $stmt = $pdo->prepare(
                'SELECT id, rule_name, alarm_type, enabled, cooldown_minutes,
                        condition_payload, glpi_entities_id, glpi_group_id,
                        glpi_itil_category_id, create_ticket,
                        COALESCE(min_consecutive_checks, 1) AS min_consecutive_checks,
                        COALESCE(consecutive_check_interval_minutes, 5) AS consecutive_check_interval_minutes,
                        created_at, updated_at
                   FROM ' . self::RULES_TABLE . '
                  WHERE id = :id::uuid'
            );
            $stmt->execute([':id' => $id]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row !== false ? $row : null;
        } catch (Throwable) {
            return null;
        }
    }

    // ── Rules: write ───────────────────────────────────────────────────────────

    /**
     * @param array<string, mixed> $input
     * @return array{ok: bool, rule_id: string|null, errors: list<string>}
     */
    public function createRule(array $input): array
    {
        $errors = $this->validateInput($input);
        if (!empty($errors)) {
            return ['ok' => false, 'rule_id' => null, 'errors' => $errors];
        }

        $alarmType        = trim((string) ($input['alarm_type'] ?? ''));
        $conditionPayload = $this->buildConditionPayload($alarmType, $input);
        $createTicket     = (bool) ($input['create_ticket'] ?? false);

        // Alert-only types can never create tickets
        if ($createTicket && in_array($alarmType, self::ALERT_ONLY_TYPES, true)) {
            $createTicket = false;
        }

        try {
            $pdo  = $this->getPdo();
            $stmt = $pdo->prepare(
                'INSERT INTO ' . self::RULES_TABLE . '
                   (rule_name, alarm_type, enabled, cooldown_minutes, condition_payload,
                    glpi_entities_id, glpi_group_id, glpi_itil_category_id, create_ticket,
                    min_consecutive_checks, consecutive_check_interval_minutes)
                 VALUES
                   (:rule_name, :alarm_type, false, :cooldown_minutes, :condition_payload::jsonb,
                    :glpi_entities_id, :glpi_group_id, :glpi_itil_category_id, :create_ticket,
                    :min_consecutive_checks, :consecutive_check_interval_minutes)
                 RETURNING id'
            );

            $stmt->execute([
                ':rule_name'                       => trim((string) ($input['rule_name'] ?? '')),
                ':alarm_type'                      => $alarmType,
                ':cooldown_minutes'                => (int) ($input['cooldown_minutes'] ?? 60),
                ':condition_payload'               => json_encode($conditionPayload, JSON_THROW_ON_ERROR),
                ':glpi_entities_id'                => (int) ($input['glpi_entities_id'] ?? 0),
                ':glpi_group_id'                   => ($input['glpi_group_id'] !== '' && $input['glpi_group_id'] !== null)
                                                       ? (int) $input['glpi_group_id'] : null,
                ':glpi_itil_category_id'           => ($input['glpi_itil_category_id'] !== '' && $input['glpi_itil_category_id'] !== null)
                                                       ? (int) $input['glpi_itil_category_id'] : null,
                ':create_ticket'                   => $createTicket ? 'true' : 'false',
                ':min_consecutive_checks'          => max(1, (int) ($input['min_consecutive_checks'] ?? 1)),
                ':consecutive_check_interval_minutes' => max(5, (int) ($input['consecutive_check_interval_minutes'] ?? 5)),
            ]);

            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            $ruleId = is_array($row) ? (string) ($row['id'] ?? '') : '';

            return ['ok' => true, 'rule_id' => $ruleId ?: null, 'errors' => []];
        } catch (Throwable $e) {
            return ['ok' => false, 'rule_id' => null, 'errors' => ['Erro ao criar regra: ' . $e->getMessage()]];
        }
    }

    /**
     * @return array{ok: bool, errors: list<string>}
     */
    public function setEnabled(string $id, bool $enabled): array
    {
        if (trim($id) === '') {
            return ['ok' => false, 'errors' => ['ID inválido.']];
        }
        try {
            $pdo  = $this->getPdo();
            $stmt = $pdo->prepare(
                'UPDATE ' . self::RULES_TABLE . '
                    SET enabled = :enabled, updated_at = NOW()
                  WHERE id = :id::uuid'
            );
            $stmt->execute([':enabled' => $enabled ? 'true' : 'false', ':id' => $id]);
            return ['ok' => true, 'errors' => []];
        } catch (Throwable $e) {
            return ['ok' => false, 'errors' => [$e->getMessage()]];
        }
    }

    /**
     * @return array{ok: bool, errors: list<string>}
     */
    public function deleteRule(string $id): array
    {
        if (trim($id) === '') {
            return ['ok' => false, 'errors' => ['ID inválido.']];
        }
        try {
            $pdo  = $this->getPdo();
            $stmt = $pdo->prepare('DELETE FROM ' . self::RULES_TABLE . ' WHERE id = :id::uuid RETURNING id');
            $stmt->execute([':id' => $id]);
            $deleted = $stmt->fetch(PDO::FETCH_ASSOC) !== false;
            return ['ok' => $deleted, 'errors' => $deleted ? [] : ['Regra não encontrada.']];
        } catch (Throwable $e) {
            return ['ok' => false, 'errors' => [$e->getMessage()]];
        }
    }

    // ── Events ─────────────────────────────────────────────────────────────────

    /**
     * @return list<array<string, mixed>>
     */
    public function listRecentEvents(int $limit = 50): array
    {
        try {
            $safeLimit = max(1, min($limit, 500));
            $pdo       = $this->getPdo();
            $stmt      = $pdo->prepare(
                'SELECT e.id, e.rule_id, r.rule_name, e.host_id, e.hostname,
                        e.alarm_type, e.glpi_ticket_id, e.cooldown_skipped,
                        e.dedupe_hit, e.created_at
                   FROM ' . self::EVENTS_TABLE . ' e
              LEFT JOIN ' . self::RULES_TABLE . ' r ON r.id = e.rule_id
                  ORDER BY e.created_at DESC
                  LIMIT :limit'
            );
            $stmt->bindValue(':limit', $safeLimit, PDO::PARAM_INT);
            $stmt->execute();
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            return is_array($rows) ? array_values($rows) : [];
        } catch (Throwable) {
            return [];
        }
    }

    // ── Taxonomy helpers ───────────────────────────────────────────────────────

    /**
     * @return list<string>
     */
    public static function getValidTypes(): array
    {
        return self::VALID_TYPES;
    }

    public static function isAlertOnly(string $alarmType): bool
    {
        return in_array($alarmType, self::ALERT_ONLY_TYPES, true);
    }

    public static function isForbidden(string $alarmType): bool
    {
        return in_array($alarmType, self::FORBIDDEN_TYPES, true);
    }

    // ── Validation ────────────────────────────────────────────────────────────

    /**
     * @param array<string, mixed> $input
     * @return list<string>
     */
    private function validateInput(array $input): array
    {
        $errors    = [];
        $alarmType = trim((string) ($input['alarm_type'] ?? ''));

        if (trim((string) ($input['rule_name'] ?? '')) === '') {
            $errors[] = 'Nome da regra é obrigatório.';
        }

        if (in_array($alarmType, self::FORBIDDEN_TYPES, true)) {
            $errors[] = "Tipo '$alarmType' é proibido nesta fase.";
            return $errors;
        }

        if (!in_array($alarmType, self::VALID_TYPES, true)) {
            $errors[] = 'Tipo de alarme inválido.';
        }

        $entitiesId = (int) ($input['glpi_entities_id'] ?? 0);
        if ($entitiesId <= 0) {
            $errors[] = 'Entidade GLPI deve ser > 0. Entidade raiz proibida.';
        }

        $createTicket = (bool) ($input['create_ticket'] ?? false);
        if ($createTicket && in_array($alarmType, self::ALERT_ONLY_TYPES, true)) {
            $errors[] = "Tipo '$alarmType' é alert-only — create_ticket não permitido.";
        }

        if ($createTicket && !in_array($alarmType, self::ALERT_ONLY_TYPES, true)) {
            if (empty($input['glpi_group_id'])) {
                $errors[] = 'Fila/grupo GLPI é obrigatório quando create_ticket=true.';
            }
            if (empty($input['glpi_itil_category_id'])) {
                $errors[] = 'Categoria GLPI é obrigatória quando create_ticket=true.';
            }
            $cooldown = (int) ($input['cooldown_minutes'] ?? 0);
            if (in_array($alarmType, self::AUTO_TICKET_TYPES, true) && $cooldown < self::AUTO_TICKET_MIN_COOLDOWN) {
                $errors[] = 'Cooldown mínimo é ' . self::AUTO_TICKET_MIN_COOLDOWN . ' minutos para tipos auto-ticket.';
            }
        }

        if ($alarmType === 'host_not_seen') {
            $days = (int) ($input['not_seen_days'] ?? 0);
            if ($days < self::MIN_NOT_SEEN_DAYS) {
                $errors[] = 'host_not_seen requer not_seen_days >= ' . self::MIN_NOT_SEEN_DAYS . '.';
            }
        }

        return $errors;
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    private function buildConditionPayload(string $alarmType, array $input): array
    {
        $payload = [];
        if ($alarmType === 'host_not_seen') {
            $payload['not_seen_days'] = max(self::MIN_NOT_SEEN_DAYS, (int) ($input['not_seen_days'] ?? self::MIN_NOT_SEEN_DAYS));
        }
        return $payload;
    }

    // ── Targets ───────────────────────────────────────────────────────────────

    /**
     * @return list<array<string, mixed>>
     */
    public function listTargetsForRule(string $ruleId): array
    {
        if (trim($ruleId) === '') {
            return [];
        }
        try {
            $pdo  = $this->getPdo();
            $stmt = $pdo->prepare(
                'SELECT id, rule_id, host_id, hostname, created_at
                   FROM ' . self::TARGETS_TABLE . '
                  WHERE rule_id = :rule_id::uuid
                  ORDER BY hostname ASC'
            );
            $stmt->execute([':rule_id' => $ruleId]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            return is_array($rows) ? array_values($rows) : [];
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * @param list<string> $ruleIds
     * @return array<string, list<array<string, mixed>>>  keyed by rule_id
     */
    public function listTargetsForRules(array $ruleIds): array
    {
        if ($ruleIds === []) {
            return [];
        }
        try {
            $pdo         = $this->getPdo();
            $placeholders = implode(', ', array_map(static fn (int $i) => ':r' . $i . '::uuid', array_keys($ruleIds)));
            $params       = [];
            foreach ($ruleIds as $i => $id) {
                $params[':r' . $i] = $id;
            }
            $stmt = $pdo->prepare(
                'SELECT id, rule_id, host_id, hostname, created_at
                   FROM ' . self::TARGETS_TABLE . '
                  WHERE rule_id IN (' . $placeholders . ')
                  ORDER BY hostname ASC'
            );
            $stmt->execute($params);
            $rows   = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $result = [];
            if (is_array($rows)) {
                foreach ($rows as $row) {
                    $rid              = (string) $row['rule_id'];
                    $result[$rid][]   = $row;
                }
            }
            return $result;
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * @return array{ok: bool, errors: list<string>}
     */
    public function addTarget(string $ruleId, string $hostId, string $hostname): array
    {
        $ruleId   = trim($ruleId);
        $hostId   = trim($hostId);
        $hostname = mb_substr(trim($hostname), 0, 255, 'UTF-8');

        if ($ruleId === '' || $hostId === '') {
            return ['ok' => false, 'errors' => ['rule_id e host_id são obrigatórios.']];
        }
        try {
            $pdo  = $this->getPdo();
            $stmt = $pdo->prepare(
                'INSERT INTO ' . self::TARGETS_TABLE . ' (rule_id, host_id, hostname)
                 VALUES (:rule_id::uuid, :host_id, :hostname)
                 ON CONFLICT (rule_id, host_id) DO UPDATE SET hostname = EXCLUDED.hostname'
            );
            $stmt->execute([':rule_id' => $ruleId, ':host_id' => $hostId, ':hostname' => $hostname]);
            return ['ok' => true, 'errors' => []];
        } catch (Throwable $e) {
            return ['ok' => false, 'errors' => ['Erro ao adicionar alvo: ' . $e->getMessage()]];
        }
    }

    /**
     * @return array{ok: bool, errors: list<string>}
     */
    public function removeTarget(string $ruleId, string $hostId): array
    {
        $ruleId = trim($ruleId);
        $hostId = trim($hostId);
        if ($ruleId === '' || $hostId === '') {
            return ['ok' => false, 'errors' => ['rule_id e host_id são obrigatórios.']];
        }
        try {
            $pdo  = $this->getPdo();
            $stmt = $pdo->prepare(
                'DELETE FROM ' . self::TARGETS_TABLE . '
                  WHERE rule_id = :rule_id::uuid AND host_id = :host_id'
            );
            $stmt->execute([':rule_id' => $ruleId, ':host_id' => $hostId]);
            return ['ok' => true, 'errors' => []];
        } catch (Throwable $e) {
            return ['ok' => false, 'errors' => [$e->getMessage()]];
        }
    }

    // ── Host search (from asset cache) ─────────────────────────────────────────

    private const ASSET_CACHE_TABLE = 'glpi_plugin_integaglpi_logmein_asset_cache';

    /**
     * Search hosts in the LogMeIn asset cache for target selection.
     * Never returns PII — only sanitized hostname, tag, status, group.
     *
     * @return list<array{host_id: string, hostname: string, equipment_tag: string, status: string, group_name: string}>
     */
    public function searchHosts(string $query, string $groupId = '', int $limit = 50): array
    {
        $limit = max(1, min($limit, 200));
        try {
            $pdo    = $this->getPdo();
            $params = [];
            $where  = [];

            if (trim($query) !== '') {
                $where[]          = "(host_name_sanitized ILIKE :q OR equipment_tag ILIKE :q)";
                $params[':q']     = '%' . trim($query) . '%';
            }
            if (trim($groupId) !== '') {
                $where[]             = 'logmein_group_external_id = :gid';
                $params[':gid']      = trim($groupId);
            }

            $whereClause = $where !== [] ? 'WHERE ' . implode(' AND ', $where) : '';
            $stmt = $pdo->prepare(
                'SELECT logmein_host_external_id AS host_id,
                        host_name_sanitized      AS hostname,
                        COALESCE(equipment_tag, \'\') AS equipment_tag,
                        COALESCE(status, \'unknown\') AS status,
                        logmein_group_name       AS group_name
                   FROM ' . self::ASSET_CACHE_TABLE . '
                  ' . $whereClause . '
                  ORDER BY host_name_sanitized ASC
                  LIMIT :lim'
            );
            $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
            foreach ($params as $k => $v) {
                $stmt->bindValue($k, $v);
            }
            $stmt->execute();
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            return is_array($rows) ? array_values($rows) : [];
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * @return list<array{group_id: string, group_name: string, host_count: int}>
     */
    public function listGroups(): array
    {
        try {
            $pdo  = $this->getPdo();
            $stmt = $pdo->query(
                'SELECT logmein_group_external_id AS group_id,
                        logmein_group_name         AS group_name,
                        COUNT(*)::int              AS host_count
                   FROM ' . self::ASSET_CACHE_TABLE . '
                  GROUP BY logmein_group_external_id, logmein_group_name
                  ORDER BY logmein_group_name ASC
                  LIMIT 200'
            );
            if (!$stmt) {
                return [];
            }
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            return is_array($rows) ? array_values($rows) : [];
        } catch (Throwable) {
            return [];
        }
    }

    // ── Stats per rule (batch) ────────────────────────────────────────────────

    /**
     * Returns aggregated statistics for a set of rules from the events table.
     *
     * @param  list<string> $ruleIds
     * @return array<string, array{total_events: int, last_trigger: string|null, tickets_created: int, cooldown_skipped: int, dedupe_hit: int}>
     */
    public function getStatsForRules(array $ruleIds): array
    {
        if ($ruleIds === []) {
            return [];
        }
        try {
            $pdo          = $this->getPdo();
            $placeholders = implode(', ', array_map(static fn (int $i) => ':r' . $i . '::uuid', array_keys($ruleIds)));
            $params       = [];
            foreach ($ruleIds as $i => $id) {
                $params[':r' . $i] = $id;
            }
            $stmt = $pdo->prepare(
                'SELECT rule_id::text,
                        COUNT(*)::int                                    AS total_events,
                        MAX(created_at)                                  AS last_trigger,
                        COUNT(*) FILTER (WHERE glpi_ticket_id IS NOT NULL)::int AS tickets_created,
                        COUNT(*) FILTER (WHERE cooldown_skipped = true)::int    AS cooldown_skipped,
                        COUNT(*) FILTER (WHERE dedupe_hit = true)::int          AS dedupe_hit
                   FROM ' . self::EVENTS_TABLE . '
                  WHERE rule_id IN (' . $placeholders . ')
                  GROUP BY rule_id'
            );
            $stmt->execute($params);
            $rows   = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $result = [];
            if (is_array($rows)) {
                foreach ($rows as $row) {
                    $result[(string) $row['rule_id']] = [
                        'total_events'    => (int) ($row['total_events']    ?? 0),
                        'last_trigger'    => $row['last_trigger'] ?? null,
                        'tickets_created' => (int) ($row['tickets_created'] ?? 0),
                        'cooldown_skipped'=> (int) ($row['cooldown_skipped']?? 0),
                        'dedupe_hit'      => (int) ($row['dedupe_hit']      ?? 0),
                    ];
                }
            }
            return $result;
        } catch (Throwable) {
            return [];
        }
    }

    // ── Dry-run ───────────────────────────────────────────────────────────────

    /**
     * Simulates rule evaluation against the current asset cache snapshot.
     * NEVER creates a ticket. NEVER sends WhatsApp. NEVER writes any event.
     * NEVER modifies rule enabled state.
     *
     * Redis cooldown is NOT checked (read-only from DB only).
     * Condition evaluation is supported for: host_offline, host_not_seen,
     * missing_equipment_tag, missing_entity_mapping.
     * Complex conditions (hardware_change, low_disk, low_memory) return
     * 'condition_requires_full_sync' for affected hosts.
     *
     * @return array{
     *   ok: bool,
     *   rule_id: string,
     *   rule_name: string,
     *   alarm_type: string,
     *   hosts_in_scope: int,
     *   hosts_triggering: list<array{host_id: string, hostname: string, reason: string}>,
     *   hosts_safe: int,
     *   suppressed_by_dedupe_today: int,
     *   would_create_ticket_if_enabled: bool,
     *   blocked_by_policy: list<string>,
     *   cooldown_note: string,
     *   condition_note: string,
     *   errors: list<string>
     * }
     */
    public function dryRunRule(string $ruleId): array
    {
        $empty = [
            'ok'                            => false,
            'rule_id'                       => $ruleId,
            'rule_name'                     => '',
            'alarm_type'                    => '',
            'hosts_in_scope'                => 0,
            'hosts_triggering'              => [],
            'hosts_safe'                    => 0,
            'suppressed_by_dedupe_today'    => 0,
            'would_create_ticket_if_enabled'=> false,
            'blocked_by_policy'             => [],
            'cooldown_note'                 => 'Redis não verificado em dry-run (read-only de DB apenas).',
            'condition_note'                => '',
            'errors'                        => [],
        ];

        $ruleId = trim($ruleId);
        if ($ruleId === '') {
            $empty['errors'][] = 'rule_id obrigatório.';
            return $empty;
        }

        try {
            $pdo  = $this->getPdo();

            // 1. Load rule
            $stmt = $pdo->prepare(
                'SELECT id::text, rule_name, alarm_type, enabled, condition_payload,
                        glpi_entities_id, glpi_group_id, glpi_itil_category_id,
                        create_ticket, cooldown_minutes
                   FROM ' . self::RULES_TABLE . ' WHERE id = :id::uuid'
            );
            $stmt->execute([':id' => $ruleId]);
            $rule = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!is_array($rule)) {
                $empty['errors'][] = 'Regra não encontrada.';
                return $empty;
            }

            $alarmType    = (string) ($rule['alarm_type'] ?? '');
            $condPayload  = json_decode((string) ($rule['condition_payload'] ?? '{}'), true) ?? [];
            $createTicket = (bool) ($rule['create_ticket'] ?? false);
            $isAlertOnly  = in_array($alarmType, self::ALERT_ONLY_TYPES, true);

            $result                  = $empty;
            $result['ok']            = true;
            $result['rule_name']     = (string) ($rule['rule_name'] ?? '');
            $result['alarm_type']    = $alarmType;

            // 2. Blocked-by-policy checks
            $blockedBy = [];
            if (in_array($alarmType, self::FORBIDDEN_TYPES, true)) {
                $blockedBy[] = "Tipo '$alarmType' proibido por policy.";
            }
            if ($isAlertOnly) {
                $blockedBy[] = "Tipo '$alarmType' é alert-only — nunca cria ticket.";
            }
            $result['blocked_by_policy']             = $blockedBy;
            $result['would_create_ticket_if_enabled'] = !$isAlertOnly && $createTicket
                && (int) ($rule['glpi_entities_id'] ?? 0) > 0
                && !empty($rule['glpi_itil_category_id'])
                && !empty($rule['glpi_group_id']);

            // 3. Load targets
            $tStmt = $pdo->prepare(
                'SELECT host_id, hostname FROM ' . self::TARGETS_TABLE . ' WHERE rule_id = :id::uuid ORDER BY hostname ASC'
            );
            $tStmt->execute([':id' => $ruleId]);
            $targets = $tStmt->fetchAll(PDO::FETCH_ASSOC);
            if (!is_array($targets)) {
                $targets = [];
            }

            if ($targets === []) {
                // No explicit targets → would evaluate ALL hosts in entity (can't enumerate without entity map)
                $result['condition_note'] = 'Sem alvos explícitos: em produção avaliaria TODOS os hosts da entidade. Dry-run não pode enumerar hosts sem alvo específico.';
                $result['hosts_in_scope'] = 0;
                return $result;
            }

            // 4. Fetch host statuses from asset cache
            $hostIds      = array_column($targets, 'host_id');
            $hPlaceholders = implode(', ', array_map(static fn (int $i) => ':h' . $i, array_keys($hostIds)));
            $hParams       = [];
            foreach ($hostIds as $i => $hid) {
                $hParams[':h' . $i] = $hid;
            }
            $cStmt = $pdo->prepare(
                'SELECT logmein_host_external_id AS host_id,
                        host_name_sanitized      AS hostname,
                        COALESCE(equipment_tag, \'\') AS equipment_tag,
                        status,
                        last_seen_at,
                        glpi_entity_candidate_id
                   FROM ' . self::ASSET_CACHE_TABLE . '
                  WHERE logmein_host_external_id IN (' . $hPlaceholders . ')'
            );
            $cStmt->execute($hParams);
            $cacheRows = $cStmt->fetchAll(PDO::FETCH_ASSOC);
            $cacheMap  = [];
            if (is_array($cacheRows)) {
                foreach ($cacheRows as $cr) {
                    $cacheMap[(string) $cr['host_id']] = $cr;
                }
            }

            // 5. Dedupe check: event_hash = sha256(rule_id || host_id || alarm_type || YYYY-MM-DD)
            $dateUtc        = (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d');
            $dedupeHitCount = 0;

            // 6. Evaluate each target
            $triggering    = [];
            $safeCount     = 0;
            $complexTypes  = ['hardware_change', 'low_disk', 'low_memory'];
            $conditionNote = '';

            if (in_array($alarmType, $complexTypes, true)) {
                $conditionNote = "Tipo '$alarmType' requer comparação de inventário completo. Dry-run marca condição como 'requer_sync_completo'.";
            }

            foreach ($targets as $target) {
                $hostId   = (string) ($target['host_id'] ?? '');
                $hostname = (string) ($target['hostname'] ?? $hostId);
                $cache    = $cacheMap[$hostId] ?? null;

                if ($cache === null) {
                    $triggering[] = ['host_id' => $hostId, 'hostname' => $hostname, 'reason' => 'host_nao_encontrado_no_cache'];
                    continue;
                }

                $conditionMet = false;
                $reason       = 'condicao_nao_avaliada';

                switch ($alarmType) {
                    case 'host_offline':
                        $conditionMet = (string) ($cache['status'] ?? 'unknown') !== 'online';
                        $reason       = 'status=' . ($cache['status'] ?? 'unknown');
                        break;

                    case 'host_not_seen':
                        $notSeenDays = (int) ($condPayload['not_seen_days'] ?? 7);
                        $lastSeen    = $cache['last_seen_at'] ?? null;
                        if ($lastSeen === null) {
                            $conditionMet = true;
                            $reason       = 'last_seen_at=null';
                        } else {
                            $ts           = strtotime((string) $lastSeen);
                            $cutoff       = strtotime("-{$notSeenDays} days");
                            $conditionMet = $ts !== false && $ts < $cutoff;
                            $reason       = 'last_seen_at=' . substr((string) $lastSeen, 0, 10);
                        }
                        break;

                    case 'missing_equipment_tag':
                        $conditionMet = trim((string) ($cache['equipment_tag'] ?? '')) === '';
                        $reason       = 'equipment_tag=' . (trim((string) ($cache['equipment_tag'] ?? '')) === '' ? 'vazio' : 'presente');
                        break;

                    case 'missing_entity_mapping':
                        $entityCandId = $cache['glpi_entity_candidate_id'] ?? null;
                        $conditionMet = ($entityCandId === null || (int) $entityCandId === 0);
                        $reason       = 'entity_candidate=' . ($entityCandId ?? 'null');
                        break;

                    default:
                        // complex types: hardware_change, low_disk, low_memory
                        $reason = 'requer_sync_completo';
                        $conditionMet = false;
                        break;
                }

                if (!$conditionMet) {
                    $safeCount++;
                    continue;
                }

                // Dedupe check (DB, read-only)
                $eventHash = hash('sha256', $ruleId . $hostId . $alarmType . $dateUtc);
                $dStmt     = $pdo->prepare(
                    'SELECT 1 FROM ' . self::EVENTS_TABLE . ' WHERE event_hash = :hash LIMIT 1'
                );
                $dStmt->execute([':hash' => $eventHash]);
                $alreadyFired = $dStmt->fetch(PDO::FETCH_ASSOC) !== false;

                if ($alreadyFired) {
                    $dedupeHitCount++;
                } else {
                    $triggering[] = ['host_id' => $hostId, 'hostname' => $hostname, 'reason' => $reason];
                }
            }

            $result['hosts_in_scope']             = count($targets);
            $result['hosts_triggering']            = $triggering;
            $result['hosts_safe']                  = $safeCount;
            $result['suppressed_by_dedupe_today']  = $dedupeHitCount;
            $result['condition_note']              = $conditionNote;

            return $result;
        } catch (Throwable $e) {
            $empty['errors'][] = 'Erro interno: ' . $e->getMessage();
            return $empty;
        }
    }

    // ── Supervisor internal alert ──────────────────────────────────────────────

    private const ALERTS_TABLE = 'glpi_plugin_integaglpi_ai_online_alerts';

    /**
     * Creates an internal supervisor alert in the existing AI alerts table.
     * NEVER sends WhatsApp. Only writes an internal alert row for the supervisor UI.
     *
     * @param  string $context  'dry_run' | 'worker_fired'
     * @param  string $severity 'low' | 'medium' | 'high'
     */
    public function createInternalAlert(
        string $ruleId,
        string $ruleName,
        string $alarmType,
        int    $firedCount,
        string $context  = 'dry_run',
        string $severity = 'medium'
    ): bool {
        $severity = in_array($severity, ['low', 'medium', 'high'], true) ? $severity : 'medium';
        $alertId  = 'logmein_alarm:' . $context . ':' . hash('sha256', $ruleId . $context . date('Y-m-d-H'));

        try {
            $pdo  = $this->getPdo();
            $stmt = $pdo->prepare(
                'INSERT INTO ' . self::ALERTS_TABLE . '
                   (alert_id, conversation_id, alert_type, severity, confidence_score,
                    evidence_summary_sanitized, recommended_human_action, source_signals_json, status)
                 VALUES
                   (:alert_id, :conv_id, :alert_type, :severity, :score,
                    :evidence, :action, :signals::jsonb, \'open\')
                 ON CONFLICT (alert_id) DO NOTHING'
            );
            $stmt->execute([
                ':alert_id'   => $alertId,
                ':conv_id'    => 'logmein:' . $ruleId,
                ':alert_type' => 'logmein_alarm_' . $context,
                ':severity'   => $severity,
                ':score'      => min(100, max(0, $firedCount * 20)),
                ':evidence'   => mb_substr(
                    "Regra LogMeIn '{$ruleName}' ({$alarmType}): {$firedCount} host(s) disparariam em {$context}.",
                    0, 500, 'UTF-8'
                ),
                ':action'     => 'Revisar regra de alarme LogMeIn e confirmar se automação deve ser habilitada.',
                ':signals'    => json_encode([
                    'rule_id'    => $ruleId,
                    'rule_name'  => $ruleName,
                    'alarm_type' => $alarmType,
                    'fired'      => $firedCount,
                    'context'    => $context,
                ], JSON_THROW_ON_ERROR),
            ]);
            return true;
        } catch (Throwable) {
            return false;
        }
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private function getPdo(): PDO
    {
        if ($this->pdo === null) {
            $this->pdo = ExternalDatabase::getConnection($this->config->getConnectionConfig());
        }
        return $this->pdo;
    }
}
