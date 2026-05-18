<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

final class RuntimeGuardService
{
    public const DIAGNOSTIC_CATEGORIES = [
        'connection',
        'permission',
        'schema',
        'query',
        'timeout',
        'runtime_mismatch',
        'package_incomplete',
        'config_missing',
        'external_api',
        'validation',
        'php_runtime_error',
    ];

    /**
     * @return array<string, mixed>
     */
    public function getLocalManifestStatus(): array
    {
        foreach ($this->manifestCandidates() as $candidate) {
            if (!is_file($candidate)) {
                continue;
            }

            $manifest = $this->readManifest($candidate);
            $buildId = $this->nonEmptyString($manifest['build_id'] ?? null);
            $packageId = $this->nonEmptyString($manifest['package_id'] ?? null);
            $criticalFiles = is_array($manifest['critical_files'] ?? null) ? $manifest['critical_files'] : [];
            $expectedMigrations = is_array($manifest['expected_migrations'] ?? null) ? $manifest['expected_migrations'] : [];
            $missingFiles = $this->findMissingCriticalFiles(dirname($candidate), $criticalFiles);
            $status = $buildId !== '' && $packageId !== '' && $missingFiles === [] ? 'ok' : 'package_incomplete';

            return [
                'found' => true,
                'status' => $status,
                'source_hint' => basename($candidate),
                'build_id' => $buildId,
                'package_id' => $packageId,
                'generated_at' => $this->nonEmptyString($manifest['generated_at'] ?? null),
                'phase_ids' => $this->stringList($manifest['phase_ids'] ?? []),
                'critical_files_count' => count($criticalFiles),
                'expected_migrations_count' => count($expectedMigrations),
                'missing_critical_files' => $missingFiles,
            ];
        }

        return [
            'found' => false,
            'status' => 'package_incomplete',
            'source_hint' => null,
            'build_id' => '',
            'package_id' => '',
            'generated_at' => '',
            'phase_ids' => [],
            'critical_files_count' => 0,
            'expected_migrations_count' => 0,
            'missing_critical_files' => [],
        ];
    }

    /**
     * @param array<string, mixed>|null $nodeDiagnostics
     *
     * @return array<string, mixed>
     */
    public function compareWithNode(?array $nodeDiagnostics): array
    {
        $local = $this->getLocalManifestStatus();
        $nodeBuild = is_array($nodeDiagnostics['build'] ?? null) ? $nodeDiagnostics['build'] : [];
        $nodeBuildId = $this->nonEmptyString($nodeBuild['build_id'] ?? null);
        $nodePackageId = $this->nonEmptyString($nodeBuild['package_id'] ?? null);

        $alerts = [];
        if (($local['status'] ?? '') !== 'ok') {
            $alerts[] = 'package_incomplete';
        }

        if ($nodeDiagnostics !== null && (($nodeBuild['package_status'] ?? '') === 'package_incomplete')) {
            $alerts[] = 'node_package_incomplete';
        }

        $localBuildId = (string) ($local['build_id'] ?? '');
        $localPackageId = (string) ($local['package_id'] ?? '');
        $hasComparableIds = $localBuildId !== '' && $localPackageId !== '' && $nodeBuildId !== '' && $nodePackageId !== '';

        if ($hasComparableIds && ($localBuildId !== $nodeBuildId || $localPackageId !== $nodePackageId)) {
            $alerts[] = 'runtime_mismatch';
        }

        return [
            'status' => $alerts === [] ? 'ok' : 'attention',
            'alerts' => array_values(array_unique($alerts)),
            'local_build_id' => $localBuildId,
            'local_package_id' => $localPackageId,
            'node_build_id' => $nodeBuildId,
            'node_package_id' => $nodePackageId,
        ];
    }

    /**
     * @return array<int, string>
     */
    private function manifestCandidates(): array
    {
        $root = defined('PLUGIN_INTEGAGLPI_ROOT') ? (string) PLUGIN_INTEGAGLPI_ROOT : dirname(__DIR__, 2);

        return array_values(array_unique([
            $root . '/package_manifest.json',
            dirname($root) . '/package_manifest.json',
            dirname($root, 2) . '/package_manifest.json',
        ]));
    }

    /**
     * @return array<string, mixed>
     */
    private function readManifest(string $path): array
    {
        $raw = @file_get_contents($path);
        if (!is_string($raw) || trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @param array<int, mixed> $criticalFiles
     * @return array<int, string>
     */
    private function findMissingCriticalFiles(string $manifestRoot, array $criticalFiles): array
    {
        $missing = [];
        foreach ($criticalFiles as $entry) {
            if (!is_array($entry)) {
                continue;
            }

            $path = $this->nonEmptyString($entry['path'] ?? null);
            if ($path === '' || str_contains($path, '..')) {
                continue;
            }

            if (!$this->criticalFileExists($manifestRoot, $path)) {
                $missing[] = $path;
            }
        }

        return $missing;
    }

    private function criticalFileExists(string $manifestRoot, string $path): bool
    {
        if (is_file($manifestRoot . '/' . $path)) {
            return true;
        }

        if (str_starts_with($path, 'integaglpi/') && defined('PLUGIN_INTEGAGLPI_ROOT')) {
            return is_file((string) PLUGIN_INTEGAGLPI_ROOT . '/' . substr($path, strlen('integaglpi/')));
        }

        return false;
    }

    /**
     * @param mixed $value
     * @return array<int, string>
     */
    private function stringList(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $strings = [];
        foreach ($value as $item) {
            $text = $this->nonEmptyString($item);
            if ($text !== '') {
                $strings[] = $text;
            }
        }

        return $strings;
    }

    private function nonEmptyString(mixed $value): string
    {
        $text = trim((string) ($value ?? ''));

        return $text !== '' ? $text : '';
    }
}
