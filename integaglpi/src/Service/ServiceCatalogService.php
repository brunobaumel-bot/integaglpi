<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use RuntimeException;
use Throwable;

final class ServiceCatalogService
{
    private const TABLE = 'glpi_plugin_integaglpi_service_catalog';
    private const QUEUES_TABLE = 'glpi_plugin_integaglpi_queues';
    private const PRIORITIES = ['', 'low', 'medium', 'high', 'urgent'];

    private ?PDO $pdo = null;

    public function __construct(private readonly PluginConfigService $pluginConfigService)
    {
    }

    /**
     * @param array<string, mixed> $query
     * @param array{type: string, message: string, diagnostic?: string}|null $flash
     * @return array<string, mixed>
     */
    public function getPageData(array $query, ?array $flash = null): array
    {
        $data = [
            'filters' => [
                'status' => $this->normalizeStatus($query['status'] ?? 'active'),
                'queue_id' => max(0, (int) ($query['queue_id'] ?? 0)),
                'edit_id' => max(0, (int) ($query['edit_id'] ?? 0)),
            ],
            'flash' => $flash,
            'error' => '',
            'services' => [],
            'queues' => [],
            'edit_service' => null,
        ];

        if (!$this->pluginConfigService->isConfigured()) {
            $data['error'] = __('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi');
            return $data;
        }

        try {
            if (!$this->tableExists(self::TABLE)) {
                $data['error'] = __('Tabela do catálogo de serviços ainda não existe. Execute a migration em TESTE antes de homologar.', 'glpiintegaglpi');
                return $data;
            }

            $data['queues'] = $this->getQueues();
            $data['services'] = $this->findServices($data['filters']);
            if ($data['filters']['edit_id'] > 0) {
                $data['edit_service'] = $this->findServiceById($data['filters']['edit_id']);
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][service_catalog][load] ' . $exception->getMessage());
            $data['error'] = __('Falha ao carregar catálogo de serviços. Verifique logs do servidor.', 'glpiintegaglpi');
        }

        return $data;
    }

