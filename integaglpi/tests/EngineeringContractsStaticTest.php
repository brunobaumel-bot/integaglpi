<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use SplFileInfo;

final class EngineeringContractsStaticTest extends TestCase
{
    private function repoPath(string $relative): string
    {
        return dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    }

    private function pluginPath(string $relative): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    }

    private function readRepo(string $relative): string
    {
        return (string) file_get_contents($this->repoPath($relative));
    }

    private function readPlugin(string $relative): string
    {
        return (string) file_get_contents($this->pluginPath($relative));
    }

    public function testMessageCatalogBoundaryIsSharedByPluginAndNode(): void
    {
        $contract = $this->readRepo('integration-service/src/domain/contracts/MessageCatalogContract.ts');
        $settingsService = $this->readRepo('integration-service/src/domain/services/SettingsService.ts');
        $postgresRepository = $this->readRepo('integration-service/src/repositories/postgres/PostgresSettingsRepository.ts');
        $pluginConfig = $this->readPlugin('src/Service/PluginConfigService.php');
        $externalSync = $this->readPlugin('src/Service/ExternalSettingsSyncService.php');

        foreach ([
            'menu_message',
            'invalid_option_message',
            'invalid_media_message',
            'error_fallback_message',
            'ticket_created_message',
            'conversation_closed_message',
            'after_hours_message',
        ] as $key) {
            self::assertStringContainsString("'" . $key . "'", $contract);
            self::assertStringContainsString($key . ':', $settingsService);
            self::assertStringContainsString("'" . $key . "'", $pluginConfig);
            self::assertStringContainsString("'" . $key . "'", $externalSync);
        }

        self::assertStringContainsString('NODE_MESSAGE_CATALOG_KEYS', $postgresRepository);
        self::assertStringContainsString('syncMessageSettings($payload)', $pluginConfig);
        self::assertStringContainsString("self::upsertContext(\$pdo, 'message'", $externalSync);
    }

    public function testNodeDoesNotUseGlpiMariaDbAccess(): void
    {
        $root = $this->repoPath('integration-service/src');
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root));
        $offenders = [];

        foreach ($iterator as $file) {
            if (!$file instanceof SplFileInfo || $file->isDir() || $file->getExtension() !== 'ts') {
                continue;
            }

            $source = (string) file_get_contents($file->getPathname());
            if (preg_match('/from [\'"](mysql2?|mariadb|mysqli)[\'"]|require\([\'"](mysql2?|mariadb|mysqli)[\'"]\)|new PDO\b|PDO::|createConnection\([^)]*3306/i', $source)) {
                $offenders[] = $file->getPathname();
            }
        }

        self::assertSame([], $offenders);
    }

    public function testCriticalWhatsappActionsKeepCsrfAndRbacGuards(): void
    {
        foreach ([
            'front/central.action.php',
            'front/ticket.whatsapp.action.php',
            'front/ticket.whatsapp.reply.php',
        ] as $relative) {
            $source = $this->readPlugin($relative);
            self::assertStringContainsString('Plugin::isCsrfValid($_POST)', $source, $relative);
            self::assertStringContainsString('requirePermissionOrDeny', $source, $relative);
        }

        $central = $this->readPlugin('front/central.action.php');
        self::assertStringContainsString('conversation_id', $central);
        self::assertStringContainsString('ticket_id', $central);

        $reply = $this->readPlugin('front/ticket.whatsapp.reply.php');
        self::assertStringContainsString('RIGHT_REPLY_OWNED_TICKET', $reply);
        self::assertStringContainsString('assigned_user_id', $reply);
    }
}
