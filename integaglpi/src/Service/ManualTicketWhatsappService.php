<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\Plugin;
use RuntimeException;
use Throwable;

final class ManualTicketWhatsappService
{
    private const TEMPLATE_NAME = 'aviso_atendimento_fora_janela';

    public function __construct(
        private readonly ?IntegrationServiceClient $client = null,
        private readonly ?PluginConfigService $pluginConfigService = null
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function getViewData(\Ticket $ticket): array
    {
        $ticketId = (int) $ticket->getID();
        $requester = $this->getRequesterData($ticketId);
        $template = $this->findStartTemplate();
        $base = [
            'ticket_id' => $ticketId,
            'requester' => $requester,
            'template' => $template,
            'candidates' => [],
            'error' => null,
        ];

        if ($ticketId <= 0 || !$this->getPluginConfigService()->isConfigured()) {
            return $base;
        }

        try {
            $response = $this->getClient()->resolveManualTicketWhatsapp($ticketId, [
                'requester_name' => $requester['name'],
                'requester_email' => $requester['email'],
                'requester_phones' => array_values(array_map(
                    static fn (array $phone): string => (string) ($phone['phone_e164'] ?? ''),
                    $requester['phones']
                )),
            ]);
            if (!$response['success']) {
                return $base + [
                    'error' => (string) ($response['body']['message'] ?? __('Não foi possível resolver contatos WhatsApp.', 'glpiintegaglpi')),
                ];
            }

            return [
                ...$base,
                'candidates' => is_array($response['body']['candidates'] ?? null) ? $response['body']['candidates'] : [],
            ];
        } catch (Throwable $exception) {
            error_log('[integaglpi][manual_ticket_whatsapp][view_error] ticket_id=' . $ticketId . ' ' . $exception->getMessage());

            return $base + [
                'error' => __('Não foi possível preparar o vínculo WhatsApp agora.', 'glpiintegaglpi'),
            ];
        }
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function startTemplate(\Ticket $ticket, array $input, int $userId): array
    {
        $ticketId = (int) $ticket->getID();
        if ($ticketId <= 0) {
            throw new RuntimeException(__('Ticket inválido.', 'glpiintegaglpi'));
        }

        $phone = $this->normalizeE164((string) ($input['manual_phone_e164'] ?? ''));
        if ($phone === '') {
            $phone = $this->normalizeE164((string) ($input['candidate_phone_e164'] ?? ''));
        }
        if ($phone === '') {
            throw new RuntimeException(__('Selecione ou informe um telefone válido em E.164.', 'glpiintegaglpi'));
        }

        $template = $this->findStartTemplate();
        if ($template === null) {
            throw new RuntimeException(__('Template aprovado aviso_atendimento_fora_janela não está ativo.', 'glpiintegaglpi'));
        }
        if (empty($input['manual_confirmation']) || empty($input['cost_acknowledged'])) {
            throw new RuntimeException(__('Confirme a ação e a ciência de custo antes de enviar o template.', 'glpiintegaglpi'));
        }

        $requester = $this->getRequesterData($ticketId);
        $idempotencyKey = 'manual_ticket_template:' . $ticketId . ':' . sha1($phone . '|' . $userId . '|' . self::TEMPLATE_NAME);
        $response = $this->getClient()->startManualTicketWhatsappTemplate($ticketId, [
            'phone_e164' => $phone,
            'glpi_user_id' => $userId,
            'requester_name' => $requester['name'] !== '' ? $requester['name'] : __('Cliente', 'glpiintegaglpi'),
            'requester_email' => $requester['email'],
            'requester_phones' => array_values(array_map(
                static fn (array $item): string => (string) ($item['phone_e164'] ?? ''),
                $requester['phones']
            )),
            'template_name' => (string) $template['name'],
            'language' => (string) $template['language'],
            'template_approved' => (string) ($template['status'] ?? '') === 'approved',
            'template_active' => !empty($template['is_active']),
            'manual_confirmation' => true,
            'cost_acknowledged' => true,
            'idempotency_key' => $idempotencyKey,
        ]);

        if (!$response['success']) {
            throw new RuntimeException((string) ($response['body']['message'] ?? __('Falha ao iniciar atendimento WhatsApp.', 'glpiintegaglpi')));
        }

        return $response['body'];
    }

    /**
     * @return array{name: string, email: string, phones: list<array{source: string, label: string, phone_e164: string, masked_phone: string}>}
     */
    private function getRequesterData(int $ticketId): array
    {
        global $DB;

        $userIds = [];
        $requesterType = defined('CommonITILActor::REQUESTER') ? (int) constant('CommonITILActor::REQUESTER') : 1;
        foreach ($DB->request([
            'SELECT' => ['users_id'],
            'FROM' => 'glpi_tickets_users',
            'WHERE' => [
                'tickets_id' => $ticketId,
                'type' => $requesterType,
            ],
        ]) as $row) {
            $userId = (int) ($row['users_id'] ?? 0);
            if ($userId > 0) {
                $userIds[] = $userId;
            }
        }

        $name = '';
        $email = '';
        $phones = [];
        foreach (array_unique($userIds) as $userId) {
            $user = new \User();
            if (!$user->getFromDB($userId)) {
                continue;
            }
            if ($name === '') {
                $name = trim((string) getUserName($userId));
            }
            if ($email === '') {
                $email = $this->getUserEmail($userId);
            }
            foreach (['mobile', 'phone', 'phone2'] as $field) {
                $candidate = $this->normalizeE164((string) ($user->fields[$field] ?? ''));
                if ($candidate === '') {
                    continue;
                }
                $phones[$candidate] = [
                    'source' => 'glpi_requester',
                    'label' => (string) getUserName($userId),
                    'phone_e164' => $candidate,
                    'masked_phone' => $this->maskPhone($candidate),
                ];
            }
        }

        return [
            'name' => $name,
            'email' => $email,
            'phones' => array_values($phones),
        ];
    }

    private function getUserEmail(int $userId): string
    {
        global $DB;

        foreach ($DB->request([
            'SELECT' => ['email'],
            'FROM' => 'glpi_useremails',
            'WHERE' => ['users_id' => $userId],
            'ORDER' => 'is_default DESC, id ASC',
            'LIMIT' => 1,
        ]) as $row) {
            return trim((string) ($row['email'] ?? ''));
        }

        return '';
    }

    private function normalizeE164(string $raw): string
    {
        $raw = trim($raw);
        if ($raw === '') {
            return '';
        }
        if (preg_match('/^\+[1-9]\d{1,14}$/', $raw) === 1) {
            return $raw;
        }
        $digits = preg_replace('/\D+/', '', $raw) ?? '';
        if ($digits === '') {
            return '';
        }
        if (str_starts_with($digits, '55') && strlen($digits) >= 12 && strlen($digits) <= 13) {
            $candidate = '+' . $digits;
        } elseif (strlen($digits) >= 10 && strlen($digits) <= 11) {
            $candidate = '+55' . $digits;
        } else {
            return '';
        }

        return preg_match('/^\+[1-9]\d{1,14}$/', $candidate) === 1 ? $candidate : '';
    }

    private function maskPhone(string $phone): string
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        if (strlen($digits) < 8) {
            return '******';
        }

        return '+' . substr($digits, 0, 2) . '******' . substr($digits, -4);
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findStartTemplate(): ?array
    {
        foreach ($this->getPluginConfigService()->getActiveLocalTemplates() as $template) {
            if (
                (string) ($template['name'] ?? '') === self::TEMPLATE_NAME
                && (string) ($template['status'] ?? '') === 'approved'
            ) {
                return $template;
            }
        }

        return null;
    }

    private function getClient(): IntegrationServiceClient
    {
        return $this->client ?? new IntegrationServiceClient($this->getPluginConfigService());
    }

    private function getPluginConfigService(): PluginConfigService
    {
        return $this->pluginConfigService ?? new PluginConfigService();
    }
}
