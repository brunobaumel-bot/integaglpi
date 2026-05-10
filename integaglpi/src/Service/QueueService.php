<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\External\ExternalSchemaManager;
use GlpiPlugin\Integaglpi\External\Repository\QueueRepository;
use Group;
use PDO;
use RuntimeException;
use User;

final class QueueService
{
    private PluginConfigService $pluginConfigService;

    private ?PDO $pdo = null;

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
    public function getQueues(): array
    {
        if (!$this->isExternalConfigured()) {
            return [];
        }

        $queues = $this->getQueueRepository()->findAll();
        error_log('[integaglpi][queue][list] total=' . count($queues) . ' items=' . json_encode(
            array_map(
                static fn (array $q): array => ['id' => (int) ($q['id'] ?? 0), 'name' => (string) ($q['name'] ?? '')],
                $queues
            ),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        ));

        return $queues;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getActiveQueues(): array
    {
        if (!$this->isExternalConfigured()) {
            return [];
        }

        $queues = $this->getQueueRepository()->findActive();
        error_log('[integaglpi][queue][list] active_total=' . count($queues) . ' items=' . json_encode(
            array_map(
                static fn (array $q): array => ['id' => (int) ($q['id'] ?? 0), 'name' => (string) ($q['name'] ?? '')],
                $queues
            ),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        ));

        return $queues;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getQueueById(int $queueId): ?array
    {
        if (!$this->isExternalConfigured()) {
            return null;
        }

        return $this->getQueueRepository()->findById($queueId);
    }

    public function saveQueue(array $input): int
    {
        $this->assertExternalConfigured();

        $queueId = (int) ($input['id'] ?? $input['queue_id'] ?? 0);
        $queueId = $queueId > 0 ? $queueId : null;
        $defaultGroupId = (int) ($input['default_group_id'] ?? 0);
        $defaultGroupId = $defaultGroupId > 0 ? $defaultGroupId : null;
        $payload = [
            'name'             => trim((string) ($input['name'] ?? '')),
            'description'      => trim((string) ($input['description'] ?? '')),
            'is_active'        => isset($input['is_active']) ? true : false,
            'default_group_id' => $defaultGroupId,
        ];

        if ($payload['name'] === '') {
            throw new RuntimeException(__('Queue name is required.', 'glpiintegaglpi'));
        }

        if ($queueId !== null && $this->getQueueById($queueId) === null) {
            throw new RuntimeException(sprintf('Queue id %d not found for update', $queueId));
        }

        error_log('[integaglpi][queue][save] payload=' . json_encode([
            'target_id' => $queueId,
            'payload' => $payload,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        $savedId = $this->getQueueRepository()->save($payload, $queueId);
        error_log('[integaglpi][queue][save] saved_id=' . $savedId);

        return $savedId;
    }

    public function deleteQueue(int $queueId): void
    {
        $this->assertQueueExists($queueId);
        $this->getQueueRepository()->delete($queueId);
    }

    public function assignUser(int $queueId, int $userId): void
    {
        $this->assertQueueExists($queueId);

        $user = new User();
        if ($userId <= 0 || !$user->getFromDB($userId)) {
            throw new RuntimeException(__('Selected technician not found.', 'glpiintegaglpi'));
        }

        $this->getQueueRepository()->assignUser($queueId, $userId);
    }

    public function unassignUser(int $queueId, int $userId): void
    {
        $this->assertQueueExists($queueId);
        $this->getQueueRepository()->removeUser($queueId, $userId);
    }

    public function assignGroup(int $queueId, int $groupId): void
    {
        $this->assertQueueExists($queueId);

        $group = new Group();
        if ($groupId <= 0 || !$group->getFromDB($groupId)) {
            throw new RuntimeException(__('Selected group not found.', 'glpiintegaglpi'));
        }

        $this->getQueueRepository()->assignGroup($queueId, $groupId);
    }

    public function unassignGroup(int $queueId, int $groupId): void
    {
        $this->assertQueueExists($queueId);
        $this->getQueueRepository()->removeGroup($queueId, $groupId);
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getQueueUsers(int $queueId): array
    {
        if (!$this->isExternalConfigured()) {
            return [];
        }

        return $this->getQueueRepository()->findUsers($queueId);
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getQueueGroups(int $queueId): array
    {
        if (!$this->isExternalConfigured()) {
            return [];
        }

        return $this->getQueueRepository()->findGroups($queueId);
    }

    private function assertExternalConfigured(): void
    {
        if (!$this->isExternalConfigured()) {
            throw new RuntimeException(__('Configure the external PostgreSQL connection before managing queues.', 'glpiintegaglpi'));
        }
    }

    private function assertQueueExists(int $queueId): void
    {
        if ($queueId <= 0 || $this->getQueueById($queueId) === null) {
            throw new RuntimeException(__('Selected queue was not found.', 'glpiintegaglpi'));
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

    private function getQueueRepository(): QueueRepository
    {
        if ($this->queueRepository instanceof QueueRepository) {
            return $this->queueRepository;
        }

        $this->queueRepository = new QueueRepository($this->getPdo());

        return $this->queueRepository;
    }
}
