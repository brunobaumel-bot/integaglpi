<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\Support\Db;
use PDO;
use RuntimeException;

final class PluginConfigService
{
    private const CONTEXT_CONNECTION = 'connection';
    private const CONTEXT_MESSAGE = 'message';
    private const CONTEXT_TEMPLATES = 'templates';
    private const CONTEXT_INDEX = 'uniq_integaglpi_configs_context';
    private const AI_SUPERVISOR_ENABLED_KEY = 'ai_supervisor_enabled';
    private const LOCAL_TEMPLATE_CATALOG_KEY = 'local_template_catalog_json';
    private const DEFAULT_INTEGRATION_SERVICE_URL = 'http://127.0.0.1:3001';
    private const MESSAGE_DEFAULTS = [
        'welcome_message' => 'Olá! Como podemos ajudar?',
        'menu_message' => 'Escolha uma das opções de atendimento.',
        'invalid_option_message' => 'Por favor, responda com uma opção válida do menu.',
        'invalid_media_message' => 'Por favor, envie uma resposta em texto para continuar.',
        'queue_selected_message' => 'Atendimento direcionado. Vamos continuar por aqui.',
        'after_hours_message' => 'Recebemos sua mensagem fora do horário de atendimento.',
        'conversation_closed_message' => 'Esta conversa foi encerrada. Envie uma nova mensagem para iniciar outro atendimento.',
        'error_fallback_message' => 'Não conseguimos processar sua resposta agora. Vamos encaminhar para atendimento.',
    ];
    private const CATALOG_SEND_TYPES = ['text', 'interactive_buttons', 'interactive_list', 'template', 'internal_only'];
    private const MESSAGE_PLACEHOLDER_KEYS = [
        'nome',
        'empresa',
        'ticket_id',
        'fila',
        'protocolo',
        'tecnico',
        'entidade',
        'horario_atendimento',
        'email',
        'telefone_mascarado',
        'link_ticket',
    ];
    private const MESSAGE_PLACEHOLDER_PREVIEW_VALUES = [
        'nome' => 'Cliente Exemplo',
        'empresa' => 'Empresa Exemplo',
        'ticket_id' => '12345',
        'fila' => 'Suporte',
        'protocolo' => 'WA-12345',
        'tecnico' => 'Técnico',
        'entidade' => 'Unidade Exemplo',
        'horario_atendimento' => '08h às 18h',
        'email' => 'cliente@example.com',
        'telefone_mascarado' => '+55******0000',
        'link_ticket' => 'https://glpi.example.com/front/ticket.form.php?id=12345',
    ];
    private const LOCAL_TEMPLATE_STATUSES = ['approved', 'pending', 'rejected', 'paused', 'draft'];
    private const MESSAGE_CATALOG_DEFAULTS = [
        'welcome_message' => ['Boas-vindas e Fila', 'Mensagem inicial do atendimento', 'Olá! Como podemos ajudar?', 'text', true],
        'queue_selection_prompt' => ['Boas-vindas e Fila', 'Solicita escolha de fila', 'Escolha uma das opções de atendimento.', 'interactive_buttons', true],
        'invalid_queue_selection' => ['Boas-vindas e Fila', 'Opção de fila inválida', 'Por favor, responda com uma opção válida do menu.', 'text', true],
        'profile_name_prompt' => ['Coleta de Perfil', 'Solicita nome', 'Por favor, informe seu nome.', 'text', true],
        'profile_company_prompt' => ['Coleta de Perfil', 'Solicita empresa', 'Por favor, informe a empresa.', 'text', true],
        'profile_email_prompt' => ['Coleta de Perfil', 'Solicita e-mail', 'Se tiver, informe seu e-mail para cadastro.', 'text', true],
        'profile_equipment_prompt' => ['Coleta de Perfil', 'Solicita equipamento', 'Informe o equipamento ou sistema afetado.', 'text', true],
        'profile_reason_prompt' => ['Coleta de Perfil', 'Solicita motivo', 'Descreva resumidamente o problema.', 'text', true],
        'profile_confirmation_prompt' => ['Coleta de Perfil', 'Confirma dados coletados', 'Confirma as informações para abrir o chamado?', 'interactive_buttons', true],
        'profile_confirmed_message' => ['Coleta de Perfil', 'Perfil confirmado', 'Dados registrados. Vamos abrir seu chamado.', 'text', false],
        'awaiting_entity_message' => ['Ticket e Solução', 'Aguardando seleção de entidade', 'Recebemos as suas informações, em breve um técnico seguirá com o atendimento.', 'text', false],
        'ticket_created_message' => ['Ticket e Solução', 'Chamado criado', 'Seu chamado #{ticket_id} foi aberto.', 'text', false],
        'ticket_updated_message' => ['Ticket e Solução', 'Chamado atualizado', 'Atualizamos seu chamado com a nova mensagem.', 'text', false],
        'technician_transfer_message' => ['Ticket e Solução', 'Transferência de técnico', 'Seu atendimento foi encaminhado para outro técnico.', 'text', false],
        'technician_assumed_message' => ['Ticket e Solução', 'Técnico assumiu atendimento', 'Um técnico assumiu seu atendimento e seguirá por aqui.', 'text', false],
        'inactivity_reminder_1' => ['Avisos e Inatividade', 'Primeiro lembrete de inatividade', 'Olá! Estamos aguardando seu retorno para continuar o atendimento. Podemos ajudar em algo mais?', 'text', true],
        'inactivity_reminder_2' => ['Avisos e Inatividade', 'Segundo lembrete de inatividade', 'Ainda estamos por aqui. Para seguirmos com o chamado, responda esta mensagem quando puder.', 'text', true],
        'inactivity_reminder_3' => ['Avisos e Inatividade', 'Terceiro lembrete de inatividade', 'Como ainda não tivemos retorno, este atendimento poderá ser encerrado automaticamente se não houver resposta.', 'text', true],
        'inactivity_autoclose_warning' => ['Avisos e Inatividade', 'Aviso antes do encerramento', 'Este atendimento poderá ser encerrado automaticamente se não houver resposta.', 'text', false],
        'inactivity_autoclose_message' => ['Avisos e Inatividade', 'Mensagem final de inatividade', 'Como não tivemos retorno, estamos encerrando este atendimento por falta de resposta. Se precisar, basta nos chamar novamente.', 'text', false],
        'solution_submitted_message' => ['Ticket e Solução', 'Solução enviada', 'Seu chamado foi solucionado.', 'text', false],
        'solution_approve_reopen_prompt' => ['Ticket e Solução', 'Aprovação ou reabertura', 'Seu chamado foi solucionado. Você aprova a solução?', 'interactive_buttons', true],
        'solution_approved_message' => ['Ticket e Solução', 'Solução aprovada', 'Obrigado pela confirmação.', 'text', false],
        'solution_reopen_message' => ['Ticket e Solução', 'Solução reaberta', 'Vamos reabrir o atendimento para continuidade.', 'text', false],
        'csat_prompt' => ['CSAT', 'Pesquisa de satisfação', 'Como você avalia este atendimento?', 'interactive_buttons', true],
        'csat_thanks_message' => ['CSAT', 'Agradecimento CSAT', 'Obrigado pela avaliação.', 'text', false],
        'media_received_message' => ['Mídia', 'Mídia recebida', 'Recebemos o arquivo enviado e vamos analisá-lo.', 'text', false],
        'media_processing_failed_message' => ['Mídia', 'Falha ao processar mídia', 'Não conseguimos processar o arquivo agora. Um técnico vai verificar.', 'text', false],
        'outside_24h_template_required_message' => ['Avisos e Inatividade', 'Janela 24h fechada', 'A janela de 24h está fechada. Use um template aprovado para iniciar contato.', 'internal_only', false],
        'outside_business_hours_message' => ['Horário Comercial', 'Mensagem fora do horário', 'Olá! Nosso horário de atendimento é de segunda a sexta, das 08h às 18h. Recebemos sua mensagem e retornaremos em breve.', 'text', false],
        'outside_business_hours_template_missing' => ['Horário Comercial', 'Template ausente fora da janela', 'Mensagem fora do horário não enviada: janela 24h fechada e template local ausente.', 'internal_only', false],
        'outside_business_hours_cooldown_skipped' => ['Horário Comercial', 'Cooldown fora do horário', 'Mensagem fora do horário suprimida por cooldown.', 'internal_only', false],
        'outside_business_hours_sent' => ['Horário Comercial', 'Fora do horário enviado', 'Mensagem fora do horário enviada.', 'internal_only', false],
        'outside_business_hours_failed' => ['Horário Comercial', 'Falha fora do horário', 'Falha ao enviar mensagem fora do horário.', 'internal_only', false],
    ];

