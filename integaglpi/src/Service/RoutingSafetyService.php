<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\External\ExternalSchemaManager;
use GlpiPlugin\Integaglpi\External\Repository\RoutingSafetyRepository;
use Group;
use PDO;
use RuntimeException;

final class RoutingSafetyService
{
    public const ABANDONED_QUEUE_TIMEOUT_HOURS = 24;

    private ?PDO $pdo = null;

    private ?RoutingSafetyRepository $repository = null;

    public function __construct(private readonly ?PluginConfigService $pluginConfigService = null)
    {
    }

    public function isExternalConfigured(): bool
    {
        return $this->getPluginConfigService()->isConfigured();
    }

    /**
     * @return array<string, mixed>
     */
    public function getRoutingConfig(): array
    {
        if (!$this->isExternalConfigured()) {
            return [];
        }

        return $this->getRepository()->getRoutingConfig();
    }

    /**
     * @param array<string, mixed> $input
     */
    public function saveRoutingConfig(array $input): void
    {
        $this->assertConfigured();

        $fallbackQueueId = (int) ($input['fallback_queue_id'] ?? 0);
        $fallbackGroupId = (int) ($input['fallback_glpi_group_id'] ?? 0);
        $maxAttempts = (int) ($input['max_invalid_queue_attempts'] ?? 3);
        $payload = [
            'fallback_queue_id' => $fallbackQueueId > 0 ? $fallbackQueueId : null,
            'fallback_glpi_group_id' => $fallbackGroupId > 0 ? $fallbackGroupId : null,
            'fallback_enabled' => isset($input['fallback_enabled']),
            'max_invalid_queue_attempts' => max(1, min(10, $maxAttempts)),
        ];

        if (!empty($payload['fallback_enabled'])) {
            if ($payload['fallback_queue_id'] === null) {
                throw new RuntimeException(__('Fallback queue is required when fallback is enabled.', 'glpiintegaglpi'));
            }
            if (!$this->getRepository()->activeQueueExists($payload['fallback_queue_id'])) {
                throw new RuntimeException(__('Fallback queue does not exist or is inactive.', 'glpiintegaglpi'));
            }
            if ($payload['fallback_glpi_group_id'] === null || !$this->groupExists($payload['fallback_glpi_group_id'])) {
                throw new RuntimeException(__('Fallback GLPI group does not exist.', 'glpiintegaglpi'));
            }
        }

        $this->getRepository()->saveRoutingConfig($payload);
    }

    /**
     * @return array<string, mixed>
     */
    public function buildReport(): array
    {
        if (!$this->isExternalConfigured()) {
            return [
                'configured' => false,
                'routing_config' => [],
                'issues' => [],
                'abandoned' => [],
                'recent_events' => [],
            ];
        }

        $config = $this->getRepository()->getRoutingConfig();

        return [
            'configured' => true,
            'routing_config' => $config,
            'issues' => $this->validateConfiguration($config),
            'abandoned' => $this->getRepository()->findAbandonedAwaitingQueue(
                self::ABANDONED_QUEUE_TIMEOUT_HOURS,
                50
            ),
            'recent_events' => $this->getRepository()->findRecentRoutingEvents(7, 50),
        ];
    }

    /**
     * @param array<string, mixed> $config
     * @return list<array<string, mixed>>
     */
    private function validateConfiguration(array $config): array
    {
        $issues = [];
        $options = $this->getRepository()->findRoutingOptionsForValidation();
        $optionKeys = [];

        if (empty($config['fallback_enabled'])) {
            $issues[] = [
                'severity' => 'warning',
                'type' => 'fallback_disabled_or_absent',
                'message' => __('Fallback routing is not enabled.', 'glpiintegaglpi'),
            ];
        } elseif (
            empty($config['fallback_queue_id'])
            || empty($config['fallback_queue_active'])
            || empty($config['fallback_glpi_group_id'])
            || !$this->groupExists((int) $config['fallback_glpi_group_id'])
        ) {
            $issues[] = [
                'severity' => 'error',
                'type' => 'fallback_invalid',
                'message' => __('Fallback queue/group is invalid.', 'glpiintegaglpi'),
            ];
        }

        foreach ($options as $option) {
            $key = (string) ($option['option_key'] ?? '');
            if ($key === '') {
                $issues[] = $this->optionIssue($option, 'option_key_missing', __('Option key is empty.', 'glpiintegaglpi'));
            } elseif (isset($optionKeys[$key])) {
                $issues[] = $this->optionIssue($option, 'option_key_duplicated', __('Option key is duplicated.', 'glpiintegaglpi'));
            }
            $optionKeys[$key] = true;

            if (empty($option['queue_id'])) {
                $issues[] = $this->optionIssue($option, 'queue_missing', __('Routing option has no queue.', 'glpiintegaglpi'));
            } elseif ($option['queue_is_active'] === null) {
                $issues[] = $this->optionIssue($option, 'queue_not_found', __('Queue was not found.', 'glpiintegaglpi'));
            } elseif ($option['queue_is_active'] === false) {
                $issues[] = $this->optionIssue($option, 'queue_inactive', __('Queue is inactive.', 'glpiintegaglpi'));
            }

            if (empty($option['glpi_group_id']) && empty($option['glpi_user_id'])) {
                $issues[] = $this->optionIssue($option, 'assignment_missing', __('No GLPI group/user configured.', 'glpiintegaglpi'));
                continue;
            }

            if (!empty($option['glpi_group_id']) && !$this->groupExists((int) $option['glpi_group_id'])) {
                $issues[] = $this->optionIssue($option, 'glpi_group_missing', __('GLPI group does not exist.', 'glpiintegaglpi'));
            }
        }

        return $issues;
    }

    /**
     * @param array<string, mixed> $option
     * @return array<string, mixed>
     */
    private function optionIssue(array $option, string $type, string $message): array
    {
        return [
            'severity' => 'error',
            'type' => $type,
            'message' => $message,
            'option_id' => $option['id'] ?? null,
            'option_key' => $option['option_key'] ?? null,
            'label' => $option['label'] ?? null,
            'queue_id' => $option['queue_id'] ?? null,
            'glpi_group_id' => $option['glpi_group_id'] ?? null,
        ];
    }

    private function assertConfigured(): void
    {
        if (!$this->isExternalConfigured()) {
            throw new RuntimeException(__('Configure the external PostgreSQL connection first.', 'glpiintegaglpi'));
        }
    }

    private function groupExists(int $groupId): bool
    {
        $group = new Group();

        return $groupId > 0 && $group->getFromDB($groupId);
    }

    private function getPdo(): PDO
    {
        if ($this->pdo instanceof PDO) {
            return $this->pdo;
        }

        $this->pdo = ExternalDatabase::getConnection($this->getPluginConfigService()->getConnectionConfig());
        ExternalSchemaManager::ensureSchema($this->pdo);

        return $this->pdo;
    }

    private function getRepository(): RoutingSafetyRepository
    {
        if ($this->repository instanceof RoutingSafetyRepository) {
            return $this->repository;
        }

        $this->repository = new RoutingSafetyRepository($this->getPdo());

        return $this->repository;
    }

    private function getPluginConfigService(): PluginConfigService
    {
        return $this->pluginConfigService ?? new PluginConfigService();
    }
}
