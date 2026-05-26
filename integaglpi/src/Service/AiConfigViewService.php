<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\Plugin;
use RuntimeException;
use Throwable;

final class AiConfigViewService
{
    private const AI_SETTINGS_CONTEXT = 'ai_settings';
    private const AI_SETTINGS_TABLE = 'glpi_plugin_integaglpi_configs';
    private const AI_SETTINGS_COLUMNS = [
        'ai_supervisor_enabled',
        'ai_supervisor_provider',
        'ai_supervisor_model',
        'ai_supervisor_timeout_seconds',
        'ai_supervisor_max_messages',
        'ai_supervisor_max_chars',
        'ai_supervisor_dry_run',
        'copilot_enabled',
        'copilot_provider',
        'copilot_model',
        'copilot_dry_run',
        'copilot_timeout_ms',
        'copilot_max_context_messages',
        'copilot_max_context_chars',
        'external_research_enabled',
        'external_research_cloud_enabled',
        'external_research_rate_limit_per_day',
        'p4_candidate_review_enabled',
        'p4_candidate_review_provider',
        'p4_candidate_review_model',
        'p4_confidence_threshold',
        'p4_max_candidates_per_run',
        'embeddings_enabled',
        'cloud_dpo_approved',
        'cloud_director_approved',
        'cloud_admin_opt_in',
        'cloud_budget_configured',
        'cloud_incident_ack',
        'cloud_synthetic_test_ok',
        'ai_settings_updated_by',
    ];
    private const BOOLEAN_SETTING_KEYS = [
        'ai_supervisor_enabled',
        'ai_supervisor_dry_run',
        'copilot_enabled',
        'copilot_dry_run',
        'external_research_enabled',
        'external_research_cloud_enabled',
        'p4_candidate_review_enabled',
        'embeddings_enabled',
        'cloud_dpo_approved',
        'cloud_director_approved',
        'cloud_admin_opt_in',
        'cloud_budget_configured',
        'cloud_incident_ack',
        'cloud_synthetic_test_ok',
    ];
    private const PROVIDER_KEYS = [
        'ai_supervisor_provider',
        'copilot_provider',
        'p4_candidate_review_provider',
    ];
    private const INTEGER_LIMITS = [
        'ai_supervisor_timeout_seconds' => [15, 180],
        'ai_supervisor_max_messages' => [1, 20],
        'ai_supervisor_max_chars' => [500, 12000],
        'copilot_timeout_ms' => [15000, 120000],
        'copilot_max_context_messages' => [1, 12],
        'copilot_max_context_chars' => [1000, 12000],
        'external_research_rate_limit_per_day' => [0, 200],
        'p4_confidence_threshold' => [0, 100],
        'p4_max_candidates_per_run' => [1, 50],
    ];
    private const DEFAULT_AI_SETTINGS = [
        'ai_supervisor_enabled' => 'false',
        'ai_supervisor_provider' => 'disabled',
        'ai_supervisor_model' => '',
        'ai_supervisor_timeout_seconds' => 75,
        'ai_supervisor_max_messages' => 8,
        'ai_supervisor_max_chars' => 6000,
        'ai_supervisor_dry_run' => 'true',
        'copilot_enabled' => 'false',
        'copilot_provider' => 'disabled',
        'copilot_model' => '',
        'copilot_dry_run' => 'true',
        'copilot_timeout_ms' => 90000,
        'copilot_max_context_messages' => 8,
        'copilot_max_context_chars' => 6000,
        'external_research_enabled' => 'false',
        'external_research_cloud_enabled' => 'false',
        'external_research_rate_limit_per_day' => 20,
        'p4_candidate_review_enabled' => 'false',
        'p4_candidate_review_provider' => 'disabled',
        'p4_candidate_review_model' => '',
        'p4_confidence_threshold' => 70,
        'p4_max_candidates_per_run' => 10,
        'embeddings_enabled' => 'false',
        'cloud_dpo_approved' => 'false',
        'cloud_director_approved' => 'false',
        'cloud_admin_opt_in' => 'false',
        'cloud_budget_configured' => 'false',
        'cloud_incident_ack' => 'false',
        'cloud_synthetic_test_ok' => 'false',
    ];
    private const OLLAMA_MODEL_CACHE_KEY = 'integaglpi_ai_ollama_models';
    private const OLLAMA_MODEL_CACHE_TTL_SECONDS = 300;
    private const CLOUD_PROVIDER_CATALOG = [
        [
            'id' => 'openai',
            'name' => 'OpenAI / ChatGPT',
            'env_key' => 'OPENAI_API_KEY',
            'models' => ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o-mini'],
        ],
        [
            'id' => 'anthropic',
            'name' => 'Anthropic / Claude',
            'env_key' => 'ANTHROPIC_API_KEY',
            'models' => ['claude-3-7-sonnet', 'claude-3-5-haiku'],
        ],
        [
            'id' => 'google',
            'name' => 'Google / Gemini',
            'env_key' => 'GEMINI_API_KEY',
            'models' => ['gemini-2.5-pro', 'gemini-2.5-flash'],
        ],
        [
            'id' => 'deepseek',
            'name' => 'DeepSeek',
            'env_key' => 'DEEPSEEK_API_KEY',
            'models' => ['deepseek-chat', 'deepseek-reasoner'],
        ],
        [
            'id' => 'xai',
            'name' => 'xAI / Grok',
            'env_key' => 'XAI_API_KEY',
            'models' => ['grok-3', 'grok-3-mini'],
        ],
    ];