    private static bool $configSchemaEnsured = false;

    /**
     * @return array<string, mixed>
     */
    public function getConnectionConfig(): array
    {
        $this->ensureConfigSchema();

        $rows = Db::fetchAll([
            'FROM' => PLUGIN_INTEGAGLPI_CONFIG_TABLE,
            'WHERE' => ['context' => self::CONTEXT_CONNECTION],
        ]);
        $config = $this->selectPreferredConnectionRow($rows);

        return $config ?? [
            'context' => self::CONTEXT_CONNECTION,
            'db_host' => '',
            'db_port' => 5432,
            'db_name' => '',
            'db_user' => '',
            'db_password' => '',
            'db_sslmode' => 'prefer',
            'integration_service_url' => self::DEFAULT_INTEGRATION_SERVICE_URL,
            'integration_auth_key' => '',
            self::AI_SUPERVISOR_ENABLED_KEY => 0,
        ];
    }

    public function getIntegrationServiceUrl(): string
    {
        $config = $this->getConnectionConfig();
        $configured = $this->normalizeUrl($config['integration_service_url'] ?? null);

        return $configured !== '' ? $configured : self::DEFAULT_INTEGRATION_SERVICE_URL;
    }

    public function getIntegrationAuthKey(): string
    {
        $config = $this->getConnectionConfig();

        return $this->normalizeString($config['integration_auth_key'] ?? null);
    }

    public function getAiSupervisorEnabledRaw(): string
    {
        $config = $this->getConnectionConfig();
        $value = $this->normalizeString($config[self::AI_SUPERVISOR_ENABLED_KEY] ?? null);

        return $value !== '' ? $value : '0';
    }

    public function isAiSupervisorEnabled(): bool
    {
        return $this->isTruthy($this->getAiSupervisorEnabledRaw());
    }

    public function isConfigured(): bool
    {
        $config = $this->getConnectionConfig();

        return $this->normalizeString($config['db_host'] ?? null) !== ''
            && (int) ($config['db_port'] ?? 0) > 0
            && $this->normalizeString($config['db_name'] ?? null) !== ''
            && $this->normalizeString($config['db_user'] ?? null) !== '';
    }

    /**
     * @param array<string, mixed> $input
     */
    public function saveConnectionConfig(array $input): void
    {
        $this->ensureConfigSchema();

        $currentConfig = $this->getConnectionConfig();
        $passwordInput = $this->normalizeString($input['db_password'] ?? null);
        $authKeyInput = $this->normalizeString($input['integration_auth_key'] ?? null);
        $payload = [
            'context' => self::CONTEXT_CONNECTION,
            'db_host' => $this->requireNonEmptyString(
                $input['db_host'] ?? null,
                __('PostgreSQL host is required.', 'glpiintegaglpi')
            ),
            'db_port' => $this->requirePositiveInteger(
                $input['db_port'] ?? null,
                __('A valid PostgreSQL port is required.', 'glpiintegaglpi')
            ),
            'db_name' => $this->requireNonEmptyString(
                $input['db_name'] ?? null,
                __('PostgreSQL database name is required.', 'glpiintegaglpi')
            ),
            'db_user' => $this->requireNonEmptyString(
                $input['db_user'] ?? null,
                __('PostgreSQL user is required.', 'glpiintegaglpi')
            ),
            'db_password' => $passwordInput !== '' ? $passwordInput : (string) ($currentConfig['db_password'] ?? ''),
            'db_sslmode' => $this->normalizeSslMode($input['db_sslmode'] ?? null),
            'integration_service_url' => $this->requireIntegrationServiceUrl($input['integration_service_url'] ?? null),
            'integration_auth_key' => $authKeyInput !== ''
                ? $authKeyInput
                : (string) ($currentConfig['integration_auth_key'] ?? ''),
            self::AI_SUPERVISOR_ENABLED_KEY => !empty($input[self::AI_SUPERVISOR_ENABLED_KEY]) ? 1 : 0,
        ];

        $existingId = (int) ($currentConfig['id'] ?? 0);

        if ($existingId > 0) {
            if (!Db::update(PLUGIN_INTEGAGLPI_CONFIG_TABLE, $payload, ['id' => $existingId])) {
                throw new RuntimeException(__('Failed to update the external PostgreSQL configuration. Check server logs for details.', 'glpiintegaglpi'));
            }
            return;
        }

        if (!Db::insert(PLUGIN_INTEGAGLPI_CONFIG_TABLE, $payload)) {
            throw new RuntimeException(__('Failed to save the external PostgreSQL configuration. Check server logs for details.', 'glpiintegaglpi'));
        }
    }

    /**
     * @return array<string, string>
     */
    public function getMessageConfig(): array
    {
        $this->ensureConfigSchema();

        $config = Db::fetchOne([
            'FROM' => PLUGIN_INTEGAGLPI_CONFIG_TABLE,
            'WHERE' => ['context' => self::CONTEXT_MESSAGE],
        ]);

        return $this->messageConfigFromRow($config ?? []);
    }

    /**
     * @param array<string, mixed> $input
     */
    public function saveMessageConfig(array $input): ?string
    {
        $this->ensureConfigSchema();

        $payload = ['context' => self::CONTEXT_MESSAGE];
        foreach (array_keys(self::MESSAGE_DEFAULTS) as $key) {
            $payload[$key] = $this->messageOrDefault($input[$key] ?? null, $key);
        }

        $current = Db::fetchOne([
            'FROM' => PLUGIN_INTEGAGLPI_CONFIG_TABLE,
            'WHERE' => ['context' => self::CONTEXT_MESSAGE],
        ]);
        $existingId = (int) ($current['id'] ?? 0);

        if ($existingId > 0) {
            if (!Db::update(PLUGIN_INTEGAGLPI_CONFIG_TABLE, $payload, ['id' => $existingId])) {
                throw new RuntimeException(__('Failed to update attendance messages.', 'glpiintegaglpi'));
            }
            return (new ExternalSettingsSyncService())->syncMessageSettings($payload);
        }

        if (!Db::insert(PLUGIN_INTEGAGLPI_CONFIG_TABLE, $payload)) {
            throw new RuntimeException(__('Failed to save attendance messages.', 'glpiintegaglpi'));
        }

        return (new ExternalSettingsSyncService())->syncMessageSettings($payload);
    }

