<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\External\ExternalSchemaManager;
use GlpiPlugin\Integaglpi\External\Repository\QueueRepository;
use GlpiPlugin\Integaglpi\External\Repository\RoutingOptionRepository;
use PDO;
use RuntimeException;

final class RoutingOptionService
{
    private PluginConfigService $pluginConfigService;

    private ?PDO $pdo = null;

    private ?RoutingOptionRepository $repository = null;

    private ?QueueRepository $queueRepository = null;

    public function __construct(?PluginConfigService $pluginConfigService = null)
    {
        $this->pluginConfigService = $pluginConfigService ?? new PluginConfigService();
    }

    public function isExternalConfigured(): bool
    {
        return $this->pluginConfigService->isConfigured();
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getAll(): array
    {
        if (!$this->isExternalConfigured()) {
            return [];
        }

        return $this->getRepository()->findAll();
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getActive(): array
    {
        if (!$this->isExternalConfigured()) {
            return [];
        }

        return $this->getRepository()->findActive();
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getById(int $id): ?array
    {
        if (!$this->isExternalConfigured()) {
            return null;
        }

        return $this->getRepository()->findById($id);
    }

    /**
     * @param array<string, mixed> $input
     */
    public function save(array $input): int
    {
        $this->assertConfigured();

        $id         = (int) ($input['id'] ?? 0);
        $id         = $id > 0 ? $id : null;
        $optionKey  = trim((string) ($input['option_key'] ?? ''));
        $label      = trim((string) ($input['label'] ?? ''));
        $queueId    = (int) ($input['queue_id'] ?? 0);
        $groupId    = (int) ($input['glpi_group_id'] ?? 0);
        $userId     = (int) ($input['glpi_user_id'] ?? 0);
        $sortOrder  = (int) ($input['sort_order'] ?? 0);
        $confirmation = trim((string) ($input['confirmation_message'] ?? ''));
        $isActive   = isset($input['is_active']) && (bool) $input['is_active'];

        if ($optionKey === '') {
            throw new RuntimeException(__('Option key is required.', 'glpiintegaglpi'));
        }
        if (!preg_match('/^[a-z0-9_]+$/', $optionKey)) {
            throw new RuntimeException(__('Option key may contain only lowercase letters, numbers and underscores.', 'glpiintegaglpi'));
        }
        if ($label === '') {
            throw new RuntimeException(__('Label is required.', 'glpiintegaglpi'));
        }
        if ($queueId > 0 && !$this->getRepository()->queueExists($queueId)) {
            throw new RuntimeException(__('Selected routing queue does not exist.', 'glpiintegaglpi'));
        }
        if ($groupId > 0 && !$this->groupExists($groupId)) {
            throw new RuntimeException(__('Selected GLPI group does not exist.', 'glpiintegaglpi'));
        }
        if ($userId > 0 && !$this->userExists($userId)) {
            throw new RuntimeException(__('Selected GLPI user does not exist.', 'glpiintegaglpi'));
        }

        if ($queueId <= 0 && $groupId <= 0 && $isActive) {
            throw new RuntimeException(__('Active routing options must have a queue or a GLPI group so queue_id can be linked.', 'glpiintegaglpi'));
        }

        if ($groupId > 0) {
            $queueId = $this->ensureQueueForRoutingOption($queueId, $label, $groupId);
        }

        if ($isActive && $queueId <= 0) {
            throw new RuntimeException(__('Active routing option cannot be saved without queue_id.', 'glpiintegaglpi'));
        }

        $payload = [
            'option_key'           => $optionKey,
            'label'                => $label,
            'queue_id'             => $queueId > 0 ? $queueId : null,
            'glpi_group_id'        => $groupId > 0 ? $groupId : null,
            'glpi_user_id'         => $userId > 0  ? $userId  : null,
            'is_active'            => $isActive,
            'sort_order'           => $sortOrder,
            'confirmation_message' => $confirmation !== '' ? $confirmation : null,
        ];

        error_log('[integaglpi][routing_option][save] ' . json_encode([
            'id'      => $id,
            'payload' => $payload,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        if ($id !== null && $this->payloadMatchesCurrent($id, $payload)) {
            return $id;
        }

        $savedId = $this->getRepository()->save($payload, $id);

        error_log('[integaglpi][routing_option][save] saved_id=' . $savedId);

        return $savedId;
    }

    public function delete(int $id): void
    {
        $option = $id > 0 ? $this->getById($id) : null;
        if ($option === null) {
            throw new RuntimeException(__('Routing option not found.', 'glpiintegaglpi'));
        }

        $option['is_active'] = false;
        $this->save($option);
    }

    private function assertConfigured(): void
    {
        if (!$this->isExternalConfigured()) {
            throw new RuntimeException(__('Configure the external PostgreSQL connection before managing routing options.', 'glpiintegaglpi'));
        }
    }

    private function getPdo(): PDO
    {
        if ($this->pdo instanceof PDO) {
            return $this->pdo;
        }

        $this->pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
        ExternalSchemaManager::ensureSchema($this->pdo);

        return $this->pdo;
    }

    private function getRepository(): RoutingOptionRepository
    {
        if ($this->repository instanceof RoutingOptionRepository) {
            return $this->repository;
        }

        $this->repository = new RoutingOptionRepository($this->getPdo());

        return $this->repository;
    }

    private function getQueueRepository(): QueueRepository
    {
        if ($this->queueRepository instanceof QueueRepository) {
            return $this->queueRepository;
        }

        $this->queueRepository = new QueueRepository($this->getPdo());

        return $this->queueRepository;
    }

    private function ensureQueueForRoutingOption(int $queueId, string $label, int $groupId): int
    {
        $payload = [
            'name' => $label,
            'description' => __('Auto-managed by routing option configuration.', 'glpiintegaglpi'),
            'is_active' => true,
            'default_group_id' => $groupId,
        ];

        $repository = $this->getQueueRepository();

        if ($queueId > 0) {
            $currentQueue = $repository->findById($queueId);
            if ($currentQueue === null) {
                throw new RuntimeException(__('Selected routing queue does not exist.', 'glpiintegaglpi'));
            }

            if (
                (string) ($currentQueue['name'] ?? '') !== $label
                || (int) ($currentQueue['default_group_id'] ?? 0) !== $groupId
                || empty($currentQueue['is_active'])
            ) {
                return $repository->save($payload, $queueId);
            }

            return $queueId;
        }

        return $repository->save($payload);
    }

    private function groupExists(int $groupId): bool
    {
        $group = new \Group();

        return $group->getFromDB($groupId);
    }

    private function userExists(int $userId): bool
    {
        $user = new \User();

        return $user->getFromDB($userId);
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function payloadMatchesCurrent(int $id, array $payload): bool
    {
        $current = $this->getById($id);
        if ($current === null) {
            return false;
        }

        return (string) ($current['option_key'] ?? '') === (string) $payload['option_key']
            && (string) ($current['label'] ?? '') === (string) $payload['label']
            && (int) ($current['queue_id'] ?? 0) === (int) ($payload['queue_id'] ?? 0)
            && (int) ($current['glpi_group_id'] ?? 0) === (int) ($payload['glpi_group_id'] ?? 0)
            && (int) ($current['glpi_user_id'] ?? 0) === (int) ($payload['glpi_user_id'] ?? 0)
            && (bool) ($current['is_active'] ?? false) === (bool) $payload['is_active']
            && (int) ($current['sort_order'] ?? 0) === (int) $payload['sort_order']
            && (string) ($current['confirmation_message'] ?? '') === (string) ($payload['confirmation_message'] ?? '');
    }
}