    /**
     * @param array<string, mixed> $post
     * @return array{type: string, message: string, diagnostic?: string}
     */
    public function handlePost(array $post, int $userId): array
    {
        if (!$this->pluginConfigService->isConfigured()) {
            return ['type' => 'danger', 'message' => __('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi')];
        }

        try {
            return match (trim((string) ($post['action'] ?? ''))) {
                'save_service' => $this->saveService($post),
                'disable_service' => $this->setActive((int) ($post['service_id'] ?? 0), false),
                'enable_service' => $this->setActive((int) ($post['service_id'] ?? 0), true),
                default => ['type' => 'danger', 'message' => __('Ação inválida.', 'glpiintegaglpi')],
            };
        } catch (Throwable $exception) {
            error_log('[integaglpi][service_catalog][save] user=' . $userId . ' ' . $exception->getMessage());

            return [
                'type' => 'danger',
                'message' => $exception instanceof RuntimeException
                    ? $exception->getMessage()
                    : __('Falha ao salvar catálogo de serviços.', 'glpiintegaglpi'),
            ];
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getQueues(): array
    {
        if (!$this->tableExists(self::QUEUES_TABLE)) {
            return [];
        }

        $stmt = $this->getPdo()->query(
            'SELECT id, name FROM public.' . self::QUEUES_TABLE . ' ORDER BY name ASC, id ASC'
        );

        return $stmt ? ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];
    }

    /**
     * @param array<string, mixed> $filters
     * @return list<array<string, mixed>>
     */
    private function findServices(array $filters): array
    {
        $where = [];
        $params = [];
        if (($filters['status'] ?? 'active') === 'active') {
            $where[] = 'sc.is_active = TRUE';
        } elseif (($filters['status'] ?? '') === 'inactive') {
            $where[] = 'sc.is_active = FALSE';
        }
        if ((int) ($filters['queue_id'] ?? 0) > 0) {
            $where[] = 'sc.routing_queue_id = :queue_id';
            $params[':queue_id'] = (int) $filters['queue_id'];
        }

        $hasQueuesTable = $this->tableExists(self::QUEUES_TABLE);
        $sql = $hasQueuesTable
            ? 'SELECT sc.*, q.name AS queue_name
                FROM public.' . self::TABLE . ' sc
                LEFT JOIN public.' . self::QUEUES_TABLE . ' q ON q.id = sc.routing_queue_id'
            : 'SELECT sc.*, NULL::text AS queue_name
                FROM public.' . self::TABLE . ' sc';
        if ($where !== []) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY sc.is_active DESC, sc.name ASC LIMIT 100';

        $stmt = $this->getPdo()->prepare($sql);
        foreach ($params as $key => $value) {
            $stmt->bindValue($key, $value, PDO::PARAM_INT);
        }
        $stmt->execute();

        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findServiceById(int $id): ?array
    {
        if ($id <= 0) {
            return null;
        }

        $stmt = $this->getPdo()->prepare('SELECT * FROM public.' . self::TABLE . ' WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return is_array($row) ? $row : null;
    }

    /**
     * @param array<string, mixed> $post
     * @return array{type: string, message: string}
     */
    private function saveService(array $post): array
    {
        if (!$this->tableExists(self::TABLE)) {
            throw new RuntimeException(__('Tabela do catálogo de serviços ainda não existe.', 'glpiintegaglpi'));
        }

        $id = max(0, (int) ($post['service_id'] ?? 0));
        $serviceKey = $this->requireServiceKey($post['service_key'] ?? '');
        $name = $this->requireText($post['name'] ?? '', __('Nome do serviço é obrigatório.', 'glpiintegaglpi'));
        $description = $this->cleanText($post['description'] ?? '');
        $routingQueueId = max(0, (int) ($post['routing_queue_id'] ?? 0)) ?: null;
        $entityId = max(0, (int) ($post['glpi_entity_id'] ?? 0)) ?: null;
        $priority = $this->normalizePriority($post['default_priority'] ?? '');
        $requiredFields = $this->normalizeRequiredFieldsJson($post['required_fields_json'] ?? '[]');
        $slaResponse = $this->positiveIntegerOrNull($post['sla_response_minutes'] ?? null);
        $slaSolution = $this->positiveIntegerOrNull($post['sla_solution_minutes'] ?? null);
        $isActive = !empty($post['is_active']);

        if ($id > 0) {
            $stmt = $this->getPdo()->prepare(
                'UPDATE public.' . self::TABLE . '
                 SET service_key = :service_key,
                     name = :name,
                     description = :description,
                     routing_queue_id = :routing_queue_id,
                     glpi_entity_id = :glpi_entity_id,
                     default_priority = :default_priority,
                     required_fields_json = CAST(:required_fields_json AS jsonb),
                     sla_response_minutes = :sla_response_minutes,
                     sla_solution_minutes = :sla_solution_minutes,
                     is_active = :is_active,
                     updated_at = NOW()
                 WHERE id = :id'
            );
            $this->bindServicePayload($stmt, $id, $serviceKey, $name, $description, $routingQueueId, $entityId, $priority, $requiredFields, $slaResponse, $slaSolution, $isActive);
            $stmt->execute();

            return ['type' => 'success', 'message' => __('Serviço atualizado.', 'glpiintegaglpi')];
        }

        $stmt = $this->getPdo()->prepare(
            'INSERT INTO public.' . self::TABLE . '
              (service_key, name, description, routing_queue_id, glpi_entity_id, default_priority, required_fields_json, sla_response_minutes, sla_solution_minutes, is_active)
             VALUES
              (:service_key, :name, :description, :routing_queue_id, :glpi_entity_id, :default_priority, CAST(:required_fields_json AS jsonb), :sla_response_minutes, :sla_solution_minutes, :is_active)'
        );
        $this->bindServicePayload($stmt, 0, $serviceKey, $name, $description, $routingQueueId, $entityId, $priority, $requiredFields, $slaResponse, $slaSolution, $isActive);
        $stmt->execute();

        return ['type' => 'success', 'message' => __('Serviço criado.', 'glpiintegaglpi')];
    }

    /**
     * @return array{type: string, message: string}
     */
    private function setActive(int $id, bool $active): array
    {
        if ($id <= 0) {
            throw new RuntimeException(__('Serviço inválido.', 'glpiintegaglpi'));
        }

        $stmt = $this->getPdo()->prepare(
            'UPDATE public.' . self::TABLE . ' SET is_active = :is_active, updated_at = NOW() WHERE id = :id'
        );
        $stmt->bindValue(':id', $id, PDO::PARAM_INT);
        $stmt->bindValue(':is_active', $active, PDO::PARAM_BOOL);
        $stmt->execute();

        return [
            'type' => 'success',
            'message' => $active
                ? __('Serviço reativado.', 'glpiintegaglpi')
                : __('Serviço desativado sem remoção física.', 'glpiintegaglpi'),
        ];
    }

    private function bindServicePayload(
        \PDOStatement $stmt,
        int $id,
        string $serviceKey,
        string $name,
        string $description,
        ?int $routingQueueId,
        ?int $entityId,
        ?string $priority,
        string $requiredFieldsJson,
        ?int $slaResponse,
        ?int $slaSolution,
        bool $isActive,
    ): void {
        if ($id > 0) {
            $stmt->bindValue(':id', $id, PDO::PARAM_INT);
        }
        $stmt->bindValue(':service_key', $serviceKey, PDO::PARAM_STR);
        $stmt->bindValue(':name', $name, PDO::PARAM_STR);
        $this->bindNullableString($stmt, ':description', $description);
        $this->bindNullableInt($stmt, ':routing_queue_id', $routingQueueId);
        $this->bindNullableInt($stmt, ':glpi_entity_id', $entityId);
        $this->bindNullableString($stmt, ':default_priority', $priority);
        $stmt->bindValue(':required_fields_json', $requiredFieldsJson, PDO::PARAM_STR);
        $this->bindNullableInt($stmt, ':sla_response_minutes', $slaResponse);
        $this->bindNullableInt($stmt, ':sla_solution_minutes', $slaSolution);
        $stmt->bindValue(':is_active', $isActive, PDO::PARAM_BOOL);
    }

    private function getPdo(): PDO
    {
        if ($this->pdo === null) {
            $this->pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
        }

        return $this->pdo;
    }

    private function tableExists(string $table): bool
    {
        $stmt = $this->getPdo()->prepare(
            'SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = :table LIMIT 1'
        );
        $stmt->execute([':table' => $table]);

        return (bool) $stmt->fetchColumn();
    }

    private function normalizeStatus(mixed $value): string
    {
        $status = trim((string) $value);

        return in_array($status, ['active', 'inactive', 'all'], true) ? $status : 'active';
    }

    private function requireServiceKey(mixed $value): string
    {
        $key = strtolower(trim((string) $value));
        if (!preg_match('/^[a-z0-9][a-z0-9_.-]{1,63}$/', $key)) {
            throw new RuntimeException(__('Chave do serviço inválida. Use letras minúsculas, números, ponto, hífen ou sublinhado.', 'glpiintegaglpi'));
        }

        return $key;
    }

    private function requireText(mixed $value, string $message): string
    {
        $text = $this->cleanText($value);
        if ($text === '') {
            throw new RuntimeException($message);
        }

        return $text;
    }

    private function cleanText(mixed $value): string
    {
        $text = trim((string) $value);
        $text = (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $text);

        return substr($text, 0, 255);
    }

    private function normalizePriority(mixed $value): ?string
    {
        $priority = strtolower(trim((string) $value));
        if (!in_array($priority, self::PRIORITIES, true)) {
            throw new RuntimeException(__('Prioridade padrão inválida.', 'glpiintegaglpi'));
        }

        return $priority === '' ? null : $priority;
    }

    private function normalizeRequiredFieldsJson(mixed $value): string
    {
        $raw = trim((string) $value);
        if ($raw === '') {
            return '[]';
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new RuntimeException(__('Checklist deve ser um JSON array.', 'glpiintegaglpi'));
        }
        foreach ($decoded as $row) {
            if (!is_array($row) || trim((string) ($row['key'] ?? '')) === '' || trim((string) ($row['label'] ?? '')) === '') {
                throw new RuntimeException(__('Cada item do checklist deve ter key e label.', 'glpiintegaglpi'));
            }
        }

        return json_encode(array_values($decoded), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '[]';
    }

    private function positiveIntegerOrNull(mixed $value): ?int
    {
        $integer = (int) $value;

        return $integer > 0 ? $integer : null;
    }

    private function bindNullableString(\PDOStatement $stmt, string $name, ?string $value): void
    {
        if ($value === null || $value === '') {
            $stmt->bindValue($name, null, PDO::PARAM_NULL);
            return;
        }
        $stmt->bindValue($name, $value, PDO::PARAM_STR);
    }

    private function bindNullableInt(\PDOStatement $stmt, string $name, ?int $value): void
    {
        if ($value === null) {
            $stmt->bindValue($name, null, PDO::PARAM_NULL);
            return;
        }
        $stmt->bindValue($name, $value, PDO::PARAM_INT);
    }
}
