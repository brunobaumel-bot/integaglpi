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

    // ── Internal ──────────────────────────────────────────────────────────────

    private function getPdo(): PDO
    {
        if ($this->pdo === null) {
            $this->pdo = ExternalDatabase::getConnection($this->config->getConnectionConfig());
        }
        return $this->pdo;
    }
}
