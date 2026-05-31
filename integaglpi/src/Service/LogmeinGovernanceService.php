<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\Plugin;
use PDO;
use Throwable;

final class LogmeinGovernanceService
{
    private const GROUP_MAP_TABLE = 'glpi_plugin_integaglpi_logmein_group_maps';
    private const ASSET_CACHE_TABLE = 'glpi_plugin_integaglpi_logmein_asset_cache';
    private const FALLBACK_MESSAGE = 'Contexto de ativo temporariamente indisponível.';

    private PluginConfigService $pluginConfigService;

    private ?PDO $pdo = null;

    public function __construct(?PluginConfigService $pluginConfigService = null)
    {
        $this->pluginConfigService = $pluginConfigService ?? new PluginConfigService();
    }

    /**
     * @param array<string, mixed> $conversation
     * @return array<string, mixed>
     */
    public function buildTicketContext(int $ticketId, array $conversation): array
    {
        $base = [
            'status' => 'disabled',
            'message' => __(self::FALLBACK_MESSAGE, 'glpiintegaglpi'),
            'items' => [],
            'suggestions' => [],
            'feature_flag_enabled' => $this->isFeatureEnabled(),
            'read_only' => true,
            'remote_execution' => false,
            'technician_confirmation_required' => true,
            'memory_write_requires_confirmation' => true,
        ];

        if (!SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_VIEW_LOGMEIN_CONTEXT)) {
            return array_merge($base, ['status' => 'access_denied']);
        }

        SecurityAuditService::logLogmeinContextViewed($ticketId, [
            'conversation_hash' => $this->hash((string) ($conversation['conversation_id'] ?? '')),
            'feature_flag_enabled' => $base['feature_flag_enabled'],
        ]);

        if (!$base['feature_flag_enabled']) {
            return $base;
        }

        if (!$this->pluginConfigService->isConfigured()) {
            return array_merge($base, ['status' => 'unconfigured']);
        }

