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
    private const SYNC_AUDIT_TABLE = 'glpi_plugin_integaglpi_logmein_sync_audit';
    private const CONTRACTS_TABLE = 'glpi_plugin_integaglpi_entity_contracts';
    private const HOUR_ADJUSTMENTS_TABLE = 'glpi_plugin_integaglpi_hour_adjustments';
    private const FALLBACK_MESSAGE = 'Contexto de ativo temporariamente indisponível.';
    private const REPORT_MAX_DAYS = 31;
    private const REPORT_LIMIT = 50;

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
        SecurityAuditService::logLogmeinEvidenceViewed($ticketId, [
            'conversation_hash' => $this->hash((string) ($conversation['conversation_id'] ?? '')),
            'source' => 'ticket_tab_logmein_context',
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

            $tagPlaceholders = [];
            $params = [':ticket_id' => $ticketId];
            foreach ($this->extractEquipmentTags($ticketId, $conversation) as $index => $tag) {
                $placeholder = ':tag_' . $index;
                $tagPlaceholders[] = $placeholder;
                $params[$placeholder] = $tag;
            }
            $tagWhere = $tagPlaceholders === [] ? '' : ' OR a.equipment_tag IN (' . implode(', ', $tagPlaceholders) . ')';

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
                 WHERE a.glpi_ticket_id = :ticket_id" . $tagWhere . "
                 ORDER BY a.cache_updated_at DESC NULLS LAST, a.id DESC
                 LIMIT 5"
            );
            $statement->execute($params);
            $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
            if (!is_array($rows) || $rows === []) {
                return array_merge($base, ['status' => 'empty_cache']);
            }

            $items = [];
            foreach ($rows as $row) {
                $mappedEntityId = (int) ($row['mapped_entity_id'] ?? 0);
                $cacheEntityId = (int) ($row['glpi_entity_candidate_id'] ?? 0);
                $rawTag = $this->sanitizeText((string) ($row['equipment_tag'] ?? ''), 80);
                $tagQuality = $this->classifyEquipmentTag($rawTag);
                $confidence = max(
                    (int) ($row['confidence_score'] ?? 0),
                    (int) ($row['mapped_confidence_score'] ?? 0)
                );
                $warnings = [];
                if ($tagQuality === 'missing') {
                    $warnings[] = __('Sem etiqueta válida no LogMeIn.', 'glpiintegaglpi');
                } elseif ($tagQuality === 'invalid') {
                    $warnings[] = __('Etiqueta LogMeIn fora do padrão de 4 dígitos.', 'glpiintegaglpi');
                }
                $items[] = [
                    'host_external_hash' => $this->hash((string) ($row['logmein_host_external_id'] ?? '')),
                    'group_external_hash' => $this->hash((string) ($row['logmein_group_external_id'] ?? '')),
                    'group_name' => $this->sanitizeText((string) ($row['logmein_group_name'] ?? '')),
                    'host_name' => $this->sanitizeText((string) ($row['host_name_sanitized'] ?? '')),
                    'equipment_tag' => $tagQuality === 'valid' ? $rawTag : '',
                    'raw_equipment_tag_status' => $tagQuality,
                    'status' => $this->sanitizeStatus((string) ($row['status'] ?? 'unknown')),
                    'last_seen_at' => $this->sanitizeText((string) ($row['last_seen_at'] ?? ''), 80),
                    'last_sync_at' => $this->sanitizeText((string) ($row['cache_updated_at'] ?? ''), 80),
                    'entity_candidate_id' => $mappedEntityId > 0 ? $mappedEntityId : $cacheEntityId,
                    'confidence_score' => min(100, max(0, $confidence)),
                    'warnings' => $warnings,
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
            $entityId = (int) ($row['glpi_entity_id'] ?? 0);

            return [
                'id' => (int) ($row['id'] ?? 0),
                'logmein_group_name' => $this->sanitizeText((string) ($row['logmein_group_name'] ?? '')),
                'glpi_entity_id' => $entityId,
                'glpi_entity_label' => $this->findGlpiEntityLabel($entityId) ?? '',
                'confidence_score' => (int) ($row['confidence_score'] ?? 0),
                'is_active' => (bool) ($row['is_active'] ?? false),
                'updated_at' => $this->sanitizeText((string) ($row['updated_at'] ?? ''), 80),
            ];
        }, $rows);
    }

    /**
     * @return list<array{id:int,name:string}>
     */
    public function listAllowedEntities(): array
    {
        global $DB;

        if (!isset($DB) || !is_object($DB) || !method_exists($DB, 'request')) {
            return [];
        }

        try {
            if (method_exists($DB, 'tableExists') && !$DB->tableExists('glpi_entities')) {
                return [];
            }

            $criteria = [
                'SELECT' => ['id', 'name', 'completename'],
                'FROM' => 'glpi_entities',
                'ORDER' => ['completename', 'name', 'id'],
                'LIMIT' => 500,
            ];

            $activeEntityIds = $this->getActiveEntityIds();
            if ($activeEntityIds !== []) {
                $criteria['WHERE'] = ['id' => $activeEntityIds];
            }

            $entities = [];
            foreach ($DB->request($criteria) as $row) {
                $id = (int) ($row['id'] ?? 0);
                if ($id <= 0 || !$this->canUseEntity($id)) {
                    continue;
                }

                $label = $this->formatGlpiEntityLabel($row);
                if ($label === '') {
                    $label = sprintf(__('Entidade #%d', 'glpiintegaglpi'), $id);
                }

                $entities[] = [
                    'id' => $id,
                    'name' => $label,
                ];
            }

            return $entities;
        } catch (Throwable $exception) {
            error_log('[integaglpi][logmein_mapping][entities] ' . $this->sanitizeText($exception->getMessage(), 180));

            return [];
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listCachedGroups(): array
    {
        if (!$this->pluginConfigService->isConfigured() || !$this->tableExists(self::ASSET_CACHE_TABLE)) {
            return [];
        }

        $statement = $this->getPdo()->query(
            "SELECT
                logmein_group_external_id,
                logmein_group_name,
                COUNT(*) AS hosts_count,
                MAX(cache_updated_at) AS last_cache_update
             FROM " . self::ASSET_CACHE_TABLE . "
             WHERE logmein_group_external_id IS NOT NULL
               AND logmein_group_external_id <> ''
             GROUP BY logmein_group_external_id, logmein_group_name
             ORDER BY logmein_group_name ASC
             LIMIT 200"
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
                'logmein_group_external_id' => $this->sanitizeText((string) ($row['logmein_group_external_id'] ?? ''), 160),
                'logmein_group_name' => $this->sanitizeText((string) ($row['logmein_group_name'] ?? ''), 160),
                'hosts_count' => (int) ($row['hosts_count'] ?? 0),
                'last_cache_update' => $this->sanitizeText((string) ($row['last_cache_update'] ?? ''), 80),
            ];
        }, $rows);
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listHostsPreview(string $groupExternalId): array
    {
        $groupExternalId = $this->sanitizeText($groupExternalId, 160);
        if ($groupExternalId === '' || !$this->pluginConfigService->isConfigured() || !$this->tableExists(self::ASSET_CACHE_TABLE)) {
            return [];
        }

        $statement = $this->getPdo()->prepare(
            "SELECT host_name_sanitized, equipment_tag, status, last_seen_at
             FROM " . self::ASSET_CACHE_TABLE . "
             WHERE logmein_group_external_id = :group_id
             ORDER BY cache_updated_at DESC NULLS LAST, host_name_sanitized ASC
             LIMIT 10"
        );
        $statement->execute([':group_id' => $groupExternalId]);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
        if (!is_array($rows)) {
            return [];
        }

        return array_map(function (array $row): array {
            return [
                'host_name' => $this->sanitizeText((string) ($row['host_name_sanitized'] ?? ''), 160),
                'equipment_tag' => $this->sanitizeText((string) ($row['equipment_tag'] ?? ''), 20),
                'status' => $this->sanitizeStatus((string) ($row['status'] ?? 'unknown')),
                'last_seen_at' => $this->sanitizeText((string) ($row['last_seen_at'] ?? ''), 80),
            ];
        }, $rows);
    }

    /**
     * @return array{groups_count:int,hosts_count:int,last_cache_update:string}
     */
    public function getCacheSummary(): array
    {
        $base = [
            'groups_count' => 0,
            'hosts_count' => 0,
            'last_cache_update' => '',
        ];
        if (!$this->pluginConfigService->isConfigured() || !$this->tableExists(self::ASSET_CACHE_TABLE)) {
            return $base;
        }

        $statement = $this->getPdo()->query(
            "SELECT
                COUNT(*) AS hosts_count,
                COUNT(DISTINCT NULLIF(logmein_group_external_id, '')) AS groups_count,
                MAX(cache_updated_at) AS last_cache_update
             FROM " . self::ASSET_CACHE_TABLE
        );
        if ($statement === false) {
            return $base;
        }
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return $base;
        }

        return [
            'groups_count' => (int) ($row['groups_count'] ?? 0),
            'hosts_count' => (int) ($row['hosts_count'] ?? 0),
            'last_cache_update' => $this->sanitizeText((string) ($row['last_cache_update'] ?? ''), 80),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function getInventoryQualityReport(): array
    {
        $base = [
            'status' => 'unavailable',
            'hosts_without_tag' => 0,
            'invalid_tags' => 0,
            'duplicated_tags' => [],
            'groups_without_entity' => [],
            'generated_at' => gmdate('c'),
            'read_only' => true,
        ];
        if (!$this->pluginConfigService->isConfigured() || !$this->tableExists(self::ASSET_CACHE_TABLE)) {
            return $base;
        }

        SecurityAuditService::logLogmeinReportGenerated('logmein_inventory_quality', [
            'read_only' => true,
            'scope' => 'cache_summary',
        ]);

        $hostsWithoutTag = (int) $this->fetchScalar(
            "SELECT COUNT(*)
             FROM " . self::ASSET_CACHE_TABLE . "
             WHERE COALESCE(equipment_tag, '') = ''"
        );
        $invalidTags = (int) $this->fetchScalar(
            "SELECT COUNT(*)
             FROM " . self::ASSET_CACHE_TABLE . "
             WHERE COALESCE(equipment_tag, '') <> ''
               AND equipment_tag !~ '^[0-9]{4}$'"
        );
        $duplicates = $this->fetchRows(
            "SELECT equipment_tag, COUNT(*) AS hosts_count
             FROM " . self::ASSET_CACHE_TABLE . "
             WHERE COALESCE(equipment_tag, '') <> ''
               AND equipment_tag ~ '^[0-9]{4}$'
             GROUP BY equipment_tag
             HAVING COUNT(*) > 1
             ORDER BY hosts_count DESC, equipment_tag ASC
             LIMIT 20"
        );
        $groupsWithoutEntity = [];
        if ($this->tableExists(self::GROUP_MAP_TABLE)) {
            $groupsWithoutEntity = $this->fetchRows(
                "SELECT a.logmein_group_external_id, a.logmein_group_name, COUNT(*) AS hosts_count
                 FROM " . self::ASSET_CACHE_TABLE . " a
                 LEFT JOIN " . self::GROUP_MAP_TABLE . " m
                   ON m.logmein_group_external_id = a.logmein_group_external_id
                  AND m.is_active = TRUE
                 WHERE COALESCE(a.logmein_group_external_id, '') <> ''
                   AND m.id IS NULL
                 GROUP BY a.logmein_group_external_id, a.logmein_group_name
                 ORDER BY hosts_count DESC, a.logmein_group_name ASC
                 LIMIT 20"
            );
        }

        return [
            ...$base,
            'status' => 'available',
            'hosts_without_tag' => $hostsWithoutTag,
            'invalid_tags' => $invalidTags,
            'duplicated_tags' => array_map(function (array $row): array {
                return [
                    'equipment_tag' => $this->sanitizeText((string) ($row['equipment_tag'] ?? ''), 20),
                    'hosts_count' => (int) ($row['hosts_count'] ?? 0),
                ];
            }, $duplicates),
            'groups_without_entity' => array_map(function (array $row): array {
                return [
                    'logmein_group_external_id_hash' => $this->hash((string) ($row['logmein_group_external_id'] ?? '')),
                    'logmein_group_name' => $this->sanitizeText((string) ($row['logmein_group_name'] ?? '')),
                    'hosts_count' => (int) ($row['hosts_count'] ?? 0),
                ];
            }, $groupsWithoutEntity),
        ];
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function buildOperationalReports(array $input): array
    {
        $filters = $this->normalizeReportFilters($input);
        $base = [
            'status' => 'unavailable',
            'filters' => $filters,
            'entity_options' => $this->listAllowedEntities(),
            'kpis' => $this->emptyReportKpis(),
            'rows' => [],
            'quality' => [],
            'contracts' => $this->emptyContractSummary(),
            'pagination' => [
                'page' => $filters['page'],
                'limit' => $filters['limit'],
                'total' => 0,
                'has_previous' => $filters['page'] > 1,
                'has_next' => false,
            ],
            'errors' => [],
            'read_only' => true,
            'non_punitive' => true,
            'remote_execution' => false,
            'max_window_days' => self::REPORT_MAX_DAYS,
            'pagination_limit' => self::REPORT_LIMIT,
        ];

        if (!$this->canViewLogmeinReports()) {
            SecurityAuditService::logAccessDenied(SecurityPermissionService::RIGHT_VIEW_CONTRACTS_READONLY, [
                'endpoint' => 'logmein.reports.php',
                'action' => 'view',
            ]);

            return array_merge($base, ['status' => 'access_denied']);
        }
        if (!$this->pluginConfigService->isConfigured() || !$this->tableExists(self::ASSET_CACHE_TABLE)) {
            return array_merge($base, ['status' => 'migration_required']);
        }
        if ($filters['entity_id'] <= 0) {
            return array_merge($base, [
                'status' => 'filter_required',
                'errors' => [__('Selecione uma entidade e período para gerar o relatório LogMeIn.', 'glpiintegaglpi')],
            ]);
        }
        if (!SecurityPermissionService::enforceEntityScope($filters['entity_id'])) {
            SecurityAuditService::logAccessDenied(SecurityPermissionService::RIGHT_VIEW_CONTRACTS_READONLY, [
                'endpoint' => 'logmein.reports.php',
                'action' => 'view',
                'glpi_entity_id' => $filters['entity_id'],
                'reason' => 'entity_scope_denied',
            ]);

            return array_merge($base, ['status' => 'access_denied']);
        }

        SecurityAuditService::logLogmeinReportViewed('logmein_operational_reports', [
            'glpi_entity_id' => $filters['entity_id'],
            'date_from' => $filters['date_from'],
            'date_to' => $filters['date_to'],
            'report_type' => $filters['report_type'],
            'page' => $filters['page'],
            'limit' => $filters['limit'],
        ]);

        $where = $this->buildReportWhereSql($filters);
        $total = (int) $this->fetchPreparedScalar(
            'SELECT COUNT(*) FROM ' . self::ASSET_CACHE_TABLE . ' a ' . $where['join'] . ' WHERE ' . $where['where'],
            $where['params']
        );
        $offset = ($filters['page'] - 1) * $filters['limit'];
        $rows = $this->fetchPreparedRows(
            "SELECT
                a.host_name_sanitized,
                a.logmein_group_name,
                a.equipment_tag,
                a.status,
                a.glpi_ticket_id,
                a.cache_updated_at,
                a.last_seen_at,
                COALESCE(m.glpi_entity_id, a.glpi_entity_candidate_id) AS report_entity_id
             FROM " . self::ASSET_CACHE_TABLE . " a
             " . $where['join'] . "
             WHERE " . $where['where'] . "
             ORDER BY COALESCE(a.last_seen_at, a.cache_updated_at) DESC NULLS LAST, a.host_name_sanitized ASC
             LIMIT :limit OFFSET :offset",
            array_merge($where['params'], [
                ':limit' => $filters['limit'],
                ':offset' => $offset,
            ])
        );

        $quality = $this->buildOperationalQuality($filters);
        $contracts = $this->buildContractSummary($filters);

        return array_merge($base, [
            'status' => 'available',
            'kpis' => $this->buildOperationalKpis($filters),
            'rows' => array_map(fn (array $row): array => $this->sanitizeReportRow($row), $rows),
            'quality' => $quality,
            'contracts' => $contracts,
            'pagination' => [
                'page' => $filters['page'],
                'limit' => $filters['limit'],
                'total' => $total,
                'has_previous' => $filters['page'] > 1,
                'has_next' => ($offset + $filters['limit']) < $total,
            ],
        ]);
    }

    /**
     * @param array<string, mixed> $input
     * @return array{ok: bool, filename: string, content: string, error: string}
     */
    public function exportOperationalReportCsv(array $input): array
    {
        if (!$this->canExportLogmeinReports()) {
            SecurityAuditService::logAccessDenied(SecurityPermissionService::RIGHT_EXPORT_OPERATIONAL_REPORTS, [
                'endpoint' => 'logmein.reports.php',
                'action' => 'export_csv',
            ]);

            return ['ok' => false, 'filename' => '', 'content' => '', 'error' => 'forbidden'];
        }

        $report = $this->buildOperationalReports(array_merge($input, ['limit' => self::REPORT_LIMIT, 'page' => 1]));
        if (($report['status'] ?? '') !== 'available') {
            return ['ok' => false, 'filename' => '', 'content' => '', 'error' => (string) ($report['status'] ?? 'unavailable')];
        }

        $filters = is_array($report['filters'] ?? null) ? $report['filters'] : $this->normalizeReportFilters($input);
        $output = fopen('php://temp', 'w+');
        if ($output === false) {
            return ['ok' => false, 'filename' => '', 'content' => '', 'error' => 'csv_unavailable'];
        }

        fputcsv($output, [
            'entidade_id',
            'periodo_de',
            'periodo_ate',
            'host',
            'grupo',
            'etiqueta',
            'status',
            'ticket',
            'ultima_evidencia',
            'origem',
        ], ';');

        foreach (($report['rows'] ?? []) as $row) {
            if (!is_array($row)) {
                continue;
            }
            fputcsv($output, array_map([$this, 'sanitizeCsvCell'], [
                (string) ($filters['entity_id'] ?? ''),
                (string) ($filters['date_from'] ?? ''),
                (string) ($filters['date_to'] ?? ''),
                (string) ($row['host_name'] ?? ''),
                (string) ($row['group_name'] ?? ''),
                (string) ($row['equipment_tag'] ?? ''),
                (string) ($row['status'] ?? ''),
                (string) ($row['ticket_id'] ?? ''),
                (string) ($row['last_evidence_at'] ?? ''),
                'logmein_cache_readonly',
            ]), ';');
        }

        rewind($output);
        $content = (string) stream_get_contents($output);
        fclose($output);

        SecurityAuditService::logLogmeinReportExported('logmein_operational_reports', [
            'glpi_entity_id' => (int) ($filters['entity_id'] ?? 0),
            'date_from' => (string) ($filters['date_from'] ?? ''),
            'date_to' => (string) ($filters['date_to'] ?? ''),
            'rows_exported' => count($report['rows'] ?? []),
            'csv_sanitized' => true,
        ]);

        return [
            'ok' => true,
            'filename' => sprintf('integaglpi-logmein-%s-%s.csv', (string) ($filters['entity_id'] ?? 'entity'), gmdate('Ymd-His')),
            'content' => $content,
            'error' => '',
        ];
    }

    public function canViewLogmeinReports(): bool
    {
        return SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_VIEW_CONTRACTS_READONLY)
            || SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_EXPORT_OPERATIONAL_REPORTS)
            || SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_MAPPING);
    }

    public function canExportLogmeinReports(): bool
    {
        return SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_EXPORT_OPERATIONAL_REPORTS)
            || SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_EXPORT_EXECUTIVE_REPORTS);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getLastSyncStatus(): ?array
    {
        if (!$this->pluginConfigService->isConfigured() || !$this->tableExists(self::SYNC_AUDIT_TABLE)) {
            return null;
        }

        $statement = $this->getPdo()->query(
            "SELECT event_type, status, payload_json, created_at
             FROM " . self::SYNC_AUDIT_TABLE . "
             ORDER BY id DESC
             LIMIT 1"
        );
        if ($statement === false) {
            return null;
        }
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return null;
        }

        $payload = json_decode((string) ($row['payload_json'] ?? '{}'), true);
        if (!is_array($payload)) {
            $payload = [];
        }

        return [
            'sync_status' => $this->sanitizeText((string) ($row['status'] ?? ''), 40),
            'event_type' => $this->sanitizeText((string) ($row['event_type'] ?? ''), 80),
            'groups_imported' => (int) ($payload['groups_imported'] ?? 0),
            'hosts_imported' => (int) ($payload['hosts_imported'] ?? 0),
            'error_message_sanitized' => $this->sanitizeText((string) ($payload['error_message_sanitized'] ?? ''), 240),
            'created_at' => $this->sanitizeText((string) ($row['created_at'] ?? ''), 80),
        ];
    }

    /**
     * @return array{type:string,message:string}
     */
    public function syncReadonlyCatalog(int $userId): array
    {
        if (!SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_MAPPING)) {
            SecurityAuditService::logAccessDenied(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_MAPPING, [
                'endpoint' => 'logmein.mapping.php',
                'action' => 'sync_logmein',
            ]);

            return ['type' => 'danger', 'message' => __('Sem permissão para sincronizar catálogo LogMeIn.', 'glpiintegaglpi')];
        }

        try {
            $response = (new IntegrationServiceClient($this->pluginConfigService))->syncLogmeinReadonly([
                'requested_by_glpi_user_id' => $userId > 0 ? $userId : null,
                'read_only' => true,
            ]);
            $body = is_array($response['body'] ?? null) ? $response['body'] : [];
            if (!($response['success'] ?? false)) {
                $message = (string) ($body['message'] ?? __('Sincronização LogMeIn indisponível.', 'glpiintegaglpi'));
                return ['type' => 'warning', 'message' => $this->sanitizeText($message, 240)];
            }

            return [
                'type' => 'success',
                'message' => sprintf(
                    __('Sincronização read-only concluída: %d grupos e %d hosts em cache.', 'glpiintegaglpi'),
                    (int) ($body['groups_imported'] ?? 0),
                    (int) ($body['hosts_imported'] ?? 0)
                ),
            ];
        } catch (Throwable $exception) {
            error_log('[integaglpi][logmein_sync][fallback] ' . $this->sanitizeText($exception->getMessage(), 180));

            return ['type' => 'warning', 'message' => __('Sincronização LogMeIn indisponível. Nenhuma alteração foi feita no inventário.', 'glpiintegaglpi')];
        }
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
        if (!$this->entityExists($entityId)) {
            return ['type' => 'danger', 'message' => __('Selecione uma entidade GLPI existente.', 'glpiintegaglpi')];
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

    private function fetchScalar(string $sql): mixed
    {
        $statement = $this->getPdo()->query($sql);
        if ($statement === false) {
            return null;
        }

        return $statement->fetchColumn();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchRows(string $sql): array
    {
        $statement = $this->getPdo()->query($sql);
        if ($statement === false) {
            return [];
        }
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return is_array($rows) ? $rows : [];
    }

    private function classifyEquipmentTag(string $tag): string
    {
        $tag = trim($tag);
        if ($tag === '') {
            return 'missing';
        }

        return preg_match('/^\d{4}$/', $tag) === 1 ? 'valid' : 'invalid';
    }

    /**
     * @param array<string, mixed> $input
     * @return array{entity_id:int,date_from:string,date_to:string,group_external_id:string,report_type:string,page:int,limit:int}
     */
    private function normalizeReportFilters(array $input): array
    {
        $today = new \DateTimeImmutable('today');
        $defaultFrom = $today->modify('-30 days');
        $dateFrom = $this->parseReportDate((string) ($input['date_from'] ?? ''), $defaultFrom);
        $dateTo = $this->parseReportDate((string) ($input['date_to'] ?? ''), $today);
        if ($dateFrom > $dateTo) {
            [$dateFrom, $dateTo] = [$dateTo, $dateFrom];
        }
        if ($dateFrom->diff($dateTo)->days > self::REPORT_MAX_DAYS) {
            $dateFrom = $dateTo->modify('-' . self::REPORT_MAX_DAYS . ' days');
        }

        $reportType = $this->sanitizeText((string) ($input['report_type'] ?? 'summary'), 40);
        if (!in_array($reportType, ['summary', 'quality', 'contracts', 'ticket_evidence'], true)) {
            $reportType = 'summary';
        }

        return [
            'entity_id' => max(0, (int) ($input['entity_id'] ?? 0)),
            'date_from' => $dateFrom->format('Y-m-d'),
            'date_to' => $dateTo->format('Y-m-d'),
            'group_external_id' => $this->sanitizeText((string) ($input['group_external_id'] ?? ''), 160),
            'report_type' => $reportType,
            'page' => max(1, (int) ($input['page'] ?? 1)),
            'limit' => min(self::REPORT_LIMIT, max(10, (int) ($input['limit'] ?? 25))),
        ];
    }

    private function parseReportDate(string $value, \DateTimeImmutable $fallback): \DateTimeImmutable
    {
        $value = trim($value);
        if ($value === '' || preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) !== 1) {
            return $fallback;
        }

        $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        return $date instanceof \DateTimeImmutable ? $date : $fallback;
    }

    /**
     * @param array<string, mixed> $filters
     * @return array{join:string,where:string,params:array<string, mixed>}
     */
    private function buildReportWhereSql(array $filters): array
    {
        $join = 'LEFT JOIN ' . self::GROUP_MAP_TABLE . ' m ON m.logmein_group_external_id = a.logmein_group_external_id AND m.is_active = TRUE';
        $where = [
            '(m.glpi_entity_id = :entity_id OR a.glpi_entity_candidate_id = :entity_id)',
            "COALESCE(a.last_seen_at, a.cache_updated_at) >= CAST(:date_from AS TIMESTAMPTZ)",
            "COALESCE(a.last_seen_at, a.cache_updated_at) < (CAST(:date_to AS DATE) + INTERVAL '1 day')",
        ];
        $params = [
            ':entity_id' => (int) $filters['entity_id'],
            ':date_from' => (string) $filters['date_from'],
            ':date_to' => (string) $filters['date_to'],
        ];
        if ((string) ($filters['group_external_id'] ?? '') !== '') {
            $where[] = 'a.logmein_group_external_id = :group_external_id';
            $params[':group_external_id'] = (string) $filters['group_external_id'];
        }

        return [
            'join' => $join,
            'where' => implode(' AND ', $where),
            'params' => $params,
        ];
    }

    /**
     * @return array<string, int>
     */
    private function emptyReportKpis(): array
    {
        return [
            'hosts_total' => 0,
            'groups_total' => 0,
            'hosts_without_tag' => 0,
            'invalid_tags' => 0,
            'duplicated_tags' => 0,
            'linked_tickets' => 0,
            'hosts_without_ticket' => 0,
            'divergences' => 0,
            'entities_without_group' => 0,
        ];
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<string, int>
     */
    private function buildOperationalKpis(array $filters): array
    {
        $where = $this->buildReportWhereSql($filters);
        $row = $this->fetchPreparedRows(
            "SELECT
                COUNT(*) AS hosts_total,
                COUNT(DISTINCT NULLIF(a.logmein_group_external_id, '')) AS groups_total,
                COUNT(*) FILTER (WHERE COALESCE(a.equipment_tag, '') = '') AS hosts_without_tag,
                COUNT(*) FILTER (WHERE COALESCE(a.equipment_tag, '') <> '' AND a.equipment_tag !~ '^[0-9]{4}$') AS invalid_tags,
                COUNT(*) FILTER (WHERE a.glpi_ticket_id IS NOT NULL AND a.glpi_ticket_id > 0) AS linked_tickets,
                COUNT(*) FILTER (WHERE a.glpi_ticket_id IS NULL OR a.glpi_ticket_id <= 0) AS hosts_without_ticket,
                COUNT(*) FILTER (
                    WHERE a.glpi_entity_candidate_id IS NOT NULL
                      AND m.glpi_entity_id IS NOT NULL
                      AND a.glpi_entity_candidate_id <> m.glpi_entity_id
                ) AS divergences
             FROM " . self::ASSET_CACHE_TABLE . " a
             " . $where['join'] . "
             WHERE " . $where['where'],
            $where['params']
        );
        $first = $row[0] ?? [];
        $kpis = $this->emptyReportKpis();
        foreach (array_keys($kpis) as $key) {
            $kpis[$key] = (int) ($first[$key] ?? 0);
        }
        $kpis['duplicated_tags'] = count($this->fetchPreparedRows(
            "SELECT a.equipment_tag
             FROM " . self::ASSET_CACHE_TABLE . " a
             " . $where['join'] . "
             WHERE " . $where['where'] . "
               AND COALESCE(a.equipment_tag, '') <> ''
               AND a.equipment_tag ~ '^[0-9]{4}$'
             GROUP BY a.equipment_tag
             HAVING COUNT(*) > 1
             LIMIT 51",
            $where['params']
        ));
        $kpis['entities_without_group'] = $this->entityHasLogmeinGroup((int) $filters['entity_id']) ? 0 : 1;

        return $kpis;
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<string, mixed>
     */
    private function buildOperationalQuality(array $filters): array
    {
        $where = $this->buildReportWhereSql($filters);

        return [
            'duplicated_tags' => array_map(fn (array $row): array => [
                'equipment_tag' => $this->sanitizeText((string) ($row['equipment_tag'] ?? ''), 20),
                'hosts_count' => (int) ($row['hosts_count'] ?? 0),
            ], $this->fetchPreparedRows(
                "SELECT a.equipment_tag, COUNT(*) AS hosts_count
                 FROM " . self::ASSET_CACHE_TABLE . " a
                 " . $where['join'] . "
                 WHERE " . $where['where'] . "
                   AND COALESCE(a.equipment_tag, '') <> ''
                   AND a.equipment_tag ~ '^[0-9]{4}$'
                 GROUP BY a.equipment_tag
                 HAVING COUNT(*) > 1
                 ORDER BY hosts_count DESC, a.equipment_tag ASC
                 LIMIT 20",
                $where['params']
            )),
            'groups_without_entity' => array_map(fn (array $row): array => [
                'group_name' => $this->sanitizeText((string) ($row['logmein_group_name'] ?? ''), 160),
                'hosts_count' => (int) ($row['hosts_count'] ?? 0),
            ], $this->fetchRows(
                "SELECT a.logmein_group_name, COUNT(*) AS hosts_count
                 FROM " . self::ASSET_CACHE_TABLE . " a
                 LEFT JOIN " . self::GROUP_MAP_TABLE . " m
                   ON m.logmein_group_external_id = a.logmein_group_external_id
                  AND m.is_active = TRUE
                 WHERE COALESCE(a.logmein_group_external_id, '') <> ''
                   AND m.id IS NULL
                 GROUP BY a.logmein_group_external_id, a.logmein_group_name
                 ORDER BY hosts_count DESC, a.logmein_group_name ASC
                 LIMIT 20"
            )),
        ];
    }

    /**
     * @return array{allocated_hours:float,consumed_hours:float,balance_hours:float,contract_rows:int,source:string}
     */
    private function emptyContractSummary(): array
    {
        return [
            'allocated_hours' => 0.0,
            'consumed_hours' => 0.0,
            'balance_hours' => 0.0,
            'contract_rows' => 0,
            'source' => 'unavailable',
        ];
    }

    /**
     * @param array<string, mixed> $filters
     * @return array{allocated_hours:float,consumed_hours:float,balance_hours:float,contract_rows:int,source:string}
     */
    private function buildContractSummary(array $filters): array
    {
        if (!$this->tableExists(self::CONTRACTS_TABLE) || !$this->tableExists(self::HOUR_ADJUSTMENTS_TABLE)) {
            return $this->emptyContractSummary();
        }

        $rows = $this->fetchPreparedRows(
            "SELECT
                COUNT(*) AS contract_rows,
                COALESCE(SUM(ec.allocated_hours), 0)::numeric AS allocated_hours,
                COALESCE((
                    SELECT SUM(ha.adjusted_hours)
                    FROM " . self::HOUR_ADJUSTMENTS_TABLE . " ha
                    INNER JOIN " . self::CONTRACTS_TABLE . " ec2 ON ec2.id = ha.contract_id
                    WHERE ec2.glpi_entity_id = :entity_id
                      AND ec2.is_active = TRUE
                      AND ha.created_at >= CAST(:date_from AS TIMESTAMPTZ)
                      AND ha.created_at < (CAST(:date_to AS DATE) + INTERVAL '1 day')
                ), 0)::numeric AS consumed_hours
             FROM " . self::CONTRACTS_TABLE . " ec
             WHERE ec.glpi_entity_id = :entity_id
               AND ec.is_active = TRUE",
            [
                ':entity_id' => (int) $filters['entity_id'],
                ':date_from' => (string) $filters['date_from'],
                ':date_to' => (string) $filters['date_to'],
            ]
        );
        $row = $rows[0] ?? [];
        $allocated = (float) ($row['allocated_hours'] ?? 0);
        $consumed = (float) ($row['consumed_hours'] ?? 0);

        return [
            'allocated_hours' => round($allocated, 2),
            'consumed_hours' => round($consumed, 2),
            'balance_hours' => round($allocated - $consumed, 2),
            'contract_rows' => (int) ($row['contract_rows'] ?? 0),
            'source' => 'entity_contracts_readonly',
        ];
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function sanitizeReportRow(array $row): array
    {
        $tag = $this->sanitizeText((string) ($row['equipment_tag'] ?? ''), 20);
        $tagStatus = $this->classifyEquipmentTag($tag);
        $ticketId = (int) ($row['glpi_ticket_id'] ?? 0);

        return [
            'host_name' => $this->sanitizeText((string) ($row['host_name_sanitized'] ?? ''), 160),
            'group_name' => $this->sanitizeText((string) ($row['logmein_group_name'] ?? ''), 160),
            'equipment_tag' => $tagStatus === 'valid' ? $tag : '',
            'tag_status' => $tagStatus,
            'status' => $this->sanitizeStatus((string) ($row['status'] ?? 'unknown')),
            'ticket_id' => $ticketId > 0 ? $ticketId : 0,
            'last_evidence_at' => $this->sanitizeText((string) (($row['last_seen_at'] ?? '') ?: ($row['cache_updated_at'] ?? '')), 80),
            'entity_id' => (int) ($row['report_entity_id'] ?? 0),
            'evidence_source' => 'logmein_cache_readonly',
        ];
    }

    /**
     * @param array<string, mixed> $params
     */
    private function fetchPreparedScalar(string $sql, array $params): mixed
    {
        $statement = $this->getPdo()->prepare($sql);
        foreach ($params as $key => $value) {
            $statement->bindValue((string) $key, $value, is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $statement->execute();

        return $statement->fetchColumn();
    }

    /**
     * @param array<string, mixed> $params
     * @return list<array<string, mixed>>
     */
    private function fetchPreparedRows(string $sql, array $params): array
    {
        $statement = $this->getPdo()->prepare($sql);
        foreach ($params as $key => $value) {
            $statement->bindValue((string) $key, $value, is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $statement->execute();
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return is_array($rows) ? $rows : [];
    }

    private function entityHasLogmeinGroup(int $entityId): bool
    {
        if ($entityId <= 0 || !$this->tableExists(self::GROUP_MAP_TABLE)) {
            return false;
        }

        return (bool) $this->fetchPreparedScalar(
            'SELECT 1 FROM ' . self::GROUP_MAP_TABLE . ' WHERE glpi_entity_id = :entity_id AND is_active = TRUE LIMIT 1',
            [':entity_id' => $entityId]
        );
    }

    private function sanitizeCsvCell(string $value): string
    {
        $value = $this->sanitizeText($value, 240);
        if ($value !== '' && preg_match('/^[=+\-@]/', $value) === 1) {
            return "'" . $value;
        }

        return $value;
    }

    private function entityExists(int $entityId): bool
    {
        return $this->findGlpiEntityLabel($entityId, false) !== null;
    }

    private function findGlpiEntityLabel(int $entityId, bool $requireScope = true): ?string
    {
        global $DB;

        if ($entityId <= 0 || !isset($DB) || !is_object($DB) || !method_exists($DB, 'request')) {
            return null;
        }
        if ($requireScope && !$this->canUseEntity($entityId)) {
            return null;
        }

        try {
            if (method_exists($DB, 'tableExists') && !$DB->tableExists('glpi_entities')) {
                return null;
            }

            foreach ($DB->request([
                'SELECT' => ['id', 'name', 'completename'],
                'FROM' => 'glpi_entities',
                'WHERE' => ['id' => $entityId],
                'LIMIT' => 1,
            ]) as $row) {
                $id = (int) ($row['id'] ?? 0);
                if ($id <= 0) {
                    return null;
                }
                if ($requireScope && !$this->canUseEntity($id)) {
                    return null;
                }

                $label = $this->formatGlpiEntityLabel($row);

                return $label !== '' ? $label : sprintf(__('Entidade #%d', 'glpiintegaglpi'), $id);
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][logmein_mapping][entity_lookup] ' . $this->sanitizeText($exception->getMessage(), 180));

            return null;
        }

        return null;
    }

    /**
     * @param array<string, mixed> $row
     */
    private function formatGlpiEntityLabel(array $row): string
    {
        $label = $this->sanitizeText((string) ($row['completename'] ?? ''), 220);
        if ($label === '') {
            $label = $this->sanitizeText((string) ($row['name'] ?? ''), 220);
        }

        return $label;
    }

    /**
     * @return list<int>
     */
    private function getActiveEntityIds(): array
    {
        try {
            if (class_exists('\Session') && method_exists('\Session', 'getActiveEntities')) {
                $ids = \Session::getActiveEntities();
                if (is_array($ids)) {
                    return array_values(array_filter(array_map('intval', $ids), static fn (int $id): bool => $id > 0));
                }
            }
        } catch (Throwable) {
            return [];
        }

        $entities = $_SESSION['glpiactiveentities'] ?? [];
        if (!is_array($entities)) {
            return [];
        }

        return array_values(array_filter(array_map('intval', $entities), static fn (int $id): bool => $id > 0));
    }

    private function canUseEntity(int $entityId): bool
    {
        if ($entityId <= 0 || !class_exists('\Session')) {
            return false;
        }

        try {
            if (method_exists('\Session', 'haveAccessToEntity')) {
                return (bool) \Session::haveAccessToEntity($entityId);
            }
        } catch (Throwable) {
            return false;
        }

        return in_array($entityId, $this->getActiveEntityIds(), true);
    }

    /**
     * @param array<string, mixed> $conversation
     * @return list<string>
     */
    private function extractEquipmentTags(int $ticketId, array $conversation): array
    {
        $candidates = [
            (string) ($conversation['last_equipment_tag'] ?? ''),
            (string) ($conversation['equipment_tag'] ?? ''),
            (string) ($conversation['last_problem_summary'] ?? ''),
            (string) ($conversation['profile_summary'] ?? ''),
        ];

        foreach (['profile_snapshot', 'profile_snapshot_json', 'contact_profile_snapshot'] as $key) {
            $snapshot = $conversation[$key] ?? null;
            if (is_string($snapshot) && $snapshot !== '') {
                $decoded = json_decode($snapshot, true);
                if (is_array($decoded)) {
                    $candidates[] = (string) ($decoded['last_equipment_tag'] ?? '');
                    $candidates[] = (string) ($decoded['equipment_tag'] ?? '');
                    $candidates[] = (string) ($decoded['last_problem_summary'] ?? '');
                }
            } elseif (is_array($snapshot)) {
                $candidates[] = (string) ($snapshot['last_equipment_tag'] ?? '');
                $candidates[] = (string) ($snapshot['equipment_tag'] ?? '');
                $candidates[] = (string) ($snapshot['last_problem_summary'] ?? '');
            }
        }

        if ($ticketId > 0 && class_exists('\Ticket')) {
            try {
                $ticket = new \Ticket();
                if ($ticket->getFromDB($ticketId)) {
                    $candidates[] = (string) ($ticket->fields['name'] ?? '');
                    $candidates[] = (string) ($ticket->fields['content'] ?? '');
                }
            } catch (Throwable) {
                // Ticket context is optional; fallback remains cache-by-ticket.
            }
        }

        $tags = [];
        foreach ($candidates as $candidate) {
            if (preg_match_all('/(?<!\d)(\d{4})(?!\d)/', $candidate, $matches)) {
                foreach ($matches[1] as $tag) {
                    $tags[$tag] = $tag;
                }
            }
        }

        return array_values($tags);
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