    /**
     * @return array<string, list<array<string, mixed>>>
     */
    public function getMessageCatalogGrouped(): array
    {
        $defaults = $this->defaultMessageCatalogRows();
        try {
            $pdo = $this->getExternalPdo();
            if (!$this->externalTableExists($pdo, 'glpi_plugin_integaglpi_message_catalog')) {
                return $this->groupCatalogRows($defaults);
            }

            $stmt = $pdo->query(
                "SELECT event_key, description, group_name, default_text, custom_text, is_active, send_type, language, fallback_text, template_name, buttons_json::text AS buttons_json, list_options_json::text AS list_options_json, expects_response, updated_at, updated_by
                 FROM glpi_plugin_integaglpi_message_catalog
                 ORDER BY group_name, event_key"
            );
            $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
            $byKey = [];
            foreach ($defaults as $row) {
                $byKey[(string) $row['event_key']] = $row;
            }
            foreach ($rows as $row) {
                $eventKey = $this->normalizeString($row['event_key'] ?? null);
                if ($eventKey === '') {
                    continue;
                }
                $byKey[$eventKey] = [
                    ...($byKey[$eventKey] ?? []),
                    ...$row,
                    'buttons_json' => $this->prettyJson((string) ($row['buttons_json'] ?? '[]')),
                    'list_options_json' => $this->prettyJson((string) ($row['list_options_json'] ?? '[]')),
                ];
            }

            return $this->groupCatalogRows(array_values($byKey));
        } catch (\Throwable $exception) {
            error_log('[integaglpi][message_catalog][load] ' . $exception->getMessage());
            return $this->groupCatalogRows($defaults);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function getBusinessHoursConfig(): array
    {
        $default = [
            'business_hours_enabled' => false,
            'timezone' => 'America/Sao_Paulo',
            'weekday_start_time' => '08:00',
            'weekday_end_time' => '18:00',
            'saturday_enabled' => false,
            'saturday_start_time' => '',
            'saturday_end_time' => '',
            'sunday_enabled' => false,
            'sunday_start_time' => '',
            'sunday_end_time' => '',
            'holiday_behavior' => 'normal',
            'outside_hours_event_key' => 'outside_business_hours_message',
            'cooldown_minutes' => 60,
        ];

        try {
            $pdo = $this->getExternalPdo();
            if (!$this->externalTableExists($pdo, 'glpi_plugin_integaglpi_business_hours')) {
                return $default;
            }
            $stmt = $pdo->query(
                "SELECT business_hours_enabled, timezone, weekday_start_time, weekday_end_time, saturday_enabled, saturday_start_time, saturday_end_time, sunday_enabled, sunday_start_time, sunday_end_time, holiday_behavior, outside_hours_event_key, cooldown_minutes
                 FROM glpi_plugin_integaglpi_business_hours
                 ORDER BY id ASC
                 LIMIT 1"
            );
            $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
            if (!is_array($row)) {
                return $default;
            }

            return [...$default, ...$row];
        } catch (\Throwable $exception) {
            error_log('[integaglpi][business_hours][load] ' . $exception->getMessage());
            return $default;
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function getInactivityConfig(): array
    {
        $default = [
            'inactivity_enabled' => false,
            'inactivity_reminder_1_minutes' => 15,
            'inactivity_reminder_2_minutes' => 20,
            'inactivity_reminder_3_minutes' => 25,
            'inactivity_autoclose_minutes' => 30,
        ];

        try {
            $pdo = $this->getExternalPdo();
            if (!$this->externalTableExists($pdo, 'glpi_plugin_integaglpi_configs')) {
                return $default;
            }
            $stmt = $pdo->query(
                "SELECT inactivity_enabled, inactivity_reminder_1_minutes, inactivity_reminder_2_minutes, inactivity_reminder_3_minutes, inactivity_autoclose_minutes
                 FROM glpi_plugin_integaglpi_configs
                 WHERE context = 'inactivity'
                 LIMIT 1"
            );
            $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
            if (!is_array($row)) {
                return $default;
            }

            return [
                'inactivity_enabled' => $this->normalizeBool($row['inactivity_enabled'] ?? false),
                'inactivity_reminder_1_minutes' => $this->positiveIntegerOrDefault($row['inactivity_reminder_1_minutes'] ?? null, 15),
                'inactivity_reminder_2_minutes' => $this->positiveIntegerOrDefault($row['inactivity_reminder_2_minutes'] ?? null, 20),
                'inactivity_reminder_3_minutes' => $this->positiveIntegerOrDefault($row['inactivity_reminder_3_minutes'] ?? null, 25),
                'inactivity_autoclose_minutes' => $this->positiveIntegerOrDefault($row['inactivity_autoclose_minutes'] ?? null, 30),
            ];
        } catch (\Throwable $exception) {
            error_log('[integaglpi][inactivity_config][load] ' . $exception->getMessage());
            return $default;
        }
    }

    /**
     * @param array<string, mixed> $input
     */
    public function saveInactivityConfig(array $input, int $userId): void
    {
        $r1 = $this->requirePositiveTimer($input['inactivity_reminder_1_minutes'] ?? null, 'reminder_1_minutes');
        $r2 = $this->requirePositiveTimer($input['inactivity_reminder_2_minutes'] ?? null, 'reminder_2_minutes');
        $r3 = $this->requirePositiveTimer($input['inactivity_reminder_3_minutes'] ?? null, 'reminder_3_minutes');
        $autoclose = $this->requirePositiveTimer($input['inactivity_autoclose_minutes'] ?? null, 'autoclose_minutes');
        if (!($r1 < $r2 && $r2 < $r3 && $r3 < $autoclose)) {
            throw new RuntimeException(__('Timers inválidos: use reminder_1 < reminder_2 < reminder_3 < autoclose.', 'glpiintegaglpi'));
        }

        $payload = [
            'context' => 'inactivity',
            'inactivity_enabled' => !empty($input['inactivity_enabled']) ? '1' : '0',
            'inactivity_reminder_1_minutes' => $r1,
            'inactivity_reminder_2_minutes' => $r2,
            'inactivity_reminder_3_minutes' => $r3,
            'inactivity_autoclose_minutes' => $autoclose,
        ];
        $pdo = $this->getExternalPdo();
        $stmt = $pdo->prepare(
            "INSERT INTO glpi_plugin_integaglpi_configs
              (context, inactivity_enabled, inactivity_reminder_1_minutes, inactivity_reminder_2_minutes, inactivity_reminder_3_minutes, inactivity_autoclose_minutes, updated_at)
             VALUES
              (:context, :inactivity_enabled, :r1, :r2, :r3, :autoclose, NOW())
             ON CONFLICT (context) DO UPDATE SET
              inactivity_enabled = EXCLUDED.inactivity_enabled,
              inactivity_reminder_1_minutes = EXCLUDED.inactivity_reminder_1_minutes,
              inactivity_reminder_2_minutes = EXCLUDED.inactivity_reminder_2_minutes,
              inactivity_reminder_3_minutes = EXCLUDED.inactivity_reminder_3_minutes,
              inactivity_autoclose_minutes = EXCLUDED.inactivity_autoclose_minutes,
              updated_at = NOW()"
        );
        $stmt->execute([
            ':context' => $payload['context'],
            ':inactivity_enabled' => $payload['inactivity_enabled'],
            ':r1' => $payload['inactivity_reminder_1_minutes'],
            ':r2' => $payload['inactivity_reminder_2_minutes'],
            ':r3' => $payload['inactivity_reminder_3_minutes'],
            ':autoclose' => $payload['inactivity_autoclose_minutes'],
        ]);
        $this->insertCatalogAudit($pdo, 'inactivity:timers', 'update', null, $payload, $userId);
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getMessageCatalogAudit(int $limit = 20): array
    {
        try {
            $pdo = $this->getExternalPdo();
            if (!$this->externalTableExists($pdo, 'glpi_plugin_integaglpi_message_catalog_audit')) {
                return [];
            }
            $stmt = $pdo->prepare(
                "SELECT event_key, action, changed_by, changed_at
                 FROM glpi_plugin_integaglpi_message_catalog_audit
                 ORDER BY changed_at DESC
                 LIMIT :limit"
            );
            $stmt->bindValue(':limit', max(1, min(50, $limit)), PDO::PARAM_INT);
            $stmt->execute();

            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (\Throwable $exception) {
            error_log('[integaglpi][message_catalog][audit] ' . $exception->getMessage());
            return [];
        }
    }

    /**
     * @return list<string>
     */
    public function getMessagePlaceholderAllowlist(): array
    {
        return self::MESSAGE_PLACEHOLDER_KEYS;
    }

    public function previewMessageText(mixed $text): string
    {
        return $this->renderPreviewPlaceholders($this->normalizeString($text));
    }

    /**
     * @param array<string, mixed> $variablesMapping
     */
    public function previewTemplateText(mixed $text, array $variablesMapping): string
    {
        return $this->renderTemplatePreviewPlaceholders($this->normalizeString($text), $variablesMapping);
    }

    /**
     * @param array<string, mixed> $input
     */
    public function saveMessageCatalogEntry(array $input, int $userId): void
    {
        $eventKey = $this->requireKnownEventKey($input['event_key'] ?? null);
        $default = $this->defaultMessageCatalogRows()[$eventKey];
        $sendType = $this->normalizeSendType($input['send_type'] ?? null);
        $buttonsJson = $this->normalizeJsonList($input['buttons_json'] ?? '[]', 'buttons_json');
        $listOptionsJson = $this->normalizeJsonList($input['list_options_json'] ?? '[]', 'list_options_json');
        $customText = $this->nullableString($input['custom_text'] ?? null);
        $fallbackText = $this->nullableString($input['fallback_text'] ?? null);
        $templateName = $this->nullableString($input['template_name'] ?? null);

        $this->validateAllowedPlaceholders($customText ?? '', 'custom_text');
        $this->validateAllowedPlaceholders($fallbackText ?? '', 'fallback_text');
        if ($sendType === 'template' && $templateName === null) {
            throw new RuntimeException(__('Template send type requires a local template name.', 'glpiintegaglpi'));
        }
        if ($templateName !== null) {
            $this->requireValidTemplateName($templateName);
        }

        $payload = [
            'event_key' => $eventKey,
            'description' => (string) $default['description'],
            'group_name' => (string) $default['group_name'],
            'default_text' => (string) $default['default_text'],
            'custom_text' => $customText,
            'is_active' => $this->normalizeBool($input['is_active'] ?? false),
            'send_type' => $sendType,
            'language' => $this->normalizeString($input['language'] ?? null) ?: 'pt_BR',
            'fallback_text' => $fallbackText,
            'template_name' => $templateName,
            'buttons_json' => json_encode($buttonsJson, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '[]',
            'list_options_json' => json_encode($listOptionsJson, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '[]',
            'expects_response' => $this->normalizeBool($input['expects_response'] ?? false),
            'updated_by' => $userId > 0 ? $userId : null,
        ];

        $pdo = $this->getExternalPdo();
        $old = $this->fetchCatalogRow($pdo, $eventKey);
        $stmt = $pdo->prepare(
            "INSERT INTO glpi_plugin_integaglpi_message_catalog
              (event_key, description, group_name, default_text, custom_text, is_active, send_type, language, fallback_text, template_name, buttons_json, list_options_json, expects_response, updated_by, updated_at)
             VALUES
              (:event_key, :description, :group_name, :default_text, :custom_text, :is_active, :send_type, :language, :fallback_text, :template_name, CAST(:buttons_json AS jsonb), CAST(:list_options_json AS jsonb), :expects_response, :updated_by, NOW())
             ON CONFLICT (event_key) DO UPDATE SET
              custom_text = EXCLUDED.custom_text,
              is_active = EXCLUDED.is_active,
              send_type = EXCLUDED.send_type,
              language = EXCLUDED.language,
              fallback_text = EXCLUDED.fallback_text,
              template_name = EXCLUDED.template_name,
              buttons_json = EXCLUDED.buttons_json,
              list_options_json = EXCLUDED.list_options_json,
              expects_response = EXCLUDED.expects_response,
              updated_by = EXCLUDED.updated_by,
              updated_at = NOW()"
        );
        $this->bindMessageCatalogParams($stmt, $payload);
        $stmt->execute();
        $this->insertCatalogAudit($pdo, $eventKey, $old === null ? 'create' : 'update', $old, $payload, $userId);
    }

    /**
     * @param array<string, mixed> $input
     */
    public function saveBusinessHoursConfig(array $input, int $userId): void
    {
        $businessHoursEnabled = $this->normalizeBool($input['business_hours_enabled'] ?? false);
        $saturdayEnabled = $this->normalizeBool($input['saturday_enabled'] ?? false);
        $sundayEnabled = $this->normalizeBool($input['sunday_enabled'] ?? false);
        [$weekdayStartTime, $weekdayEndTime] = $this->requireTimeRange(
            $input['weekday_start_time'] ?? null,
            $input['weekday_end_time'] ?? null,
            __('Monday-Friday', 'glpiintegaglpi')
        );
        [$saturdayStartTime, $saturdayEndTime] = $this->optionalTimeRange(
            $saturdayEnabled,
            $input['saturday_start_time'] ?? null,
            $input['saturday_end_time'] ?? null,
            __('Saturday', 'glpiintegaglpi')
        );
        [$sundayStartTime, $sundayEndTime] = $this->optionalTimeRange(
            $sundayEnabled,
            $input['sunday_start_time'] ?? null,
            $input['sunday_end_time'] ?? null,
            __('Sunday', 'glpiintegaglpi')
        );
        $payload = [
            'business_hours_enabled' => $businessHoursEnabled,
            'timezone' => $this->normalizeString($input['business_hours_timezone'] ?? null) ?: 'America/Sao_Paulo',
            'weekday_start_time' => $weekdayStartTime,
            'weekday_end_time' => $weekdayEndTime,
            'saturday_enabled' => $saturdayEnabled,
            'saturday_start_time' => $saturdayStartTime,
            'saturday_end_time' => $saturdayEndTime,
            'sunday_enabled' => $sundayEnabled,
            'sunday_start_time' => $sundayStartTime,
            'sunday_end_time' => $sundayEndTime,
            'holiday_behavior' => in_array((string) ($input['holiday_behavior'] ?? ''), ['closed', 'normal', 'custom'], true)
                ? (string) $input['holiday_behavior']
                : 'normal',
            'outside_hours_event_key' => 'outside_business_hours_message',
            'cooldown_minutes' => max(1, min(1440, (int) ($input['cooldown_minutes'] ?? 60))),
            'updated_by' => $userId > 0 ? $userId : null,
        ];

        $pdo = $this->getExternalPdo();
        $stmt = $pdo->prepare(
            "UPDATE glpi_plugin_integaglpi_business_hours
             SET business_hours_enabled = :business_hours_enabled,
                 timezone = :timezone,
                 weekday_start_time = :weekday_start_time,
                 weekday_end_time = :weekday_end_time,
                 saturday_enabled = :saturday_enabled,
                 saturday_start_time = :saturday_start_time,
                 saturday_end_time = :saturday_end_time,
                 sunday_enabled = :sunday_enabled,
                 sunday_start_time = :sunday_start_time,
                 sunday_end_time = :sunday_end_time,
                 holiday_behavior = :holiday_behavior,
                 outside_hours_event_key = :outside_hours_event_key,
                 cooldown_minutes = :cooldown_minutes,
                 updated_by = :updated_by,
                 updated_at = NOW()
             WHERE id = (
                 SELECT id
                 FROM glpi_plugin_integaglpi_business_hours
                 ORDER BY id ASC
                 LIMIT 1
             )"
        );
        $params = [
            ':timezone' => $payload['timezone'],
            ':weekday_start_time' => $payload['weekday_start_time'],
            ':weekday_end_time' => $payload['weekday_end_time'],
            ':saturday_start_time' => $payload['saturday_start_time'],
            ':saturday_end_time' => $payload['saturday_end_time'],
            ':sunday_start_time' => $payload['sunday_start_time'],
            ':sunday_end_time' => $payload['sunday_end_time'],
            ':holiday_behavior' => $payload['holiday_behavior'],
            ':outside_hours_event_key' => $payload['outside_hours_event_key'],
            ':cooldown_minutes' => $payload['cooldown_minutes'],
            ':updated_by' => $payload['updated_by'],
        ];
        $this->bindBusinessHoursParams($stmt, $params, $payload);
        $stmt->execute();
        if ($stmt->rowCount() > 0) {
            return;
        }

        $insert = $pdo->prepare(
            "INSERT INTO glpi_plugin_integaglpi_business_hours
              (business_hours_enabled, timezone, weekday_start_time, weekday_end_time, saturday_enabled, saturday_start_time, saturday_end_time, sunday_enabled, sunday_start_time, sunday_end_time, holiday_behavior, outside_hours_event_key, cooldown_minutes, updated_by, updated_at)
             VALUES
              (:business_hours_enabled, :timezone, :weekday_start_time, :weekday_end_time, :saturday_enabled, :saturday_start_time, :saturday_end_time, :sunday_enabled, :sunday_start_time, :sunday_end_time, :holiday_behavior, :outside_hours_event_key, :cooldown_minutes, :updated_by, NOW())"
        );
        $this->bindBusinessHoursParams($insert, $params, $payload);
        $insert->execute();
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getLocalTemplates(): array
    {
        $this->ensureConfigSchema();

        $row = Db::fetchOne([
            'FROM' => PLUGIN_INTEGAGLPI_CONFIG_TABLE,
            'WHERE' => ['context' => self::CONTEXT_TEMPLATES],
        ]);

        $decoded = json_decode($this->normalizeString($row[self::LOCAL_TEMPLATE_CATALOG_KEY] ?? null), true);
        if (!is_array($decoded)) {
            return [];
        }

        $templates = [];
        foreach ($decoded as $template) {
            if (!is_array($template)) {
                continue;
            }

            $name = $this->normalizeString($template['name'] ?? null);
            $language = $this->normalizeString($template['language'] ?? null);
            $body = $this->normalizeString($template['body'] ?? null);
            if ($name === '' || $language === '' || $body === '') {
                continue;
            }

            $templates[] = [
                'id' => $this->normalizeString($template['id'] ?? null) ?: sha1($name . '|' . $language),
                'name' => $name,
                'language' => $language,
                'category' => $this->normalizeString($template['category'] ?? null) ?: 'utility',
                'body' => $body,
                'body_preview' => $body,
                'variables_mapping' => $this->normalizeTemplateMapping($template['variables_mapping'] ?? []),
                'status' => $this->normalizeTemplateStatus($template['status'] ?? null),
                'usage_context' => $this->normalizeString($template['usage_context'] ?? null),
                'requires_manual_confirmation' => array_key_exists('requires_manual_confirmation', $template)
                    ? $this->normalizeBool($template['requires_manual_confirmation'])
                    : true,
                'cost_warning_enabled' => array_key_exists('cost_warning_enabled', $template)
                    ? $this->normalizeBool($template['cost_warning_enabled'])
                    : true,
                'is_active' => !empty($template['is_active']),
            ];
        }

        return $templates;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getActiveLocalTemplates(): array
    {
        return array_values(array_filter(
            $this->getLocalTemplates(),
            static fn (array $template): bool => !empty($template['is_active'])
        ));
    }

    /**
     * @param array<string, mixed> $input
     */
    public function saveLocalTemplate(array $input, int $userId = 0): void
    {
        $templates = $this->getLocalTemplates();
        $id = $this->normalizeString($input['template_id'] ?? null);
        $name = $this->requireNonEmptyString(
            $input['template_name'] ?? null,
            __('Template name is required.', 'glpiintegaglpi')
        );
        $language = $this->requireNonEmptyString(
            $input['template_language'] ?? null,
            __('Template language is required.', 'glpiintegaglpi')
        );
        $body = $this->requireNonEmptyString(
            $input['template_body'] ?? null,
            __('Template body is required.', 'glpiintegaglpi')
        );
        $category = $this->normalizeString($input['template_category'] ?? null) ?: 'utility';
        $isActive = !empty($input['template_is_active']);
        $status = $this->normalizeTemplateStatus($input['template_status'] ?? null);
        $usageContext = $this->normalizeString($input['template_usage_context'] ?? null);
        $variablesMapping = $this->normalizeTemplateMapping($input['template_variables_mapping'] ?? '[]');
        $requiresManualConfirmation = true;
        $costWarningEnabled = true;
        $this->validateTemplateBodyPlaceholders($body, $variablesMapping);
        $this->requireValidTemplateName($name);
        if ($isActive && $status !== 'approved') {
            throw new RuntimeException(__('Only approved local templates can be activated.', 'glpiintegaglpi'));
        }
        if ($id === '') {
            $id = sha1($name . '|' . $language . '|' . microtime(true));
        }

        $templatePayload = [
            'id' => $id,
            'name' => $name,
            'language' => $language,
            'category' => $category,
            'body' => $body,
            'body_preview' => $body,
            'variables_mapping' => $variablesMapping,
            'status' => $status,
            'usage_context' => $usageContext,
            'requires_manual_confirmation' => $requiresManualConfirmation,
            'cost_warning_enabled' => $costWarningEnabled,
            'is_active' => $isActive,
        ];

        $upserted = false;
        $oldTemplate = null;
        foreach ($templates as &$template) {
            if ($template['id'] !== $id) {
                continue;
            }

            $oldTemplate = $template;
            $template = $templatePayload;
            $upserted = true;
            break;
        }
        unset($template);

        if (!$upserted) {
            $templates[] = $templatePayload;
        }

        $this->saveLocalTemplates($templates);
        $this->insertLocalTemplateAudit($upserted ? 'update' : 'create', $oldTemplate, $templatePayload, $userId);
    }

    public function setLocalTemplateActive(string $templateId, bool $isActive, int $userId = 0): void
    {
        $templateId = $this->normalizeString($templateId);
        if ($templateId === '') {
            throw new RuntimeException(__('Template identifier is required.', 'glpiintegaglpi'));
        }

        $templates = $this->getLocalTemplates();
        $found = false;
        $oldTemplate = null;
        $newTemplate = null;
        foreach ($templates as &$template) {
            if ($template['id'] !== $templateId) {
                continue;
            }

            $oldTemplate = $template;
            if ($isActive && ($template['status'] ?? 'approved') !== 'approved') {
                throw new RuntimeException(__('Only approved local templates can be activated.', 'glpiintegaglpi'));
            }
            $template['is_active'] = $isActive;
            $newTemplate = $template;
            $found = true;
            break;
        }
        unset($template);

        if (!$found) {
            throw new RuntimeException(__('Template not found.', 'glpiintegaglpi'));
        }

        $this->saveLocalTemplates($templates);
        $this->insertLocalTemplateAudit($isActive ? 'enable' : 'disable', $oldTemplate, $newTemplate ?? [], $userId);
    }

    private function ensureConfigSchema(): void
    {
        global $DB;

        if (self::$configSchemaEnsured) {
            return;
        }
        self::$configSchemaEnsured = true;

        if (!isset($DB) || !is_object($DB) || !$DB->tableExists(PLUGIN_INTEGAGLPI_CONFIG_TABLE)) {
            return;
        }

        $table = PLUGIN_INTEGAGLPI_CONFIG_TABLE;
        $columns = [
            'context' => "ALTER TABLE `{$table}` ADD COLUMN `context` VARCHAR(64) NOT NULL DEFAULT 'connection' AFTER `id`",
            'integration_service_url' => "ALTER TABLE `{$table}` ADD COLUMN `integration_service_url` VARCHAR(255) NOT NULL DEFAULT '" . self::DEFAULT_INTEGRATION_SERVICE_URL . "'",
            'integration_auth_key' => "ALTER TABLE `{$table}` ADD COLUMN `integration_auth_key` TEXT DEFAULT NULL",
            self::AI_SUPERVISOR_ENABLED_KEY => "ALTER TABLE `{$table}` ADD COLUMN `" . self::AI_SUPERVISOR_ENABLED_KEY . "` TINYINT(1) NOT NULL DEFAULT 0",
            self::LOCAL_TEMPLATE_CATALOG_KEY => "ALTER TABLE `{$table}` ADD COLUMN `" . self::LOCAL_TEMPLATE_CATALOG_KEY . "` MEDIUMTEXT DEFAULT NULL",
        ];
        foreach (array_keys(self::MESSAGE_DEFAULTS) as $messageColumn) {
            $columns[$messageColumn] = "ALTER TABLE `{$table}` ADD COLUMN `{$messageColumn}` TEXT DEFAULT NULL";
        }

        foreach ($columns as $column => $sql) {
            if ($DB->fieldExists($table, $column)) {
                continue;
            }

            $result = @$DB->doQuery($sql);
            if (!$result) {
                $error = (string) $DB->error();
                if (!str_contains($error, '1060') && stripos($error, 'Duplicate column') === false) {
                    error_log("[integaglpi][config][schema] failed adding {$column}: {$error}");
                }
            }
        }

        if (!$DB->fieldExists($table, 'context')) {
            return;
        }

        @$DB->doQuery("UPDATE `{$table}` SET `context` = 'connection' WHERE `context` IS NULL OR `context` = ''");
        $this->ensureSingleContextRow(self::CONTEXT_CONNECTION);
        $this->ensureSingleContextRow(self::CONTEXT_MESSAGE);
        $this->ensureSingleContextRow(self::CONTEXT_TEMPLATES);
        $this->ensureUniqueContextIndex();
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, string>
     */
    private function messageConfigFromRow(array $row): array
    {
        $messages = [];
        foreach (self::MESSAGE_DEFAULTS as $key => $default) {
            $messages[$key] = $this->normalizeString($row[$key] ?? null) ?: $default;
        }

        return $messages;
    }

    private function ensureSingleContextRow(string $context): void
    {
        $rows = Db::fetchAll([
            'FROM' => PLUGIN_INTEGAGLPI_CONFIG_TABLE,
            'WHERE' => ['context' => $context],
        ]);
        if (count($rows) <= 1) {
            return;
        }

        usort(
            $rows,
            static fn (array $left, array $right): int => (int) ($left['id'] ?? 0) <=> (int) ($right['id'] ?? 0)
        );

        $preferred = $context === self::CONTEXT_CONNECTION
            ? $this->selectPreferredConnectionRow($rows)
            : $this->selectLowestIdRow($rows);
        $preferredId = (int) ($preferred['id'] ?? 0);

        foreach ($rows as $row) {
            $id = (int) ($row['id'] ?? 0);
            if ($id <= 0 || $id === $preferredId) {
                continue;
            }

            Db::update(
                PLUGIN_INTEGAGLPI_CONFIG_TABLE,
                ['context' => $context . '_duplicate_' . $id],
                ['id' => $id]
            );
        }
    }

    private function ensureUniqueContextIndex(): void
    {
        global $DB;

        $table = PLUGIN_INTEGAGLPI_CONFIG_TABLE;
        $result = @$DB->doQuery("SHOW INDEX FROM `{$table}` WHERE Key_name = '" . self::CONTEXT_INDEX . "'");
        if ($result && method_exists($DB, 'numrows') && $DB->numrows($result) > 0) {
            return;
        }

        $created = @$DB->doQuery(
            "ALTER TABLE `{$table}` ADD UNIQUE KEY `" . self::CONTEXT_INDEX . "` (`context`)"
        );
        if (!$created) {
            $error = (string) $DB->error();
            if (!str_contains($error, '1061') && stripos($error, 'Duplicate key name') === false) {
                error_log("[integaglpi][config][schema] failed adding unique context index: {$error}");
            }
        }
    }

    /**
     * @param list<array<string, mixed>> $templates
     */
    private function saveLocalTemplates(array $templates): void
    {
        $this->ensureConfigSchema();

        $payload = [
            'context' => self::CONTEXT_TEMPLATES,
            self::LOCAL_TEMPLATE_CATALOG_KEY => json_encode($templates, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '[]',
        ];

        $current = Db::fetchOne([
            'FROM' => PLUGIN_INTEGAGLPI_CONFIG_TABLE,
            'WHERE' => ['context' => self::CONTEXT_TEMPLATES],
        ]);
        $existingId = (int) ($current['id'] ?? 0);

        if ($existingId > 0) {
            if (!Db::update(PLUGIN_INTEGAGLPI_CONFIG_TABLE, $payload, ['id' => $existingId])) {
                throw new RuntimeException(__('Failed to update local WhatsApp templates.', 'glpiintegaglpi'));
            }
            return;
        }

        if (!Db::insert(PLUGIN_INTEGAGLPI_CONFIG_TABLE, $payload)) {
            throw new RuntimeException(__('Failed to save local WhatsApp templates.', 'glpiintegaglpi'));
        }
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return array<string, mixed>|null
     */
    private function selectPreferredConnectionRow(array $rows): ?array
    {
        if ($rows === []) {
            return null;
        }

        usort(
            $rows,
            static fn (array $left, array $right): int => (int) ($left['id'] ?? 0) <=> (int) ($right['id'] ?? 0)
        );

        foreach ($rows as $row) {
            if (
                $this->normalizeString($row['db_host'] ?? null) !== ''
                && (int) ($row['db_port'] ?? 0) > 0
                && $this->normalizeString($row['db_name'] ?? null) !== ''
                && $this->normalizeString($row['db_user'] ?? null) !== ''
            ) {
                return $row;
            }
        }

        return $rows[0];
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return array<string, mixed>|null
     */
    private function selectLowestIdRow(array $rows): ?array
    {
        if ($rows === []) {
            return null;
        }

        usort(
            $rows,
            static fn (array $left, array $right): int => (int) ($left['id'] ?? 0) <=> (int) ($right['id'] ?? 0)
        );

        return $rows[0];
    }

    private function getExternalPdo(): PDO
    {
        if (!$this->isConfigured()) {
            throw new RuntimeException(__('External PostgreSQL is not configured.', 'glpiintegaglpi'));
        }

        return ExternalDatabase::getConnection($this->getConnectionConfig());
    }

    private function externalTableExists(PDO $pdo, string $table): bool
    {
        $stmt = $pdo->prepare(
            "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = :table LIMIT 1"
        );
        $stmt->execute([':table' => $table]);

        return (bool) $stmt->fetchColumn();
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function defaultMessageCatalogRows(): array
    {
        $rows = [];
        foreach (self::MESSAGE_CATALOG_DEFAULTS as $eventKey => $definition) {
            $rows[$eventKey] = [
                'event_key' => $eventKey,
                'group_name' => $definition[0],
                'description' => $definition[1],
                'default_text' => $definition[2],
                'custom_text' => '',
                'is_active' => true,
                'send_type' => $definition[3],
                'language' => 'pt_BR',
                'fallback_text' => '',
                'template_name' => '',
                'buttons_json' => '[]',
                'list_options_json' => '[]',
                'expects_response' => (bool) $definition[4],
                'updated_at' => '',
                'updated_by' => null,
            ];
        }

        return $rows;
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return array<string, list<array<string, mixed>>>
     */
    private function groupCatalogRows(array $rows): array
    {
        usort($rows, static function (array $left, array $right): int {
            return [(string) ($left['group_name'] ?? ''), (string) ($left['event_key'] ?? '')]
                <=> [(string) ($right['group_name'] ?? ''), (string) ($right['event_key'] ?? '')];
        });

        $grouped = [];
        foreach ($rows as $row) {
            $group = $this->normalizeString($row['group_name'] ?? null) ?: __('Geral', 'glpiintegaglpi');
            $grouped[$group][] = $row;
        }

        return $grouped;
    }

    private function prettyJson(string $json): string
    {
        $decoded = json_decode($json, true);
        if (!is_array($decoded)) {
            return '[]';
        }

        return json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '[]';
    }

    private function requireKnownEventKey(mixed $value): string
    {
        $eventKey = $this->normalizeString($value);
        if ($eventKey === '' || !array_key_exists($eventKey, self::MESSAGE_CATALOG_DEFAULTS)) {
            throw new RuntimeException(__('Invalid message event key.', 'glpiintegaglpi'));
        }

        return $eventKey;
    }

    private function normalizeSendType(mixed $value): string
    {
        $sendType = $this->normalizeString($value);
        if (!in_array($sendType, self::CATALOG_SEND_TYPES, true)) {
            throw new RuntimeException(__('Invalid message send type.', 'glpiintegaglpi'));
        }

        return $sendType;
    }

    private function normalizeTemplateStatus(mixed $value): string
    {
        $status = strtolower($this->normalizeString($value));

        return in_array($status, self::LOCAL_TEMPLATE_STATUSES, true) ? $status : 'approved';
    }

    private function requireValidTemplateName(string $templateName): string
    {
        if (!preg_match('/^[A-Za-z0-9_]+$/', $templateName)) {
            throw new RuntimeException(__('Template name may contain only letters, numbers and underscore.', 'glpiintegaglpi'));
        }

        return $templateName;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function normalizeJsonList(mixed $value, string $field): array
    {
        $raw = $this->normalizeString($value);
        if ($raw === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new RuntimeException(sprintf(__('Invalid JSON in %s.', 'glpiintegaglpi'), $field));
        }

        return array_values(array_filter($decoded, static fn ($row): bool => is_array($row)));
    }

    /**
     * @return array<string, mixed>
     */
    private function normalizeTemplateMapping(mixed $value): array
    {
        if (is_array($value)) {
            $decoded = $value;
        } else {
            $raw = $this->normalizeString($value);
            if ($raw === '') {
                return [];
            }
            $decoded = json_decode($raw, true);
            if (!is_array($decoded)) {
                throw new RuntimeException(__('Invalid JSON in template variables mapping.', 'glpiintegaglpi'));
            }
        }

        $mapping = [];
        foreach ($decoded as $key => $placeholder) {
            $normalizedKey = $this->normalizeString($key);
            $normalizedPlaceholder = $this->normalizeString($placeholder);
            if ($normalizedKey === '' || $normalizedPlaceholder === '') {
                continue;
            }
            if (!in_array($normalizedPlaceholder, self::MESSAGE_PLACEHOLDER_KEYS, true)) {
                throw new RuntimeException(sprintf(
                    __('Unknown placeholder in template variables mapping: %s.', 'glpiintegaglpi'),
                    $normalizedPlaceholder
                ));
            }
            $mapping[$normalizedKey] = $normalizedPlaceholder;
        }

        return $mapping;
    }

    private function validateAllowedPlaceholders(string $text, string $field): void
    {
        if ($text === '') {
            return;
        }

        preg_match_all('/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/', $text, $matches);
        $validTokens = $matches[0] ?? [];
        $placeholders = $matches[1] ?? [];
        $invalid = array_values(array_unique(array_filter(
            $placeholders,
            static fn (string $placeholder): bool => !in_array($placeholder, self::MESSAGE_PLACEHOLDER_KEYS, true)
        )));

        $remainder = $text;
        foreach ($validTokens as $token) {
            $remainder = str_replace($token, '', $remainder);
        }

        if (str_contains($remainder, '{{') || str_contains($remainder, '}}')) {
            throw new RuntimeException(sprintf(__('Malformed placeholder in %s.', 'glpiintegaglpi'), $field));
        }

        if ($invalid !== []) {
            throw new RuntimeException(sprintf(
                __('Unknown placeholder in %s: %s.', 'glpiintegaglpi'),
                $field,
                implode(', ', $invalid)
            ));
        }
    }

    /**
     * @param array<string, mixed> $variablesMapping
     */
    private function validateTemplateBodyPlaceholders(string $text, array $variablesMapping): void
    {
        if ($text === '') {
            return;
        }

        preg_match_all('/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/', $text, $matches);
        $validTokens = $matches[0] ?? [];
        $placeholders = $matches[1] ?? [];
        $invalid = [];
        foreach ($placeholders as $placeholder) {
            if (ctype_digit($placeholder)) {
                if (!isset($variablesMapping[$placeholder])) {
                    $invalid[] = $placeholder;
                }
                continue;
            }
            if (!in_array($placeholder, self::MESSAGE_PLACEHOLDER_KEYS, true)) {
                $invalid[] = $placeholder;
            }
        }

        $remainder = $text;
        foreach ($validTokens as $token) {
            $remainder = str_replace($token, '', $remainder);
        }

        if (str_contains($remainder, '{{') || str_contains($remainder, '}}')) {
            throw new RuntimeException(__('Malformed placeholder in template_body.', 'glpiintegaglpi'));
        }

        $invalid = array_values(array_unique($invalid));
        if ($invalid !== []) {
            throw new RuntimeException(sprintf(
                __('Template body has unmapped or unknown placeholders: %s.', 'glpiintegaglpi'),
                implode(', ', $invalid)
            ));
        }
    }

    private function renderPreviewPlaceholders(string $text): string
    {
        return (string) preg_replace_callback(
            '/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/',
            static function (array $matches): string {
                $key = (string) ($matches[1] ?? '');

                return self::MESSAGE_PLACEHOLDER_PREVIEW_VALUES[$key] ?? (string) $matches[0];
            },
            $text
        );
    }

    /**
     * @param array<string, mixed> $variablesMapping
     */
    private function renderTemplatePreviewPlaceholders(string $text, array $variablesMapping): string
    {
        return (string) preg_replace_callback(
            '/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/',
            static function (array $matches) use ($variablesMapping): string {
                $key = (string) ($matches[1] ?? '');
                if (ctype_digit($key)) {
                    $mappedPlaceholder = (string) ($variablesMapping[$key] ?? '');

                    return self::MESSAGE_PLACEHOLDER_PREVIEW_VALUES[$mappedPlaceholder] ?? (string) $matches[0];
                }

                return self::MESSAGE_PLACEHOLDER_PREVIEW_VALUES[$key] ?? (string) $matches[0];
            },
            $text
        );
    }

    private function fetchCatalogRow(PDO $pdo, string $eventKey): ?array
    {
        $stmt = $pdo->prepare(
            "SELECT event_key, custom_text, is_active, send_type, language, fallback_text, template_name, buttons_json::text AS buttons_json, list_options_json::text AS list_options_json, expects_response
             FROM glpi_plugin_integaglpi_message_catalog
             WHERE event_key = :event_key
             LIMIT 1"
        );
        $stmt->execute([':event_key' => $eventKey]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return is_array($row) ? $row : null;
    }

    private function insertCatalogAudit(PDO $pdo, string $eventKey, string $action, ?array $old, array $new, int $userId): void
    {
        if (!$this->externalTableExists($pdo, 'glpi_plugin_integaglpi_message_catalog_audit')) {
            return;
        }

        $stmt = $pdo->prepare(
            "INSERT INTO glpi_plugin_integaglpi_message_catalog_audit
              (event_key, action, old_value, new_value, changed_by)
             VALUES
              (:event_key, :action, CAST(:old_value AS jsonb), CAST(:new_value AS jsonb), :changed_by)"
        );
        $stmt->execute([
            ':event_key' => $eventKey,
            ':action' => $action,
            ':old_value' => $old === null ? null : json_encode($old, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ':new_value' => json_encode($this->sanitizeCatalogAuditPayload($new), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ':changed_by' => $userId > 0 ? $userId : null,
        ]);
    }

    private function insertLocalTemplateAudit(string $action, ?array $old, array $new, int $userId): void
    {
        try {
            $name = $this->normalizeString($new['name'] ?? ($old['name'] ?? 'template'));
            $eventKey = 'template:' . ($name !== '' ? $name : 'local');
            $pdo = $this->getExternalPdo();
            $this->insertCatalogAudit($pdo, $eventKey, $action, $old, $new, $userId);
        } catch (\Throwable $exception) {
            error_log('[integaglpi][local_template][audit] ' . $exception->getMessage());
        }
    }

    /**
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    private function sanitizeCatalogAuditPayload(array $payload): array
    {
        unset($payload['buttons_json']);
        unset($payload['list_options_json']);

        return $payload;
    }

    private function nullableString(mixed $value): ?string
    {
        $normalized = $this->normalizeString($value);

        return $normalized === '' ? null : $normalized;
    }

    private function requireTime(mixed $value, string $field): string
    {
        $time = $this->normalizeString($value);
        if (!preg_match('/^([01]\d|2[0-3]):([0-5]\d)$/', $time)) {
            throw new RuntimeException(sprintf(__('Invalid time in %s.', 'glpiintegaglpi'), $field));
        }

        return $time;
    }

    /**
     * @return array{0: string, 1: string}
     */
    private function requireTimeRange(mixed $startValue, mixed $endValue, string $label): array
    {
        $start = $this->requireTime($startValue, $label . ' start_time');
        $end = $this->requireTime($endValue, $label . ' end_time');
        if ($start >= $end) {
            throw new RuntimeException(sprintf(
                __('Invalid business hours for %s: end time must be after start time.', 'glpiintegaglpi'),
                $label
            ));
        }

        return [$start, $end];
    }

    /**
     * @return array{0: string|null, 1: string|null}
     */
    private function optionalTimeRange(bool $enabled, mixed $startValue, mixed $endValue, string $label): array
    {
        if (!$enabled) {
            return [null, null];
        }

        return $this->requireTimeRange($startValue, $endValue, $label);
    }

    private function nullableTime(mixed $value): ?string
    {
        $time = $this->normalizeString($value);
        if ($time === '') {
            return null;
        }

        return $this->requireTime($time, 'time');
    }

    private function normalizeBool(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if ($value === null) {
            return false;
        }

        $normalized = strtolower($this->normalizeString($value));
        if ($normalized === '') {
            return false;
        }

        if (in_array($normalized, ['1', 'true', 'on', 'yes'], true)) {
            return true;
        }

        if (in_array($normalized, ['0', 'false', 'off', 'no'], true)) {
            return false;
        }

        return false;
    }

    /**
     * @param array<string, mixed> $params
     * @param array<string, mixed> $payload
     */
    private function bindBusinessHoursParams(\PDOStatement $stmt, array $params, array $payload): void
    {
        $stmt->bindValue(':business_hours_enabled', (bool) $payload['business_hours_enabled'], PDO::PARAM_BOOL);
        $stmt->bindValue(':saturday_enabled', (bool) $payload['saturday_enabled'], PDO::PARAM_BOOL);
        $stmt->bindValue(':sunday_enabled', (bool) $payload['sunday_enabled'], PDO::PARAM_BOOL);
        foreach ($params as $key => $value) {
            if ($key === ':cooldown_minutes') {
                $stmt->bindValue($key, (int) $value, PDO::PARAM_INT);
                continue;
            }

            if ($key === ':updated_by' && $value === null) {
                $stmt->bindValue($key, null, PDO::PARAM_NULL);
                continue;
            }

            if (in_array($key, [':saturday_start_time', ':saturday_end_time', ':sunday_start_time', ':sunday_end_time'], true) && $value === null) {
                $stmt->bindValue($key, null, PDO::PARAM_NULL);
                continue;
            }

            $stmt->bindValue($key, $value);
        }
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function bindMessageCatalogParams(\PDOStatement $stmt, array $payload): void
    {
        $stmt->bindValue(':event_key', (string) $payload['event_key'], PDO::PARAM_STR);
        $stmt->bindValue(':description', (string) $payload['description'], PDO::PARAM_STR);
        $stmt->bindValue(':group_name', (string) $payload['group_name'], PDO::PARAM_STR);
        $stmt->bindValue(':default_text', (string) $payload['default_text'], PDO::PARAM_STR);
        $this->bindNullableString($stmt, ':custom_text', $payload['custom_text']);
        $stmt->bindValue(':is_active', (bool) $payload['is_active'], PDO::PARAM_BOOL);
        $stmt->bindValue(':send_type', (string) $payload['send_type'], PDO::PARAM_STR);
        $stmt->bindValue(':language', (string) $payload['language'], PDO::PARAM_STR);
        $this->bindNullableString($stmt, ':fallback_text', $payload['fallback_text']);
        $this->bindNullableString($stmt, ':template_name', $payload['template_name']);
        $stmt->bindValue(':buttons_json', (string) $payload['buttons_json'], PDO::PARAM_STR);
        $stmt->bindValue(':list_options_json', (string) $payload['list_options_json'], PDO::PARAM_STR);
        $stmt->bindValue(':expects_response', (bool) $payload['expects_response'], PDO::PARAM_BOOL);

        if ($payload['updated_by'] === null) {
            $stmt->bindValue(':updated_by', null, PDO::PARAM_NULL);
            return;
        }

        $stmt->bindValue(':updated_by', (int) $payload['updated_by'], PDO::PARAM_INT);
    }

    private function bindNullableString(\PDOStatement $stmt, string $name, mixed $value): void
    {
        if ($value === null) {
            $stmt->bindValue($name, null, PDO::PARAM_NULL);
            return;
        }

        $stmt->bindValue($name, (string) $value, PDO::PARAM_STR);
    }

    private function normalizeString(mixed $value): string
    {
        return trim((string) $value);
    }

    private function isTruthy(string $value): bool
    {
        return in_array(strtolower(trim($value)), ['1', 'true', 'yes', 'on'], true);
    }

    private function normalizeUrl(mixed $value): string
    {
        return rtrim($this->normalizeString($value), "/ \t\n\r\0\x0B");
    }

    private function requireIntegrationServiceUrl(mixed $value): string
    {
        $url = $this->normalizeUrl($value);

        if ($url === '') {
            return self::DEFAULT_INTEGRATION_SERVICE_URL;
        }

        $parts = parse_url($url);
        if (
            !is_array($parts)
            || !in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)
            || trim((string) ($parts['host'] ?? '')) === ''
        ) {
            throw new RuntimeException(__('Integration-service URL must be a valid http(s) URL.', 'glpiintegaglpi'));
        }

        return $url;
    }

    private function messageOrDefault(mixed $value, string $key): string
    {
        $message = $this->normalizeString($value);

        return $message !== '' ? $message : self::MESSAGE_DEFAULTS[$key];
    }

    private function requireNonEmptyString(mixed $value, string $message): string
    {
        $normalized = $this->normalizeString($value);

        if ($normalized === '') {
            throw new RuntimeException($message);
        }

        return $normalized;
    }

    private function requirePositiveInteger(mixed $value, string $message): int
    {
        $port = (int) $value;

        if ($port <= 0) {
            throw new RuntimeException($message);
        }

        return $port;
    }

    private function positiveIntegerOrDefault(mixed $value, int $default): int
    {
        $integer = (int) $value;

        return $integer > 0 ? $integer : $default;
    }

    private function requirePositiveTimer(mixed $value, string $field): int
    {
        $integer = (int) $value;
        if ($integer < 1 || $integer > 10080) {
            throw new RuntimeException(sprintf(__('Timer inválido em %s. Use um inteiro positivo de até 10080 minutos.', 'glpiintegaglpi'), $field));
        }

        return $integer;
    }

    private function normalizeSslMode(mixed $value): string
    {
        $sslMode = $this->normalizeString($value);
        $allowed = ['disable', 'prefer', 'require'];

        if (!in_array($sslMode, $allowed, true)) {
            return 'prefer';
        }

        return $sslMode;
    }
}