        try {
            if (!$this->tableExists(self::ASSET_CACHE_TABLE) || !$this->tableExists(self::GROUP_MAP_TABLE)) {
                return array_merge($base, ['status' => 'migration_required']);
            }

            $statement = $this->getPdo()->prepare(
                "SELECT
                    a.logmein_host_external_id,
                    a.logmein_group_external_id,
                    a.logmein_group_name,
                    a.host_name_sanitized,
                    a.equipment_tag,
                    a.status,
                    a.last_seen_at,
                    a.glpi_entity_candidate_id,
                    a.confidence_score,
                    a.cache_updated_at,
                    m.glpi_entity_id AS mapped_entity_id,
                    m.confidence_score AS mapped_confidence_score
                 FROM " . self::ASSET_CACHE_TABLE . " a
                 LEFT JOIN " . self::GROUP_MAP_TABLE . " m
                    ON m.logmein_group_external_id = a.logmein_group_external_id
                   AND m.is_active = TRUE
                 WHERE a.glpi_ticket_id = :ticket_id
                 ORDER BY a.cache_updated_at DESC NULLS LAST, a.id DESC
                 LIMIT 5"
            );
            $statement->execute([':ticket_id' => $ticketId]);
            $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
            if (!is_array($rows) || $rows === []) {
                return array_merge($base, ['status' => 'empty_cache']);
            }

            $items = [];
            foreach ($rows as $row) {
                $mappedEntityId = (int) ($row['mapped_entity_id'] ?? 0);
                $cacheEntityId = (int) ($row['glpi_entity_candidate_id'] ?? 0);
                $confidence = max(
                    (int) ($row['confidence_score'] ?? 0),
                    (int) ($row['mapped_confidence_score'] ?? 0)
                );
                $items[] = [
                    'host_external_hash' => $this->hash((string) ($row['logmein_host_external_id'] ?? '')),
                    'group_external_hash' => $this->hash((string) ($row['logmein_group_external_id'] ?? '')),
                    'group_name' => $this->sanitizeText((string) ($row['logmein_group_name'] ?? '')),
                    'host_name' => $this->sanitizeText((string) ($row['host_name_sanitized'] ?? '')),
                    'equipment_tag' => $this->sanitizeText((string) ($row['equipment_tag'] ?? '')),
                    'status' => $this->sanitizeStatus((string) ($row['status'] ?? 'unknown')),
                    'last_seen_at' => $this->sanitizeText((string) ($row['last_seen_at'] ?? ''), 80),
                    'entity_candidate_id' => $mappedEntityId > 0 ? $mappedEntityId : $cacheEntityId,
                    'confidence_score' => min(100, max(0, $confidence)),
                    'confirmation_required' => true,
                ];
            }

            return [
                ...$base,
                'status' => 'available',
                'message' => '',
                'items' => $items,
                'suggestions' => [
                    'email_domain_mapping' => 'suggestion_only',
                    'company_name_mapping' => 'suggestion_only',
                    'logmein_group_mapping' => 'suggestion_only',
                    'equipment_tag_mapping' => 'suggestion_only',
                ],
            ];
        } catch (Throwable $exception) {
            error_log('[integaglpi][logmein_context][fallback] ' . $this->sanitizeText($exception->getMessage(), 180));

            return array_merge($base, ['status' => 'unavailable']);
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listMappings(): array
    {
        if (!$this->pluginConfigService->isConfigured() || !$this->tableExists(self::GROUP_MAP_TABLE)) {
            return [];
        }

        $statement = $this->getPdo()->query(
            "SELECT id, logmein_group_name, glpi_entity_id, confidence_score, is_active, updated_at
             FROM " . self::GROUP_MAP_TABLE . "
             ORDER BY is_active DESC, updated_at DESC
             LIMIT 100"
        );
        if ($statement === false) {
            return [];
        }

        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
        if (!is_array($rows)) {
            return [];
        }

        return array_map(function (array $row): array {
            return [
                'id' => (int) ($row['id'] ?? 0),
                'logmein_group_name' => $this->sanitizeText((string) ($row['logmein_group_name'] ?? '')),
                'glpi_entity_id' => (int) ($row['glpi_entity_id'] ?? 0),
                'confidence_score' => (int) ($row['confidence_score'] ?? 0),
                'is_active' => (bool) ($row['is_active'] ?? false),
                'updated_at' => $this->sanitizeText((string) ($row['updated_at'] ?? ''), 80),
            ];
        }, $rows);
    }

    /**
     * @param array<string, mixed> $input
     * @return array{type:string,message:string}
     */
    public function saveMapping(array $input, int $userId): array
    {
        if (!SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_MAPPING)) {
            SecurityAuditService::logAccessDenied(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_MAPPING, [
                'endpoint' => 'logmein.mapping.php',
                'action' => 'save_mapping',
            ]);

            return ['type' => 'danger', 'message' => __('Sem permissão para gerenciar mapeamentos LogMeIn.', 'glpiintegaglpi')];
        }
        if (!$this->pluginConfigService->isConfigured() || !$this->tableExists(self::GROUP_MAP_TABLE)) {
            return ['type' => 'warning', 'message' => __('Migration 042 pendente. Nenhum mapeamento foi gravado.', 'glpiintegaglpi')];
        }

        $groupId = $this->sanitizeText((string) ($input['logmein_group_external_id'] ?? ''), 160);
        $groupName = $this->sanitizeText((string) ($input['logmein_group_name'] ?? ''), 160);
        $entityId = (int) ($input['glpi_entity_id'] ?? 0);
        $confidence = max(0, min(100, (int) ($input['confidence_score'] ?? 80)));
        if ($groupId === '' || $groupName === '' || $entityId <= 0) {
            return ['type' => 'danger', 'message' => __('Informe grupo LogMeIn e entidade GLPI válidos.', 'glpiintegaglpi')];
        }
        if (!SecurityPermissionService::enforceEntityScope($entityId)) {
            SecurityAuditService::logAccessDenied(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_MAPPING, [
                'endpoint' => 'logmein.mapping.php',
                'action' => 'save_mapping',
                'glpi_entity_id' => $entityId,
                'reason' => 'entity_scope_denied',
            ]);

            return ['type' => 'danger', 'message' => __('A entidade informada está fora do seu escopo autorizado.', 'glpiintegaglpi')];
        }

        $exists = $this->mappingExists($groupId, $entityId);
        $statement = $this->getPdo()->prepare(
            "INSERT INTO " . self::GROUP_MAP_TABLE . "
                (logmein_group_external_id, logmein_group_name, glpi_entity_id, confidence_score, is_active, created_by_glpi_user_id, updated_by_glpi_user_id)
             VALUES (:group_id, :group_name, :entity_id, :confidence, TRUE, :user_id, :user_id)
             ON CONFLICT (logmein_group_external_id, glpi_entity_id)
             DO UPDATE SET
                logmein_group_name = EXCLUDED.logmein_group_name,
                confidence_score = EXCLUDED.confidence_score,
                is_active = TRUE,
                updated_by_glpi_user_id = EXCLUDED.updated_by_glpi_user_id,
                updated_at = NOW()"
        );
        $statement->execute([
            ':group_id' => $groupId,
            ':group_name' => $groupName,
            ':entity_id' => $entityId,
            ':confidence' => $confidence,
            ':user_id' => $userId > 0 ? $userId : null,
        ]);

        SecurityAuditService::logLogmeinMappingChanged($exists ? SecurityAuditService::EVENT_LOGMEIN_MAPPING_UPDATED : SecurityAuditService::EVENT_LOGMEIN_MAPPING_CREATED, [
            'group_hash' => $this->hash($groupId),
            'glpi_entity_id' => $entityId,
            'confidence_score' => $confidence,
        ]);

        return ['type' => 'success', 'message' => __('Mapeamento LogMeIn salvo. O vínculo definitivo continua exigindo confirmação técnica.', 'glpiintegaglpi')];
    }

