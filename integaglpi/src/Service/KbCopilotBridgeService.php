<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

/**
 * KbCopilotBridgeService — PHP-side adapter that calls the Node KB RAG copilot.
 *
 * Node service owns the PostgreSQL `kb_candidates` search and Ollama integration.
 * PHP NEVER touches the integration-service DB directly.
 * Node NEVER touches GLPI MariaDB directly.
 *
 * This bridge is read-only (GET-equivalent POST, no mutations).
 * Response is never sent to the customer automatically.
 * Cloud AI is blocked by the Node side (local Ollama only).
 *
 * Phase: integaglpi_local_kb_rag_technician_copilot_001
 */
final class KbCopilotBridgeService
{
    private const KB_RAG_ENDPOINT = '/internal/glpi/ai/kb-rag';
    private const TIMEOUT_SECONDS = 12;
    private const MAX_QUERY_LENGTH = 800;

    private PluginConfigService $configService;

    public function __construct(?PluginConfigService $configService = null)
    {
        $this->configService = $configService ?? new PluginConfigService();
    }

    /**
     * Call the Node RAG endpoint and return the parsed playbook.
     *
     * @param string           $query         Free text from the technician or ticket description.
     * @param int|null         $ticketId      Context ticket (for audit, never mutated).
     * @param int|null         $technicianId  GLPI user id (for de-dup only, never ranked).
     * @param int              $topK          Max KB articles to retrieve (3–5).
     * @param array<string,mixed>|null $clientContext Optional context for ranking boost.
     *   Keys accepted by Node: entityId (int), clientName (string), productOrSystem (string), category (string).
     *   Never used as hard filter — ranking only.
     * @return array<string, mixed>           Parsed JSON response from Node or an error structure.
     */
    public function fetchPlaybook(
        string $query,
        ?int $ticketId = null,
        ?int $technicianId = null,
        int $topK = 5,
        ?array $clientContext = null
    ): array {
        $cleanQuery = mb_substr(trim($query), 0, self::MAX_QUERY_LENGTH, 'UTF-8');
        if ($cleanQuery === '') {
            return $this->errorResponse('Consulta vazia.');
        }

        $nodeUrl  = rtrim($this->configService->getIntegrationServiceUrl(), '/');
        $endpoint = $nodeUrl . self::KB_RAG_ENDPOINT;
        $authKey  = $this->configService->getIntegrationAuthKey();

        if ($authKey === '') {
            return $this->errorResponse('Chave de integração não configurada.');
        }

        $payloadData = [
            'query'         => $cleanQuery,
            'ticketId'      => $ticketId,
            'technicianId'  => $technicianId,
            'topK'          => max(3, min(5, $topK)),
        ];

        // Include clientContext only when provided and non-empty (ranking boost, never hard filter)
        if ($clientContext !== null && count($clientContext) > 0) {
            $safeCtx = [];
            if (isset($clientContext['entityId']) && is_int($clientContext['entityId'])) {
                $safeCtx['entityId'] = $clientContext['entityId'];
            }
            if (isset($clientContext['clientName']) && is_string($clientContext['clientName'])) {
                $safeCtx['clientName'] = mb_substr((string) $clientContext['clientName'], 0, 120, 'UTF-8');
            }
            if (isset($clientContext['productOrSystem']) && is_string($clientContext['productOrSystem'])) {
                $safeCtx['productOrSystem'] = mb_substr((string) $clientContext['productOrSystem'], 0, 120, 'UTF-8');
            }
            if (isset($clientContext['category']) && is_string($clientContext['category'])) {
                $safeCtx['category'] = mb_substr((string) $clientContext['category'], 0, 120, 'UTF-8');
            }
            if (count($safeCtx) > 0) {
                $payloadData['clientContext'] = $safeCtx;
            }
        }

        $payload = json_encode($payloadData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if ($payload === false) {
            return $this->errorResponse('Falha ao serializar payload.');
        }

        $ctx = stream_context_create([
            'http' => [
                'method'        => 'POST',
                'header'        => implode("\r\n", [
                    'Content-Type: application/json; charset=UTF-8',
                    'Accept: application/json',
                    'Authorization: Bearer ' . $authKey,
                    'X-Integaglpi-Key: ' . $authKey,
                    'Connection: close',
                ]),
                'content'       => $payload,
                'timeout'       => self::TIMEOUT_SECONDS,
                'ignore_errors' => true,
            ],
        ]);

        $raw = @file_get_contents($endpoint, false, $ctx);
        if ($raw === false || $raw === '') {
            return $this->errorResponse('Node KB RAG indisponível.');
        }

        $data = json_decode($raw, true);
        if (!is_array($data)) {
            return $this->errorResponse('Resposta inválida do Node.');
        }

        return $data;
    }

    /**
     * @return array{ok: false, message: string, playbook: null}
     */
    private function errorResponse(string $message): array
    {
        return [
            'ok'      => false,
            'message' => $message,
            'playbook' => null,
        ];
    }
}
