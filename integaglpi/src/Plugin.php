<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use GlpiPlugin\Integaglpi\Service\PluginConfigService;
use Html;
use Session;

final class Plugin
{
    public const RIGHT_NAME = 'plugin_integaglpi';
    public const EXTERNAL_RESEARCH_RIGHT_NAME = 'plugin_integaglpi_external_research';
    private const LEGACY_RIGHT_NAMES = ['PluginIntegaglpi', 'PluginWhatsapp'];

    /**
     * Holds the CSRF token generated for the current request.
     * Ensures a single call to Session::getNewCSRFToken() per request,
     * regardless of how many forms call renderCsrfToken().
     * Multiple calls to getNewCSRFToken() on the same page overwrite
     * $_SESSION['valid_id'], making earlier tokens invalid.
     */
    private static ?string $requestCsrfToken = null;

    public static function getName(): string
    {
        return 'GLPI WhatsApp';
    }

    public static function getWebBasePath(): string
    {
        global $CFG_GLPI;

        return rtrim($CFG_GLPI['root_doc'] ?? '', '/') . '/plugins/' . PLUGIN_INTEGAGLPI_NAME;
    }

    public static function canRead(): bool
    {
        return true;
    }

    public static function canUpdate(): bool
    {
        return true;
    }

    public static function requireRead(): void
    {
        if (self::canRead()) {
            return;
        }

        // Prefer canonical right for the error display.
        Session::checkRight(self::RIGHT_NAME, READ);
    }

    public static function requireUpdate(): void
    {
        if (self::canUpdate()) {
            return;
        }

        Session::checkRight(self::RIGHT_NAME, UPDATE);
    }

    /**
     * GLPI 11 expects the POST payload (array) containing `_glpi_csrf_token`.
     *
     * @param array<string, mixed>|null $data
     */
    public static function requireCsrf(?array $data = null): void
    {
        Session::checkCSRF($data ?? $_POST);
    }

    /**
     * Validate plugin forms without letting GLPI render a fatal error page.
     *
     * GLPI 11 runs its own CSRF middleware on POST requests. When the token is
     * valid, the middleware consumes it from $_SESSION['glpicsrftokens'] (one-time
     * use) and lets the request through to our handler. When invalid, the
     * middleware short-circuits with a 403 "Acesso negado" page — our code never
     * runs. Therefore: if execution reaches this method with a non-empty token,
     * upstream validation has already passed, and an in-session match is no
     * longer required (and would in fact fail because the token was consumed).
     *
     * The in-session check is kept as a fast-path for environments where the
     * upstream middleware is bypassed (e.g. via `csrf_compliant`); in that case
     * the token is still present in the session and we validate it ourselves.
     *
     * @param array<string, mixed>|null $data
     */
    public static function isCsrfValid(?array $data = null): bool
    {
        $payload = $data ?? $_POST;
        $postedToken = trim((string) ($payload['_glpi_csrf_token'] ?? ''));

        if ($postedToken === '') {
            return false;
        }

        foreach (self::getSessionCsrfTokens() as $sessionToken) {
            if (hash_equals($sessionToken, $postedToken)) {
                return true;
            }
        }

        // Token absent from session but request reached this code: GLPI's CSRF
        // middleware validated and consumed the token before us. Trust upstream.
        error_log(sprintf(
            '[integaglpi][csrf] posted token not in session (presumed consumed by GLPI middleware) posted=%s',
            substr($postedToken, 0, 8) . '…'
        ));
        return true;
    }

    public static function getCurrentUserId(): int
    {
        return (int) Session::getLoginUserID();
    }

    public static function getTicketActionUrl(): string
    {
        return self::getWebBasePath() . '/front/ticket.whatsapp.action.php';
    }

    public static function getManualTicketWhatsappUrl(): string
    {
        return self::getWebBasePath() . '/front/ticket.whatsapp.manual.php';
    }

    public static function getQueueAdminUrl(): string
    {
        return self::getWebBasePath() . '/front/config.form.php';
    }