    /**
     * @return array{type:string,message:string}
     */
    public function disableMapping(int $mappingId, int $userId): array
    {
        if (!SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_MAPPING)) {
            SecurityAuditService::logAccessDenied(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_MAPPING, [
                'endpoint' => 'logmein.mapping.php',
                'action' => 'disable_mapping',
            ]);

            return ['type' => 'danger', 'message' => __('Sem permissão para gerenciar mapeamentos LogMeIn.', 'glpiintegaglpi')];
        }
        if ($mappingId <= 0 || !$this->pluginConfigService->isConfigured() || !$this->tableExists(self::GROUP_MAP_TABLE)) {
            return ['type' => 'warning', 'message' => __('Mapeamento indisponível.', 'glpiintegaglpi')];
        }
        $entityId = $this->findMappingEntityId($mappingId);
        if ($entityId <= 0) {
            return ['type' => 'warning', 'message' => __('Mapeamento indisponível.', 'glpiintegaglpi')];
        }
        if (!SecurityPermissionService::enforceEntityScope($entityId)) {
            SecurityAuditService::logAccessDenied(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_MAPPING, [
                'endpoint' => 'logmein.mapping.php',
                'action' => 'disable_mapping',
                'mapping_id' => $mappingId,
                'glpi_entity_id' => $entityId,
                'reason' => 'entity_scope_denied',
            ]);

            return ['type' => 'danger', 'message' => __('Este mapeamento pertence a uma entidade fora do seu escopo autorizado.', 'glpiintegaglpi')];
        }

        $statement = $this->getPdo()->prepare(
            "UPDATE " . self::GROUP_MAP_TABLE . "
             SET is_active = FALSE, updated_by_glpi_user_id = :user_id, updated_at = NOW()
             WHERE id = :id"
        );
        $statement->execute([
            ':id' => $mappingId,
            ':user_id' => $userId > 0 ? $userId : null,
        ]);
        SecurityAuditService::logLogmeinMappingChanged(SecurityAuditService::EVENT_LOGMEIN_MAPPING_DISABLED, [
            'mapping_id' => $mappingId,
        ]);

        return ['type' => 'success', 'message' => __('Mapeamento desativado.', 'glpiintegaglpi')];
    }

    public function isFeatureEnabled(): bool
    {
        $value = strtolower(Plugin::getRuntimeConfigValue('LOGMEIN_INTEGRATION_ENABLED'));

        return in_array($value, ['1', 'true', 'yes', 'on'], true);
    }

    private function mappingExists(string $groupId, int $entityId): bool
    {
        $statement = $this->getPdo()->prepare(
            "SELECT 1 FROM " . self::GROUP_MAP_TABLE . "
             WHERE logmein_group_external_id = :group_id AND glpi_entity_id = :entity_id
             LIMIT 1"
        );
        $statement->execute([':group_id' => $groupId, ':entity_id' => $entityId]);

        return (bool) $statement->fetchColumn();
    }

    private function findMappingEntityId(int $mappingId): int
    {
        $statement = $this->getPdo()->prepare(
            "SELECT glpi_entity_id
             FROM " . self::GROUP_MAP_TABLE . "
             WHERE id = :id
             LIMIT 1"
        );
        $statement->execute([':id' => $mappingId]);
        $value = $statement->fetchColumn();

        return $value === false || $value === null ? 0 : (int) $value;
    }

    private function tableExists(string $table): bool
    {
        $statement = $this->getPdo()->prepare("SELECT to_regclass(:table_name) IS NOT NULL");
        $statement->bindValue(':table_name', 'public.' . $table);
        $statement->execute();

        return (bool) $statement->fetchColumn();
    }

    private function getPdo(): PDO
    {
        if ($this->pdo instanceof PDO) {
            return $this->pdo;
        }

        $this->pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());

        return $this->pdo;
    }

    private function sanitizeText(string $value, int $limit = 160): string
    {
        $value = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $value = preg_replace('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[email]', $value) ?? $value;
        $value = preg_replace('/\+?\d[\d\s().-]{7,}\d/', '[telefone]', $value) ?? $value;
        $value = preg_replace('/(password|token|bearer|api_key|authorization|secret)\s*[:=]\s*\S+/i', '$1=[redacted]', $value) ?? $value;
        $value = preg_replace('/\s+/u', ' ', $value) ?? $value;

        return mb_substr(trim($value), 0, max(1, $limit), 'UTF-8');
    }

    private function sanitizeStatus(string $value): string
    {
        $value = strtolower(trim($value));

        return in_array($value, ['online', 'offline', 'unknown'], true) ? $value : 'unknown';
    }

    private function hash(string $value): string
    {
        return $value === '' ? '' : hash('sha256', $value);
    }
}
