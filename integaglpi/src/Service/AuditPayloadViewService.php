<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

final class AuditPayloadViewService
{
    private const MAX_DISPLAY_BYTES = 1024;

    private const SENSITIVE_KEYS = [
        'token',
        'access_token',
        'authorization',
        'app_secret',
        'client_secret',
        'password',
        'psk',
        'api_key',
        'apikey',
        'secret',
        'bearer',
        'document_base64',
        'base64',
        'file_content',
        'media_content',
        'binary',
        'buffer',
        'raw_file',
    ];

    public function renderPayload(mixed $payload): string
    {
        $decoded = $this->decodePayload($payload);
        $masked = $this->maskValue($decoded);
        $json = json_encode(
            $masked,
            JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR
        );

        if (!is_string($json)) {
            $json = '[unavailable_payload]';
        }

        if (strlen($json) > self::MAX_DISPLAY_BYTES) {
            return substr($json, 0, self::MAX_DISPLAY_BYTES) . "\n[TRUNCATED_PAYLOAD]";
        }

        return $json;
    }

    private function decodePayload(mixed $payload): mixed
    {
        if (is_string($payload)) {
            $decoded = json_decode($payload, true);
            if (json_last_error() === JSON_ERROR_NONE) {
                return $decoded;
            }
        }

        return $payload;
    }

    private function maskValue(mixed $value): mixed
    {
        if (is_array($value)) {
            $masked = [];
            foreach ($value as $key => $item) {
                $keyString = is_string($key) ? $key : (string) $key;
                if ($this->isSensitiveKey($keyString)) {
                    $masked[$key] = '[REDACTED]';
                    continue;
                }

                $masked[$key] = $this->maskValue($item);
            }

            return $masked;
        }

        if (is_string($value)) {
            return $this->maskString($value);
        }

        if (is_object($value)) {
            return '[OBJECT]';
        }

        return $value;
    }

    private function isSensitiveKey(string $key): bool
    {
        return in_array(strtolower(trim($key)), self::SENSITIVE_KEYS, true);
    }

    private function maskString(string $value): string
    {
        $value = preg_replace_callback(
            '/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i',
            static function (array $matches): string {
                $email = (string) $matches[0];
                [$local, $domain] = array_pad(explode('@', $email, 2), 2, '');
                $first = substr($local, 0, 1) ?: '*';

                return $first . '***@' . $domain;
            },
            $value
        ) ?? $value;

        $value = preg_replace_callback(
            '/\+?\d[\d\s().-]{7,}\d/',
            static function (array $matches): string {
                $phone = preg_replace('/\D+/', '', (string) $matches[0]) ?? '';
                if (strlen($phone) < 8) {
                    return (string) $matches[0];
                }

                $prefix = str_starts_with((string) $matches[0], '+') ? '+' . substr($phone, 0, 2) : substr($phone, 0, 2);
                $suffix = substr($phone, -4);

                return $prefix . '******' . $suffix;
            },
            $value
        ) ?? $value;

        $value = preg_replace('/\b[A-Za-z0-9_\-]{40,}\b/', '[REDACTED]', $value) ?? $value;

        if (strlen($value) > 512) {
            return substr($value, 0, 512) . '...[TRUNCATED_STRING]';
        }

        return $value;
    }
}