    public static function getRoutingOptionsAdminUrl(): string
    {
        return self::getWebBasePath() . '/front/routing.options.form.php';
    }

    public static function getAuditUrl(): string
    {
        return self::getWebBasePath() . '/front/audit.php';
    }

    public static function getOperationLogUrl(): string
    {
        return self::getAuditUrl();
    }

    public static function getRoutingSafetyUrl(): string
    {
        return self::getWebBasePath() . '/front/routing.safety.php';
    }

    public static function getSupervisorBackofficeUrl(): string
    {
        return self::getWebBasePath() . '/front/supervisor.php';
    }

    public static function getOnlineMonitorUrl(): string
    {
        return self::getWebBasePath() . '/front/online.monitor.php';
    }

    public static function getQualityDashboardUrl(): string
    {
        return self::getWebBasePath() . '/front/quality.dashboard.php';
    }

    public static function getCoachingUrl(): string
    {
        return self::getWebBasePath() . '/front/coaching.php';
    }

    public static function getExternalResearchUrl(): string
    {
        return self::getWebBasePath() . '/front/external.research.php';
    }

    public static function getAiOperationsUrl(): string
    {
        return self::getWebBasePath() . '/front/ai.operations.php';
    }

    public static function getAiConfigUrl(): string
    {
        return self::getWebBasePath() . '/front/ai.config.php';
    }

    public static function getHistoricalMiningUrl(): string
    {
        return self::getWebBasePath() . '/front/historical.mining.php';
    }

    public static function getAiPilotUrl(): string
    {
        return self::getWebBasePath() . '/front/ai.pilot.php';
    }

    public static function getContactAgendaImportUrl(): string
    {
        return self::getWebBasePath() . '/front/contact.agenda.import.php';
    }

    public static function getOperationalDiagnosticsUrl(): string
    {
        return self::getWebBasePath() . '/front/operational.diagnostics.php';
    }

    public static function getObservabilityUrl(): string
    {
        return self::getWebBasePath() . '/front/observability.php';
    }

    public static function getContractHoursUrl(): string
    {
        return self::getWebBasePath() . '/front/contracts.hours.php';
    }

    public static function getLogmeinReportsUrl(): string
    {
        return self::getWebBasePath() . '/front/logmein.reports.php';
    }

    public static function getServiceCatalogUrl(): string
    {
        return self::getWebBasePath() . '/front/service.catalog.php';
    }

    public static function getKnowledgeBaseUrl(): string
    {
        return self::getWebBasePath() . '/front/kb.php';
    }

    public static function getNativeKnowledgeBaseUrl(): string
    {
        return self::getWebBasePath() . '/front/kb.native.php';
    }

    public static function getKbCandidatesUrl(): string
    {
        return self::getWebBasePath() . '/front/kb.candidates.php';
    }

    public static function getAiQualityUrl(): string
    {
        return self::getWebBasePath() . '/front/ai.quality.php';
    }

    public static function getTicketUrl(int $ticketId): string
    {
        global $CFG_GLPI;

        return rtrim($CFG_GLPI['root_doc'] ?? '', '/') . '/front/ticket.form.php?' . http_build_query([
            'id' => max(0, $ticketId),
        ]);
    }

    public static function canAuditRead(): bool
    {
        return self::canRead()
            && (
                self::hasRightBool('config', READ)
                || self::hasRightBool('profile', READ)
                || self::canUpdate()
            );
    }

    public static function canSupervisorRead(): bool
    {
        return self::hasRightBool(self::RIGHT_NAME, READ)
            && (
                self::hasRightBool(self::RIGHT_NAME, UPDATE)
                || self::hasRightBool('config', READ)
                || self::hasRightBool('profile', READ)
            );
    }

    public static function requireSupervisorRead(): void
    {
        Session::checkRight(self::RIGHT_NAME, READ);

        if (self::canSupervisorRead()) {
            return;
        }

        Session::checkRight('config', READ);
    }

