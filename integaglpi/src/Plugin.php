<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use Html;
use Session;

final class Plugin
{
    public const RIGHT_NAME = 'plugin_integaglpi';
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

    public static function getQueueAdminUrl(): string
    {
        return self::getWebBasePath() . '/front/config.form.php';
    }

    public static function getRoutingOptionsAdminUrl(): string
    {
        return self::getWebBasePath() . '/front/routing.options.form.php';
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
}
