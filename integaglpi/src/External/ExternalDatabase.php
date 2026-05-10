<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\External;

use PDO;
use PDOException;
use RuntimeException;

final class ExternalDatabase
{
    private static ?PDO $connection = null;

    private static ?string $connectionKey = null;

    /**
     * @param array<string, mixed> $config
     */
    public static function getConnection(array $config): PDO
    {
        $connectionKey = implode('|', [
            (string) ($config['db_host'] ?? ''),
            (string) ($config['db_port'] ?? ''),
            (string) ($config['db_name'] ?? ''),
            (string) ($config['db_user'] ?? ''),
            (string) ($config['db_sslmode'] ?? ''),
        ]);

        if (self::$connection instanceof PDO && self::$connectionKey === $connectionKey) {
            return self::$connection;
        }

        $host = trim((string) ($config['db_host'] ?? ''));
        $port = (int) ($config['db_port'] ?? 0);
        $database = trim((string) ($config['db_name'] ?? ''));
        $user = trim((string) ($config['db_user'] ?? ''));
        $password = (string) ($config['db_password'] ?? '');
        $sslMode = trim((string) ($config['db_sslmode'] ?? 'prefer'));

        if ($host === '' || $port <= 0 || $database === '' || $user === '') {
            throw new RuntimeException(__('The external PostgreSQL connection is not fully configured.', 'glpiintegaglpi'));
        }

        $dsn = sprintf(
            'pgsql:host=%s;port=%d;dbname=%s;sslmode=%s',
            $host,
            $port,
            $database,
            $sslMode !== '' ? $sslMode : 'prefer'
        );

        try {
            self::$connection = new PDO($dsn, $user, $password, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
            self::$connectionKey = $connectionKey;
        } catch (PDOException $exception) {
            throw new RuntimeException(__('Unable to connect to the external PostgreSQL database.', 'glpiintegaglpi'), 0, $exception);
        }

        return self::$connection;
    }
}