    public static function canOnlineMonitorRead(): bool
    {
        return self::hasRightBool(self::RIGHT_NAME, READ);
    }

    public static function requireOnlineMonitorRead(): void
    {
        Session::checkRight(self::RIGHT_NAME, READ);
    }

    public static function canOnlineMonitorSupervisorRead(): bool
    {
        return self::canSupervisorRead();
    }

    public static function canQualityDashboardRead(): bool
    {
        return self::canSupervisorRead();
    }

    public static function requireQualityDashboardRead(): void
    {
        self::requireSupervisorRead();
    }

    public static function canCoachingRead(): bool
    {
        return self::canSupervisorRead();
    }

    public static function requireCoachingRead(): void
    {
        self::requireSupervisorRead();
    }

    public static function canExternalResearchRead(): bool
    {
        return self::hasRightBool(self::EXTERNAL_RESEARCH_RIGHT_NAME, READ)
            || self::canSupervisorRead();
    }

    public static function requireExternalResearchRead(): void
    {
        if (self::canExternalResearchRead()) {
            return;
        }

        Session::checkRight(self::EXTERNAL_RESEARCH_RIGHT_NAME, READ);
    }

    public static function canAiPilotRead(): bool
    {
        return self::canSupervisorRead();
    }

    public static function requireAiPilotRead(): void
    {
        self::requireSupervisorRead();
    }

    public static function canAiOperationsRead(): bool
    {
        return self::canSupervisorRead();
    }

    public static function requireAiOperationsRead(): void
    {
        self::requireSupervisorRead();
    }

    public static function canOperationalDiagnosticsRead(): bool
    {
        return self::canSupervisorRead();
    }

    public static function requireOperationalDiagnosticsRead(): void
    {
        self::requireSupervisorRead();
    }

    public static function canObservabilityRead(): bool
    {
        return self::canSupervisorRead();
    }

    public static function requireObservabilityRead(): void
    {
        self::requireSupervisorRead();
    }

    public static function canContractRead(): bool
    {
        return self::hasRightBool(self::RIGHT_NAME, READ);
    }

    public static function requireContractRead(): void
    {
        Session::checkRight(self::RIGHT_NAME, READ);
    }

    public static function canContractUpdate(): bool
    {
        return self::hasRightBool(self::RIGHT_NAME, UPDATE);
    }

    public static function isAiSupervisorEnabled(): bool
    {
        $value = strtolower(self::getRuntimeConfigValue('AI_SUPERVISOR_ENABLED'));
        if ($value !== '') {
            return in_array($value, ['1', 'true', 'yes', 'on'], true);
        }

        try {
            return (new PluginConfigService())->isAiSupervisorEnabled();
        } catch (\Throwable $exception) {
            error_log('[integaglpi][ai_quality][config] failed reading persisted flag: ' . $exception->getMessage());
            return false;
        }
    }

    public static function getRuntimeConfigValue(string $key): string
    {
        $key = trim($key);
        if ($key === '') {
            return '';
        }

        $envValue = getenv($key);
        if (is_string($envValue) && trim($envValue) !== '') {
            return trim($envValue);
        }

        if (defined($key)) {
            return trim((string) constant($key));
        }

        $lowerKey = strtolower($key);
        $configSources = [
            $GLOBALS['CFG_GLPI']['plugin_integaglpi'] ?? null,
            $GLOBALS['CFG_GLPI']['integaglpi'] ?? null,
            $GLOBALS['PLUGIN_INTEGAGLPI_CONFIG'] ?? null,
        ];

        foreach ($configSources as $source) {
            if (!is_array($source)) {
                continue;
            }

            foreach ([$key, $lowerKey] as $candidateKey) {
                if (!array_key_exists($candidateKey, $source)) {
                    continue;
                }

                $value = trim((string) $source[$candidateKey]);
                if ($value !== '') {
                    return $value;
                }
            }
        }

        return '';
    }

    public static function requireContractUpdate(): void
    {
        Session::checkRight(self::RIGHT_NAME, UPDATE);
    }