    private PluginConfigService $pluginConfigService;

    public function __construct(PluginConfigService $pluginConfigService)
    {
        $this->pluginConfigService = $pluginConfigService;
    }

    /**
     * @return array<string, mixed>
     */
    public function getPageData(?array $flash = null, ?int $viewerUserId = null): array
    {
        $diagnostics = null;
        $diagnosticsError = '';
        try {
            $response = (new IntegrationServiceClient($this->pluginConfigService))->getDiagnostics();
            if (!empty($response['success']) && is_array($response['body'] ?? null)) {
                $diagnostics = $response['body'];
            } else {
                $diagnosticsError = __('Integration-service não retornou diagnóstico agora.', 'glpiintegaglpi');
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][ai_config][diagnostics] ' . $this->sanitizeLog($exception->getMessage()));
            $diagnosticsError = __('Não foi possível consultar o integration-service agora.', 'glpiintegaglpi');
        }

        $aiSupervisorDiagnostics = is_array($diagnostics['ai_supervisor'] ?? null) ? $diagnostics['ai_supervisor'] : [];
        $settings = $this->loadAiSettings();
        $integrationUrl = $this->pluginConfigService->getIntegrationServiceUrl();

        $cloudPilot = [
            'cloud_enabled' => $this->runtimeValue('AI_PILOT_CLOUD_ENABLED', 'false'),
            'embeddings_enabled' => $this->settingValue($settings, 'embeddings_enabled', $this->runtimeValue('AI_PILOT_EMBEDDINGS_ENABLED', 'false')),
            'provider' => $this->runtimeValue('AI_PILOT_PROVIDER', 'disabled'),
            'dpo_approved' => $this->settingValue($settings, 'cloud_dpo_approved', $this->runtimeValue('AI_PILOT_DPO_APPROVED', 'false')),
            'director_approved' => $this->settingValue($settings, 'cloud_director_approved', $this->runtimeValue('AI_PILOT_DIRECTOR_APPROVED', 'false')),
            'admin_opt_in' => $this->settingValue($settings, 'cloud_admin_opt_in', $this->runtimeValue('AI_PILOT_ADMIN_OPT_IN', 'false')),
            'incident_ack' => $this->settingValue($settings, 'cloud_incident_ack', $this->runtimeValue('AI_PILOT_INCIDENT_ACK', 'false')),
            'synthetic_test_ok' => $this->settingValue($settings, 'cloud_synthetic_test_ok', $this->runtimeValue('AI_PILOT_SYNTHETIC_TEST_OK', 'false')),
            'monthly_budget_limit' => $this->settingValue($settings, 'cloud_budget_configured', 'false') === 'true'
                ? $this->runtimeValue('AI_PILOT_MONTHLY_BUDGET_LIMIT', 'configured')
                : $this->runtimeValue('AI_PILOT_MONTHLY_BUDGET_LIMIT', '0'),
            'budget_configured' => $this->settingValue($settings, 'cloud_budget_configured', 'false'),
            'environment' => $this->runtimeValue('AI_PILOT_ENVIRONMENT', $this->runtimeValue('APP_ENV', 'unknown')),
        ];

        $aiSupervisor = [
            'enabled' => $this->settingValue($settings, 'ai_supervisor_enabled', $aiSupervisorDiagnostics['enabled'] ?? Plugin::isAiSupervisorEnabled()),
            'provider' => $this->settingValue($settings, 'ai_supervisor_provider', $aiSupervisorDiagnostics['provider'] ?? $this->runtimeValue('AI_SUPERVISOR_PROVIDER', 'não verificado')),
            'model' => $this->settingValue($settings, 'ai_supervisor_model', $this->runtimeValue('AI_SUPERVISOR_MODEL', 'não verificado')),
            'timeout_seconds' => $this->settingValue($settings, 'ai_supervisor_timeout_seconds', $this->runtimeValue('AI_SUPERVISOR_TIMEOUT_SECONDS', 'não verificado')),
            'max_messages' => $this->settingValue($settings, 'ai_supervisor_max_messages', $this->runtimeValue('AI_SUPERVISOR_MAX_MESSAGES', 'não verificado')),
            'max_chars' => $this->settingValue($settings, 'ai_supervisor_max_chars', $this->runtimeValue('AI_SUPERVISOR_MAX_CHARS', 'não verificado')),
            'dry_run' => $this->settingValue($settings, 'ai_supervisor_dry_run', $aiSupervisorDiagnostics['dry_run'] ?? $this->runtimeValue('AI_SUPERVISOR_DRY_RUN', 'true')),
            'base_url' => $this->maskUrl($this->runtimeValue('AI_SUPERVISOR_BASE_URL', 'não verificado')),
            'base_url_configured' => $aiSupervisorDiagnostics['base_url_configured'] ?? null,
        ];

        $copilot = [
            'enabled' => $this->settingValue($settings, 'copilot_enabled', Plugin::isAiSupervisorEnabled()),
            'provider' => $this->settingValue($settings, 'copilot_provider', $this->runtimeValue('COPILOT_PROVIDER', $this->runtimeValue('AI_SUPERVISOR_PROVIDER', 'disabled'))),
            'model' => $this->settingValue($settings, 'copilot_model', $this->runtimeValue('AI_SUPERVISOR_MODEL', 'não verificado')),
            'dry_run' => $this->settingValue($settings, 'copilot_dry_run', $this->runtimeValue('COPILOT_DRY_RUN', $this->runtimeValue('AI_SUPERVISOR_DRY_RUN', 'true'))),
            'kb_local_lookup' => 'enabled',
            'kb_local_first' => 'true',
            'max_context_messages' => $this->settingValue($settings, 'copilot_max_context_messages', '8'),
            'max_context_chars' => $this->settingValue($settings, 'copilot_max_context_chars', '6000'),
            'max_kb_articles' => '3',
            'timeout_ms' => $this->settingValue($settings, 'copilot_timeout_ms', '90000'),
            'auto_send' => 'false',
            'ticket_mutation' => 'false',
        ];
        $externalResearch = $this->externalResearchStatus($settings);
        $p4Review = $this->p4CandidateReviewStatus($settings);
        $secretVault = (new AiSecretVaultService($this->pluginConfigService))->status();
        $embeddings = [
            'enabled' => $cloudPilot['embeddings_enabled'],
            'provider' => $this->runtimeValue('AI_PILOT_PROVIDER', 'disabled'),
            'operational_rag' => 'false',
            'default_enabled' => 'false',
        ];
        $auditStatus = [
            'table_available' => $this->externalTableExists('glpi_plugin_integaglpi_audit_events'),
            'payload_policy' => 'hashes_only_no_raw_prompt_no_pii',
            'source_required' => 'true',
            'retention_documented' => 'true',
        ];

        $pageData = [
            'flash' => $flash,
            'diagnostics_error' => $diagnosticsError,
            'environment' => $this->detectEnvironment($cloudPilot),
            'risk_alerts' => $this->riskAlerts($aiSupervisor, $cloudPilot),
            'editable_safe_fields' => array_values(array_filter(self::AI_SETTINGS_COLUMNS, static fn (string $key): bool => $key !== 'ai_settings_updated_by')),
            'pending_safe_fields' => [],
            'secret_fields' => ['api_key', 'token', 'bearer', 'password', 'secret', 'client_secret'],
            'safe_settings' => $settings,
            'safe_settings_available' => $this->aiSettingsStorageAvailable(),
            'effective_config' => $this->effectiveConfig($settings, $aiSupervisor, $copilot, $p4Review, $externalResearch),
            'ollama_models' => $this->cachedOllamaModels(),
            'cloud_provider_catalog' => $this->cloudProviderCatalog($cloudPilot, $secretVault),
            'secret_vault' => $secretVault,
            'ai_supervisor' => $aiSupervisor,
            'copilot' => $copilot,
            'cloud_pilot' => $cloudPilot + [
                'gates_ok' => $this->cloudGatesOk($cloudPilot),
                'missing_gates' => $this->missingCloudGates($cloudPilot),
            ],
            'external_research' => $externalResearch,
            'p4_candidate_review' => $p4Review,
            'embeddings' => $embeddings,
            'audit_status' => $auditStatus,
            'governance' => [
                'vault_master_key_in_env_only' => true,
                'cloud_keys_in_secret_vault' => true,
                'secret_vault_write_only' => true,
                'no_auto_send' => true,
                'no_auto_publish_kb' => true,
                'no_raw_ticket_to_ai' => true,
                'no_pii_to_ai' => true,
                'local_first' => true,
            ],
            'integration_service' => [
                'url_masked' => $this->maskUrl($integrationUrl),
                'configured' => $this->pluginConfigService->isConfigured(),
                'auth_key_visible' => false,
            ],
        ];
        if ($viewerUserId !== null) {
            $this->audit('AI_CONFIG_VIEWED', 'success', [
                'glpi_user_id' => $viewerUserId,
                'environment' => $pageData['environment'],
                'cloud_enabled' => $cloudPilot['cloud_enabled'],
                'embeddings_enabled' => $cloudPilot['embeddings_enabled'],
            ]);
        }

        return $pageData;
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    public function handlePost(array $post, int $userId): array
    {
        $action = trim((string) ($post['action'] ?? ''));
        try {
            if ($action === 'save_safe_config') {
                if (!$this->pluginConfigService->isConfigured()) {
                    throw new RuntimeException(__('Configure a conexão do plugin antes de salvar flags seguras.', 'glpiintegaglpi'));
                }
                $settings = $this->normalizeAiSettingsPost($post, $userId);
                $this->saveAiSettings($settings);
                $this->audit('AI_CONFIG_UPDATED', 'success', [
                    'glpi_user_id' => $userId,
                    'fields' => array_values(array_filter(
                        array_keys($settings),
                        static fn (string $key): bool => $key !== 'ai_settings_updated_by'
                    )),
                    'secret_fields_changed' => false,
                    'env_edited' => false,
                ]);

                return [
                    'type' => 'success',
                    'message' => __('Configurações não sensíveis salvas. Segredos e .env não foram alterados.', 'glpiintegaglpi'),
                ];
            }

            if ($action === 'request_cloud_enable') {
                $data = $this->getPageData();
                $pilot = is_array($data['cloud_pilot'] ?? null) ? $data['cloud_pilot'] : [];
                $missing = is_array($pilot['missing_gates'] ?? null) ? $pilot['missing_gates'] : [];
                if ($missing !== []) {
                    $this->audit('AI_CLOUD_GATE_UPDATED', 'blocked', [
                        'glpi_user_id' => $userId,
                        'action' => 'validate_cloud_gates',
                        'missing_gates' => $missing,
                        'cloud_enabled' => false,
                    ]);

                    return [
                        'type' => 'danger',
                        'message' => sprintf(
                            __('Cloud bloqueada. Gates pendentes: %s.', 'glpiintegaglpi'),
                            implode(', ', $missing)
                        ),
                    ];
                }
                $this->audit('AI_CLOUD_GATE_UPDATED', 'success', [
                    'glpi_user_id' => $userId,
                    'action' => 'validate_cloud_gates',
                    'cloud_enabled' => false,
                    'no_env_edit' => true,
                ]);

                return [
                    'type' => 'warning',
                    'message' => __('Gates aparentam OK, mas esta UI não edita .env nem habilita cloud. Solicite alteração operacional manual.', 'glpiintegaglpi'),
                ];
            }

            if ($action === 'run_synthetic_local_test') {
                $data = $this->getPageData();
                $ai = is_array($data['ai_supervisor'] ?? null) ? $data['ai_supervisor'] : [];
                $provider = strtolower(trim((string) ($ai['provider'] ?? '')));
                $model = trim((string) ($ai['model'] ?? ''));
                $baseConfigured = $this->truthy($ai['base_url_configured'] ?? false)
                    || trim((string) ($ai['base_url'] ?? '')) !== ''
                    && trim((string) ($ai['base_url'] ?? '')) !== 'não verificado';
                $ok = $provider === 'ollama'
                    && $model !== ''
                    && $model !== 'não verificado'
                    && $baseConfigured;
                $this->audit('AI_LOCAL_SYNTHETIC_TEST_RUN', $ok ? 'success' : 'blocked', [
                    'glpi_user_id' => $userId,
                    'provider' => $provider !== '' ? $provider : 'disabled',
                    'model_configured' => $model !== '' && $model !== 'não verificado',
                    'base_url_configured' => $baseConfigured,
                    'synthetic_payload' => 'no_pii_status_check_only',
                ]);

                return [
                    'type' => $ok ? 'success' : 'warning',
                    'message' => $ok
                        ? __('Configuração local/Ollama parece pronta. Teste sintético não enviou dados reais nem alterou .env.', 'glpiintegaglpi')
                        : __('Provider local/Ollama ainda não está completamente configurado. Nenhum dado real foi enviado.', 'glpiintegaglpi'),
                ];
            }

            if ($action === 'refresh_ollama_models') {
                $models = $this->refreshOllamaModels($userId);

                return [
                    'type' => $models === [] ? 'warning' : 'success',
                    'message' => $models === []
                        ? __('Não foi possível listar modelos locais agora. O modelo manual atual continua preservado.', 'glpiintegaglpi')
                        : sprintf(__('Modelos locais atualizados: %s.', 'glpiintegaglpi'), implode(', ', $models)),
                ];
            }

            if ($action === 'save_cloud_secret') {
                $provider = trim((string) ($post['vault_provider'] ?? ''));
                $label = trim((string) ($post['vault_label'] ?? ''));
                $secret = (string) ($post['vault_secret'] ?? '');
                (new AiSecretVaultService($this->pluginConfigService))->storeSecret($provider, $secret, $label, $userId);
                $this->audit('AI_SECRET_VAULT_UPDATED', 'success', [
                    'glpi_user_id' => $userId,
                    'provider' => $provider,
                    'secret_fingerprint_updated' => true,
                    'secret_plaintext_logged' => false,
                    'source' => 'AiSecretVaultService',
                ]);

                return [
                    'type' => 'success',
                    'message' => __('Chave cloud armazenada no Secret Vault. O valor real não será exibido novamente.', 'glpiintegaglpi'),
                ];
            }

            return ['type' => 'danger', 'message' => __('Ação inválida.', 'glpiintegaglpi')];
        } catch (Throwable $exception) {
            error_log('[integaglpi][ai_config][post] ' . $this->sanitizeLog($exception->getMessage()));

            return [
                'type' => 'danger',
                'message' => mb_substr($this->sanitizeLog($exception->getMessage()), 0, 220, 'UTF-8'),
            ];
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function loadAiSettings(): array
    {
        $settings = self::DEFAULT_AI_SETTINGS;
        if (!$this->pluginConfigService->isConfigured() || !$this->aiSettingsStorageAvailable()) {
            return $settings;
        }

        try {
            $pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
            $stmt = $pdo->prepare(
                'SELECT ' . implode(', ', array_map(static fn (string $column): string => '"' . $column . '"', self::AI_SETTINGS_COLUMNS)) . '
                   FROM public.' . self::AI_SETTINGS_TABLE . '
                  WHERE context = :context
                  LIMIT 1'
            );
            $stmt->execute([':context' => self::AI_SETTINGS_CONTEXT]);
            $row = $stmt->fetch(\PDO::FETCH_ASSOC);
            if (!is_array($row)) {
                return $settings;
            }

            foreach (self::AI_SETTINGS_COLUMNS as $column) {
                if (!array_key_exists($column, $row) || $row[$column] === null || $row[$column] === '') {
                    continue;
                }
                $settings[$column] = is_bool($row[$column]) ? ($row[$column] ? 'true' : 'false') : $row[$column];
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][ai_config][settings_load] ' . $this->sanitizeLog($exception->getMessage()));
        }

        return $settings;
    }

    private function aiSettingsStorageAvailable(): bool
    {
        if (!$this->pluginConfigService->isConfigured()) {
            return false;
        }

        try {
            $pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
            if (!$this->externalTableExists(self::AI_SETTINGS_TABLE)) {
                return false;
            }
            $columnList = implode(', ', array_map(static fn (string $column): string => "'" . $column . "'", self::AI_SETTINGS_COLUMNS));
            $stmt = $pdo->prepare(
                'SELECT COUNT(*) FROM information_schema.columns
                  WHERE table_schema = current_schema()
                    AND table_name = :table
                    AND column_name IN (' . $columnList . ')'
            );
            $stmt->execute([
                ':table' => self::AI_SETTINGS_TABLE,
            ]);

            return (int) $stmt->fetchColumn() >= count(self::AI_SETTINGS_COLUMNS);
        } catch (Throwable $exception) {
            error_log('[integaglpi][ai_config][settings_schema] ' . $this->sanitizeLog($exception->getMessage()));

            return false;
        }
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function normalizeAiSettingsPost(array $post, int $userId): array
    {
        if (!$this->aiSettingsStorageAvailable()) {
            throw new RuntimeException(__('Storage de configurações IA não está pronto. Execute a migration 038 em TESTE.', 'glpiintegaglpi'));
        }

        $settings = [];
        foreach (self::BOOLEAN_SETTING_KEYS as $key) {
            $settings[$key] = !empty($post[$key]) ? 'true' : 'false';
        }
        foreach (self::PROVIDER_KEYS as $key) {
            $settings[$key] = $this->normalizeProvider($post[$key] ?? 'disabled');
        }
        foreach (['ai_supervisor_model', 'copilot_model', 'p4_candidate_review_model'] as $key) {
            $manualKey = $key . '_manual';
            $selected = (string) ($post[$key] ?? '');
            $manual = (string) ($post[$manualKey] ?? '');
            $settings[$key] = $this->normalizeSafeText(trim($manual) !== '' ? $manual : $selected, 120);
        }
        foreach (self::INTEGER_LIMITS as $key => $limits) {
            $settings[$key] = $this->normalizeBoundedInteger($post[$key] ?? null, (int) self::DEFAULT_AI_SETTINGS[$key], $limits[0], $limits[1]);
        }
        $settings['ai_settings_updated_by'] = max(0, $userId);
        $cloudRequested = $settings['external_research_cloud_enabled'] === 'true'
            || $settings['embeddings_enabled'] === 'true';
        if ($cloudRequested) {
            $missing = $this->missingCloudGates([
                'dpo_approved' => $settings['cloud_dpo_approved'],
                'director_approved' => $settings['cloud_director_approved'],
                'admin_opt_in' => $settings['cloud_admin_opt_in'],
                'incident_ack' => $settings['cloud_incident_ack'],
                'synthetic_test_ok' => $settings['cloud_synthetic_test_ok'],
                'budget_configured' => $settings['cloud_budget_configured'],
            ]);
            if ($missing !== []) {
                throw new RuntimeException(sprintf(
                    __('Cloud bloqueada. Gates pendentes: %s.', 'glpiintegaglpi'),
                    implode(', ', $missing)
                ));
            }
        }

        return $settings;
    }

    /**
     * @param array<string, mixed> $settings
     */
    private function saveAiSettings(array $settings): void
    {
        $columns = array_keys($settings);
        $insertColumns = array_merge(['context'], $columns);
        $insertNames = array_map(static fn (string $column): string => '"' . $column . '"', $insertColumns);
        $insertValues = array_map(static fn (string $column): string => ':' . $column, $insertColumns);
        $updates = array_map(
            static fn (string $column): string => '"' . $column . '" = EXCLUDED."' . $column . '"',
            $columns
        );
        $updates[] = 'updated_at = NOW()';

        $stmt = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig())->prepare(
            'INSERT INTO public.' . self::AI_SETTINGS_TABLE . ' (' . implode(', ', $insertNames) . ', updated_at)
             VALUES (' . implode(', ', $insertValues) . ', NOW())
             ON CONFLICT (context) DO UPDATE SET ' . implode(', ', $updates)
        );
        $stmt->bindValue(':context', self::AI_SETTINGS_CONTEXT);
        foreach ($settings as $key => $value) {
            if (is_int($value)) {
                $stmt->bindValue(':' . $key, $value, \PDO::PARAM_INT);
                continue;
            }
            $stmt->bindValue(':' . $key, (string) $value);
        }
        $stmt->execute();
    }

    /**
     * @return array<string, mixed>
     */
    private function effectiveConfig(array $settings, array $aiSupervisor, array $copilot, array $p4Review, array $externalResearch): array
    {
        return [
            'ai_supervisor' => [
                'provider' => (string) ($aiSupervisor['provider'] ?? 'disabled'),
                'model' => (string) ($aiSupervisor['model'] ?? ''),
                'source' => $this->settingValue($settings, 'ai_supervisor_provider', '') !== '' ? 'db_ai_settings' : 'env_or_diagnostics',
            ],
            'copilot' => [
                'provider' => (string) ($copilot['provider'] ?? 'disabled'),
                'model' => (string) ($copilot['model'] ?? ''),
                'timeout_ms' => (string) ($copilot['timeout_ms'] ?? '90000'),
                'max_context_chars' => (string) ($copilot['max_context_chars'] ?? '6000'),
                'source' => $this->settingValue($settings, 'copilot_provider', '') !== '' ? 'db_ai_settings' : 'env_or_default',
            ],
            'p4_candidate_review' => [
                'provider' => (string) ($p4Review['provider'] ?? 'disabled'),
                'model' => (string) ($p4Review['model'] ?? ''),
                'source' => $this->settingValue($settings, 'p4_candidate_review_provider', '') !== '' ? 'db_ai_settings' : 'env_or_default',
            ],
            'external_research' => [
                'enabled' => (string) ($externalResearch['enabled'] ?? 'false'),
                'cloud_enabled' => (string) ($externalResearch['cloud_enabled'] ?? 'false'),
                'source' => 'db_ai_settings_or_env',
            ],
            'cloud' => [
                'secret_configured' => 'see_secret_vault_provider_status',
                'gates_ok' => 'see_cloud_pilot',
                'source' => 'secret_vault_and_ai_settings',
            ],
        ];
    }

    /**
     * @return list<string>
     */
    private function cachedOllamaModels(): array
    {
        $cache = $_SESSION[self::OLLAMA_MODEL_CACHE_KEY] ?? null;
        if (!is_array($cache)) {
            return [];
        }

        $expiresAt = (int) ($cache['expires_at'] ?? 0);
        $models = is_array($cache['models'] ?? null) ? $cache['models'] : [];
        if ($expiresAt < time()) {
            unset($_SESSION[self::OLLAMA_MODEL_CACHE_KEY]);

            return [];
        }

        return array_values(array_filter(array_map(function ($model): string {
            return $this->normalizeModelName((string) $model);
        }, $models), static function (string $model): bool {
            return $model !== '';
        }));
    }

    /**
     * @return list<string>
     */
    private function refreshOllamaModels(int $userId): array
    {
        $baseUrl = $this->runtimeValue('AI_SUPERVISOR_BASE_URL', 'http://127.0.0.1:11434');
        $status = 'blocked';
        $errorType = 'provider_url_not_allowed';
        $models = [];
        $startedAt = microtime(true);

        try {
            if (!$this->isAllowedLocalOllamaUrl($baseUrl)) {
                throw new RuntimeException('provider_url_not_allowed');
            }
            if (!function_exists('curl_init')) {
                throw new RuntimeException('curl_unavailable');
            }

            $handle = curl_init(rtrim($baseUrl, '/') . '/api/tags');
            if ($handle === false) {
                throw new RuntimeException('curl_init_failed');
            }
            curl_setopt_array($handle, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPGET => true,
                CURLOPT_CONNECTTIMEOUT_MS => 1500,
                CURLOPT_TIMEOUT_MS => 5000,
                CURLOPT_HTTPHEADER => ['Accept: application/json'],
            ]);
            $raw = curl_exec($handle);
            $httpStatus = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
            $curlError = curl_error($handle);
            curl_close($handle);

            if (!is_string($raw) || $raw === '') {
                throw new RuntimeException($curlError !== '' ? 'provider_unreachable' : 'provider_empty_response');
            }
            if ($httpStatus < 200 || $httpStatus >= 300) {
                throw new RuntimeException('provider_http_' . $httpStatus);
            }

            $decoded = json_decode($raw, true);
            if (!is_array($decoded) || !is_array($decoded['models'] ?? null)) {
                throw new RuntimeException('invalid_json');
            }

            foreach ($decoded['models'] as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $name = $this->normalizeModelName((string) ($item['name'] ?? $item['model'] ?? ''));
                if ($name !== '') {
                    $models[] = $name;
                }
            }
            $models = array_values(array_unique($models));
            sort($models);
            $_SESSION[self::OLLAMA_MODEL_CACHE_KEY] = [
                'models' => $models,
                'expires_at' => time() + self::OLLAMA_MODEL_CACHE_TTL_SECONDS,
            ];
            $status = $models === [] ? 'blocked' : 'success';
            $errorType = $models === [] ? 'no_models_returned' : 'none';
        } catch (Throwable $exception) {
            unset($_SESSION[self::OLLAMA_MODEL_CACHE_KEY]);
            $models = [];
            $errorType = $this->sanitizeLog($exception->getMessage());
            error_log('[integaglpi][ai_config][ollama_models] ' . $errorType);
        }

        $this->audit('AI_LOCAL_MODELS_REFRESHED', $status, [
            'glpi_user_id' => $userId,
            'provider' => 'ollama',
            'model_count' => count($models),
            'elapsed_ms' => (int) round((microtime(true) - $startedAt) * 1000),
            'error_type' => $errorType,
            'source' => 'ollama_api_tags_manual_refresh',
        ]);

        return $models;
    }

    private function normalizeModelName(string $value): string
    {
        $value = trim($value);
        if ($value === '' || strlen($value) > 120) {
            return '';
        }

        return preg_match('/^[A-Za-z0-9_.:\/-]+$/', $value) === 1 ? $value : '';
    }

    private function isAllowedLocalOllamaUrl(string $baseUrl): bool
    {
        $parts = parse_url($baseUrl);
        if (!is_array($parts)) {
            return false;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        if ($scheme !== 'http' || $host === '') {
            return false;
        }

        return in_array($host, ['127.0.0.1', 'localhost', '::1', 'ollama', 'ollama-local'], true);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function cloudProviderCatalog(array $cloudPilot, array $secretVault): array
    {
        $gatesOk = $this->cloudGatesOk($cloudPilot);
        $vaultProviders = is_array($secretVault['providers'] ?? null) ? $secretVault['providers'] : [];
        $vaultLocked = !empty($secretVault['locked']);
        $catalog = [];
        foreach (self::CLOUD_PROVIDER_CATALOG as $provider) {
            $providerId = (string) $provider['id'];
            $vaultRow = is_array($vaultProviders[$providerId] ?? null) ? $vaultProviders[$providerId] : [];
            $secretConfigured = !empty($vaultRow['configured']);
            $blockedReasons = [];
            if ($vaultLocked) {
                $blockedReasons[] = 'secret_vault_locked';
            }
            if (!$secretConfigured) {
                $blockedReasons[] = 'secret_not_configured';
            }
            if (!$gatesOk) {
                $blockedReasons[] = 'cloud_gates_incomplete';
            }

            $catalog[] = [
                'id' => $providerId,
                'name' => (string) $provider['name'],
                'models' => array_values(array_map('strval', $provider['models'])),
                'secret_configured' => $secretConfigured,
                'secret_fingerprint' => (string) ($vaultRow['fingerprint'] ?? ''),
                'api_key_configured' => $secretConfigured,
                'gates_ok' => $gatesOk,
                'enabled' => false,
                'blocked_reason' => $blockedReasons === [] ? 'cloud_disabled_by_default' : implode(',', $blockedReasons),
            ];
        }

        return $catalog;
    }

    private function settingValue(array $settings, string $key, $fallback): string
    {
        $value = $settings[$key] ?? null;
        if ($value === null || $value === '') {
            if (is_bool($fallback)) {
                return $fallback ? 'true' : 'false';
            }

            return (string) $fallback;
        }

        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }

        return (string) $value;
    }

    private function normalizeProvider($value): string
    {
        $provider = strtolower(trim((string) $value));

        return in_array($provider, ['disabled', 'ollama', 'local'], true) ? $provider : 'disabled';
    }

    private function normalizeSafeText(string $value, int $limit): string
    {
        $value = trim(strip_tags($value));
        $value = preg_replace('/(password|senha|token|secret|bearer|api_key)\s*[:=]\s*\S+/i', '$1=[redacted]', $value) ?? '';
        $value = preg_replace('/[^A-Za-z0-9_.:\/-]+/', '', $value) ?? '';

        return substr($value, 0, $limit);
    }

    private function normalizeBoundedInteger($value, int $default, int $min, int $max): int
    {
        $integer = (int) $value;
        if ($integer < $min || $integer > $max) {
            return $default;
        }

        return $integer;
    }

    private function runtimeValue(string $key, string $fallback): string
    {
        $value = Plugin::getRuntimeConfigValue($key);

        return $value !== '' ? $value : $fallback;
    }

    private function maskUrl(string $url): string
    {
        $url = trim($url);
        if ($url === '' || $url === 'não verificado') {
            return $url;
        }

        $parts = parse_url($url);
        if (!is_array($parts) || empty($parts['host'])) {
            return '[url mascarada]';
        }

        $scheme = isset($parts['scheme']) ? (string) $parts['scheme'] : 'http';
        $host = (string) $parts['host'];
        $port = isset($parts['port']) ? ':****' : '';

        return $scheme . '://' . $host . $port;
    }

    /**
     * @return array<string, mixed>
     */
    private function externalResearchStatus(array $settings): array
    {
        $enabled = $this->settingValue($settings, 'external_research_enabled', $this->runtimeValue('EXTERNAL_RESEARCH_ENABLED', 'false'));
        $cloudEnabled = $this->settingValue($settings, 'external_research_cloud_enabled', $this->runtimeValue('EXTERNAL_RESEARCH_CLOUD_ENABLED', 'false'));
        $tablesReady = $this->externalTableExists('glpi_plugin_integaglpi_external_source_catalog')
            && $this->externalTableExists('glpi_plugin_integaglpi_external_research_requests')
            && $this->externalTableExists('glpi_plugin_integaglpi_external_research_candidates');

        return [
            'enabled' => $enabled,
            'enabled_default' => 'false',
            'cloud_enabled' => $cloudEnabled,
            'manual_trigger_required' => 'true',
            'prompt_preview_required' => 'true',
            'source_allowlist_required' => 'true',
            'rate_limit_per_day' => $this->settingValue($settings, 'external_research_rate_limit_per_day', '20'),
            'tables_ready' => $tablesReady,
            'status' => $this->truthy($enabled) && $tablesReady ? 'available' : 'disabled',
            'blocked_reason' => $this->truthy($enabled)
                ? ($tablesReady ? '' : 'migration_036_not_ready')
                : 'feature_flag_disabled',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function p4CandidateReviewStatus(array $settings): array
    {
        $enabled = $this->settingValue($settings, 'p4_candidate_review_enabled', $this->runtimeValue('AI_KB_CANDIDATE_REVIEW_ENABLED', 'false'));
        $provider = $this->settingValue($settings, 'p4_candidate_review_provider', $this->runtimeValue('AI_KB_CANDIDATE_REVIEW_PROVIDER', $this->runtimeValue('AI_SUPERVISOR_PROVIDER', 'disabled')));
        $model = $this->settingValue($settings, 'p4_candidate_review_model', $this->runtimeValue('AI_KB_CANDIDATE_REVIEW_MODEL', $this->runtimeValue('AI_SUPERVISOR_MODEL', 'não verificado')));
        $tablesReady = $this->externalTableExists('glpi_plugin_integaglpi_kb_candidates')
            && $this->externalTableExists('glpi_plugin_integaglpi_kb_candidate_reviews');

        return [
            'enabled' => $enabled,
            'enabled_default' => 'false',
            'provider' => $provider,
            'model' => $model,
            'local_provider_configured' => strtolower($provider) === 'ollama' && $model !== '' && $model !== 'não verificado',
            'confidence_threshold' => $this->settingValue($settings, 'p4_confidence_threshold', '70'),
            'max_candidates_per_run' => $this->settingValue($settings, 'p4_max_candidates_per_run', '10'),
            'tables_ready' => $tablesReady,
            'human_review_required' => 'true',
            'no_auto_publish' => 'true',
        ];
    }

    private function externalTableExists(string $table): bool
    {
        if (!$this->pluginConfigService->isConfigured()) {
            return false;
        }

        try {
            $pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
            $statement = $pdo->prepare('SELECT to_regclass(:table_name)');
            $statement->execute([':table_name' => 'public.' . $table]);

            return (string) ($statement->fetchColumn() ?: '') !== '';
        } catch (Throwable $exception) {
            error_log('[integaglpi][ai_config][table_exists] ' . $this->sanitizeLog($exception->getMessage()));

            return false;
        }
    }

    /**
     * @param array<string, mixed> $cloudPilot
     */
    private function detectEnvironment(array $cloudPilot): string
    {
        $value = strtolower(trim((string) ($cloudPilot['environment'] ?? 'unknown')));
        if (in_array($value, ['test', 'teste'], true)) {
            return 'TESTE';
        }
        if (in_array($value, ['homologation', 'homologacao', 'homologação', 'staging'], true)) {
            return 'HOMOLOGAÇÃO';
        }
        if (in_array($value, ['production', 'prod', 'produção', 'producao'], true)) {
            return 'PRODUÇÃO';
        }

        return 'desconhecido';
    }

    /**
     * @param array<string, mixed> $aiSupervisor
     * @param array<string, mixed> $cloudPilot
     * @return list<string>
     */
    private function riskAlerts(array $aiSupervisor, array $cloudPilot): array
    {
        $alerts = [];
        if ($this->truthy($aiSupervisor['enabled'] ?? false)) {
            $alerts[] = 'AI_SUPERVISOR_ENABLED=true';
        }
        if (!$this->truthy($aiSupervisor['dry_run'] ?? true)) {
            $alerts[] = 'AI_SUPERVISOR_DRY_RUN=false';
        }
        if ($this->truthy($cloudPilot['cloud_enabled'] ?? false)) {
            $alerts[] = 'AI_PILOT_CLOUD_ENABLED=true';
        }
        if ($this->truthy($cloudPilot['embeddings_enabled'] ?? false)) {
            $alerts[] = 'AI_PILOT_EMBEDDINGS_ENABLED=true';
        }

        return $alerts;
    }

    /**
     * @param array<string, mixed> $pilot
     */
    private function cloudGatesOk(array $pilot): bool
    {
        return $this->missingCloudGates($pilot) === [];
    }

    /**
     * @param array<string, mixed> $pilot
     * @return list<string>
     */
    private function missingCloudGates(array $pilot): array
    {
        $missing = [];
        foreach ([
            'dpo_approved' => 'DPO/LGPD',
            'director_approved' => 'direção',
            'admin_opt_in' => 'admin opt-in',
            'incident_ack' => 'incident ack',
            'synthetic_test_ok' => 'synthetic test',
        ] as $key => $label) {
            if (!$this->truthy($pilot[$key] ?? false)) {
                $missing[] = $label;
            }
        }
        if (!$this->truthy($pilot['budget_configured'] ?? false) && (float) ($pilot['monthly_budget_limit'] ?? 0) <= 0) {
            $missing[] = 'budget';
        }

        return $missing;
    }

    private function truthy($value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        return in_array(strtolower(trim((string) $value)), ['1', 'true', 'yes', 'on'], true);
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function audit(string $eventType, string $status, array $payload): void
    {
        if (!$this->pluginConfigService->isConfigured()) {
            return;
        }

        try {
            $pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
            $exists = $pdo->query("SELECT to_regclass('public.glpi_plugin_integaglpi_audit_events')");
            if ($exists === false || !$exists->fetchColumn()) {
                return;
            }

            $statement = $pdo->prepare(
                "INSERT INTO public.glpi_plugin_integaglpi_audit_events (
                    correlation_id,
                    ticket_id,
                    conversation_id,
                    message_id,
                    direction,
                    event_type,
                    status,
                    severity,
                    source,
                    payload_json,
                    created_at
                ) VALUES (
                    :correlation_id,
                    NULL,
                    NULL,
                    NULL,
                    NULL,
                    :event_type,
                    :status,
                    :severity,
                    'AiConfigViewService',
                    CAST(:payload AS jsonb),
                    NOW()
                )"
            );
            $statement->execute([
                ':correlation_id' => 'ai_config:' . bin2hex(random_bytes(8)),
                ':event_type' => $eventType,
                ':status' => $status,
                ':severity' => $status === 'blocked' ? 'warning' : 'info',
                ':payload' => json_encode($this->sanitizeAuditPayload($payload), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
            ]);
        } catch (Throwable $exception) {
            error_log('[integaglpi][ai_config][audit] ' . $this->sanitizeLog($exception->getMessage()));
        }
    }

    /**
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    private function sanitizeAuditPayload(array $payload): array
    {
        unset($payload['token'], $payload['secret'], $payload['password'], $payload['api_key'], $payload['bearer']);

        return $payload;
    }

    private function sanitizeLog(string $message): string
    {
        $message = preg_replace('/(password|senha|token|secret|bearer|api_key)\s*[:=]\s*\S+/i', '$1=[redacted]', $message) ?? '';

        return substr($message, 0, 180);
    }
}
