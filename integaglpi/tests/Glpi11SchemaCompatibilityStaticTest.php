<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use FilesystemIterator;

/**
 * Static guard tests for GLPI 11 schema compatibility.
 * PHASE: integaglpi_v8_glpi11_schema_compatibility_fix_001
 *
 * Verifies that no src/ code references tables or columns that do not exist
 * in GLPI 11, and that optional columns are always guarded before use.
 * All assertions read files as text — no database, no HTTP, no runtime.
 */
final class Glpi11SchemaCompatibilityStaticTest extends TestCase
{
    private function pluginSrcPath(): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'src';
    }

    private function nodeSrcPath(): string
    {
        return dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'integration-service' . DIRECTORY_SEPARATOR . 'src';
    }

    private function readPluginFile(string $relative): string
    {
        $path = dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);

        return is_readable($path) ? (string) file_get_contents($path) : '';
    }

    /**
     * @return list<string>
     */
    private function allSrcPhpFiles(): array
    {
        $files = [];
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($this->pluginSrcPath(), FilesystemIterator::SKIP_DOTS)
        );
        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $files[] = $file->getPathname();
            }
        }
        sort($files);

        return $files;
    }

    private function combinedSrcContents(): string
    {
        $out = '';
        foreach ($this->allSrcPhpFiles() as $path) {
            $out .= (string) file_get_contents($path);
        }

        return $out;
    }

    // ── Forbidden table references ────────────────────────────────────────

    public function testNoReferenceToGlpiItiltypes(): void
    {
        self::assertStringNotContainsString(
            'glpi_itiltypes',
            $this->combinedSrcContents(),
            'glpi_itiltypes does not exist in GLPI 11 — must not be referenced in src/'
        );
    }

    public function testNoReferenceToGlpiServicecatalogs(): void
    {
        self::assertStringNotContainsString(
            'glpi_servicecatalogs',
            $this->combinedSrcContents(),
            'glpi_servicecatalogs does not exist in GLPI 11 — must not be referenced in src/'
        );
    }

    // ── Unsafe column filters on glpi_itilcategories ─────────────────────

    public function testNoIsDeletedFilterOnItilCategories(): void
    {
        $contents = $this->combinedSrcContents();

        foreach ([
            '/glpi_itilcategories[^\n]*is_deleted/i',
            '/is_deleted[^\n]*glpi_itilcategories/i',
        ] as $pattern) {
            self::assertDoesNotMatchRegularExpression(
                $pattern,
                $contents,
                "is_deleted must not be used with glpi_itilcategories (column absent in GLPI 11): $pattern"
            );
        }
    }

    public function testNoIsActiveFilterOnItilCategories(): void
    {
        $contents = $this->combinedSrcContents();

        foreach ([
            '/glpi_itilcategories[^\n]*is_active/i',
            '/is_active[^\n]*glpi_itilcategories/i',
        ] as $pattern) {
            self::assertDoesNotMatchRegularExpression(
                $pattern,
                $contents,
                "is_active must not be used with glpi_itilcategories (column absent in GLPI 11): $pattern"
            );
        }
    }

    // ── Unsafe column filter on glpi_slas ────────────────────────────────

    public function testNoIsDeletedFilterOnSlas(): void
    {
        $contents = $this->combinedSrcContents();

        foreach ([
            '/glpi_slas[^\n]*is_deleted/i',
            '/is_deleted[^\n]*glpi_slas/i',
        ] as $pattern) {
            self::assertDoesNotMatchRegularExpression(
                $pattern,
                $contents,
                "is_deleted must not be used with glpi_slas (column absent in GLPI 11): $pattern"
            );
        }
    }

    // ── NativeKnowledgeBaseService guards ────────────────────────────────

    public function testNativeKbServiceGuardsIsDeletedWithFieldExists(): void
    {
        $service = $this->readPluginFile('src/Service/NativeKnowledgeBaseService.php');
        self::assertNotEmpty($service, 'NativeKnowledgeBaseService.php must be readable');

        self::assertStringContainsString(
            "fieldExists('glpi_knowbaseitems', 'is_deleted')",
            $service,
            'NativeKnowledgeBaseService must use fieldExists() guard before using is_deleted on glpi_knowbaseitems'
        );
    }

    public function testNativeKbServiceIsDeletedOnlyWithinFieldExistsBlock(): void
    {
        $service = $this->readPluginFile('src/Service/NativeKnowledgeBaseService.php');
        self::assertNotEmpty($service, 'NativeKnowledgeBaseService.php must be readable');

        preg_match_all('/is_deleted/', $service, $matches, PREG_OFFSET_CAPTURE);
        foreach ($matches[0] as [, $offset]) {
            $window = substr($service, max(0, $offset - 180), 360);
            self::assertStringContainsString(
                'fieldExists',
                $window,
                "Every occurrence of is_deleted in NativeKnowledgeBaseService must be within 180 chars of a fieldExists() guard"
            );
        }
    }

    public function testNativeKbServiceIncludesBeginDateInSelectFields(): void
    {
        $service = $this->readPluginFile('src/Service/NativeKnowledgeBaseService.php');
        self::assertNotEmpty($service, 'NativeKnowledgeBaseService.php must be readable');

        self::assertStringContainsString(
            "'begin_date'",
            $service,
            "NativeKnowledgeBaseService must include 'begin_date' in the fieldExists-guarded SELECT fields list"
        );
    }

    public function testNativeKbServiceIncludesEndDateInSelectFields(): void
    {
        $service = $this->readPluginFile('src/Service/NativeKnowledgeBaseService.php');
        self::assertNotEmpty($service, 'NativeKnowledgeBaseService.php must be readable');

        self::assertStringContainsString(
            "'end_date'",
            $service,
            "NativeKnowledgeBaseService must include 'end_date' in the fieldExists-guarded SELECT fields list"
        );
    }

    public function testNativeKbServiceGuardsBeginDateWithArrayKeyExists(): void
    {
        $service = $this->readPluginFile('src/Service/NativeKnowledgeBaseService.php');
        self::assertNotEmpty($service, 'NativeKnowledgeBaseService.php must be readable');

        self::assertStringContainsString(
            "array_key_exists('begin_date', \$row)",
            $service,
            "NativeKnowledgeBaseService must use array_key_exists() guard before reading begin_date from \$row"
        );
    }

    public function testNativeKbServiceGuardsEndDateWithArrayKeyExists(): void
    {
        $service = $this->readPluginFile('src/Service/NativeKnowledgeBaseService.php');
        self::assertNotEmpty($service, 'NativeKnowledgeBaseService.php must be readable');

        self::assertStringContainsString(
            "array_key_exists('end_date', \$row)",
            $service,
            "NativeKnowledgeBaseService must use array_key_exists() guard before reading end_date from \$row"
        );
    }

    public function testNativeKbServiceHasIsWithinPublicationWindowMethod(): void
    {
        $service = $this->readPluginFile('src/Service/NativeKnowledgeBaseService.php');
        self::assertNotEmpty($service, 'NativeKnowledgeBaseService.php must be readable');

        self::assertStringContainsString(
            'isWithinPublicationWindow',
            $service,
            'NativeKnowledgeBaseService must contain the isWithinPublicationWindow() method'
        );
    }

    public function testNativeKbServiceCallsPublicationWindowBeforeCanView(): void
    {
        $service = $this->readPluginFile('src/Service/NativeKnowledgeBaseService.php');
        self::assertNotEmpty($service, 'NativeKnowledgeBaseService.php must be readable');

        $windowPos = strpos($service, 'isWithinPublicationWindow(');
        $canViewPos = strpos($service, 'canViewArticle(');

        self::assertNotFalse($windowPos, 'isWithinPublicationWindow() must be called in NativeKnowledgeBaseService');
        self::assertNotFalse($canViewPos, 'canViewArticle() must be called in NativeKnowledgeBaseService');
        self::assertLessThan(
            $canViewPos,
            $windowPos,
            'isWithinPublicationWindow() must be called before canViewArticle() in buildVisibleArticle()'
        );
    }

    // ── Node service: no MySQL/MariaDB driver ─────────────────────────────

    public function testNodeServiceHasNoMysqlOrMariadbDriverImport(): void
    {
        $nodeSrc = $this->nodeSrcPath();
        if (!is_dir($nodeSrc)) {
            self::markTestSkipped('integration-service/src not found — skipping Node driver check');
        }

        $forbidden = ['mysql2', 'mariadb', 'mysql/'];
        $iterator  = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($nodeSrc, FilesystemIterator::SKIP_DOTS)
        );

        foreach ($iterator as $file) {
            if (!$file->isFile() || !in_array($file->getExtension(), ['ts', 'js'], true)) {
                continue;
            }

            $content  = (string) file_get_contents($file->getPathname());
            $filename = $file->getFilename();

            foreach ($forbidden as $driver) {
                self::assertStringNotContainsString(
                    "from '" . $driver,
                    $content,
                    "Node file $filename must not import MySQL/MariaDB driver '$driver'"
                );
                self::assertStringNotContainsString(
                    'from "' . $driver,
                    $content,
                    "Node file $filename must not import MySQL/MariaDB driver '$driver'"
                );
                self::assertStringNotContainsString(
                    "require('" . $driver,
                    $content,
                    "Node file $filename must not require MySQL/MariaDB driver '$driver'"
                );
                self::assertStringNotContainsString(
                    'require("' . $driver,
                    $content,
                    "Node file $filename must not require MySQL/MariaDB driver '$driver'"
                );
            }
        }

        self::assertTrue(true, 'Node service has no MySQL/MariaDB driver imports in .ts/.js files');
    }
}