    public static function canServiceCatalogRead(): bool
    {
        return self::hasRightBool(self::RIGHT_NAME, READ);
    }

    public static function requireServiceCatalogRead(): void
    {
        Session::checkRight(self::RIGHT_NAME, READ);
    }

    public static function canServiceCatalogUpdate(): bool
    {
        return self::hasRightBool(self::RIGHT_NAME, UPDATE);
    }

    public static function requireServiceCatalogUpdate(): void
    {
        Session::checkRight(self::RIGHT_NAME, UPDATE);
    }

    public static function canKnowledgeBaseRead(): bool
    {
        return self::hasRightBool(self::RIGHT_NAME, READ);
    }

    public static function requireKnowledgeBaseRead(): void
    {
        Session::checkRight(self::RIGHT_NAME, READ);
    }

    public static function canKnowledgeBaseUpdate(): bool
    {
        return self::hasRightBool(self::RIGHT_NAME, UPDATE);
    }

    public static function requireKnowledgeBaseUpdate(): void
    {
        Session::checkRight(self::RIGHT_NAME, UPDATE);
    }

    public static function requireAuditRead(): void
    {
        self::requireRead();

        if (self::canAuditRead()) {
            return;
        }

        Session::checkRight('config', READ);
    }

    public static function renderCsrfToken(): string
    {
        return Html::hidden('_glpi_csrf_token', [
            'value' => self::getCsrfToken(),
        ]);
    }

    public static function getCsrfToken(): string
    {
        if (self::$requestCsrfToken === null) {
            // GLPI 11 stores tokens in $_SESSION['glpicsrftokens'] as token => timestamp
            // and consumes them on validation (one-time use). Reusing an existing token
            // risks picking one that was already consumed by another POST in this session,
            // which would cause the form submission to 403. Always generate a fresh token
            // so it is guaranteed to be present in the session at submit time.
            self::$requestCsrfToken = Session::getNewCSRFToken();
            error_log(sprintf(
                '[integaglpi][csrf] generated new token=%s session_token_count=%d',
                substr(self::$requestCsrfToken, 0, 8) . '…',
                is_array($_SESSION['glpicsrftokens'] ?? null) ? count($_SESSION['glpicsrftokens']) : 0
            ));
        }

        return self::$requestCsrfToken;
    }

    private static function readCurrentCsrfTokenFromSession(): string
    {
        foreach (self::getSessionCsrfTokens() as $token) {
            return $token;
        }

        return '';
    }

    /**
     * @return array<int, string>
     */
    private static function getSessionCsrfTokens(): array
    {
        $tokens = [];

        if (is_callable([Session::class, 'getCSRFToken'])) {
            self::appendCsrfToken($tokens, Session::getCSRFToken());
        }

        $candidates = [
            $_SESSION['valid_id'] ?? null,
            $_SESSION['_glpi_csrf_token'] ?? null,
            $_SESSION['glpi_csrf_token'] ?? null,
            $_SESSION['csrf_token'] ?? null,
        ];

        foreach ($candidates as $candidate) {
            self::appendCsrfToken($tokens, $candidate);
        }

        foreach (['glpicsrftokens', 'glpi_csrf_tokens', 'csrf_tokens'] as $storeKey) {
            $store = $_SESSION[$storeKey] ?? null;
            if (!is_array($store)) {
                continue;
            }

            foreach ($store as $token => $value) {
                self::appendCsrfToken($tokens, $token);
                if (is_string($value)) {
                    self::appendCsrfToken($tokens, $value);
                }
            }
        }

        return array_values(array_unique($tokens));
    }

    /**
     * @param array<int, string> $tokens
     */
    private static function appendCsrfToken(array &$tokens, mixed $candidate): void
    {
        $token = trim((string) $candidate);

        if ($token !== '') {
            $tokens[] = $token;
        }
    }

    private static function hasRightBool(string $rightName, int $right): bool
    {
        return (bool) Session::haveRight($rightName, $right);
    }
}
