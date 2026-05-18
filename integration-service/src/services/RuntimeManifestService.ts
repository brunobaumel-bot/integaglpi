import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIAGNOSTIC_CATEGORIES = [
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
] as const;

type ManifestFileEntry = {
  path?: unknown;
  sha256?: unknown;
};

type PackageManifest = {
  build_id?: unknown;
  package_id?: unknown;
  generated_at?: unknown;
  phase_ids?: unknown;
  critical_files?: unknown;
  expected_migrations?: unknown;
};

export type RuntimeManifestStatus = {
  found: boolean;
  status: 'ok' | 'package_incomplete';
  source_hint: string | null;
  build_id: string | null;
  package_id: string | null;
  generated_at: string | null;
  phase_ids: string[];
  critical_files_count: number;
  expected_migrations_count: number;
  missing_critical_files: string[];
};

function criticalFileExists(manifestRoot: string, path: string): boolean {
  if (existsSync(resolve(manifestRoot, path))) {
    return true;
  }

  if (path.startsWith('integration-service/')) {
    return existsSync(resolve(manifestRoot, path.slice('integration-service/'.length)));
  }

  return false;
}

function candidateManifestPaths(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));

  return [
    resolve(process.cwd(), 'package_manifest.json'),
    resolve(process.cwd(), '..', 'package_manifest.json'),
    resolve(here, '..', '..', '..', 'package_manifest.json'),
    resolve(here, '..', '..', 'package_manifest.json'),
    resolve(here, '..', 'package_manifest.json'),
  ];
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item !== '');
}

function toFileEntries(value: unknown): ManifestFileEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is ManifestFileEntry => item !== null && typeof item === 'object');
}

function safeString(value: unknown): string | null {
  const text = String(value ?? '').trim();

  return text !== '' ? text : null;
}

export function readRuntimeManifest(): RuntimeManifestStatus {
  for (const candidate of candidateManifestPaths()) {
    if (!existsSync(candidate)) {
      continue;
    }

    try {
      const raw = readFileSync(candidate, 'utf8');
      const manifest = JSON.parse(raw) as PackageManifest;
      const criticalFiles = toFileEntries(manifest.critical_files);
      const expectedMigrations = toStringArray(manifest.expected_migrations);
      const buildId = safeString(manifest.build_id);
      const packageId = safeString(manifest.package_id);
      const manifestRoot = dirname(candidate);
      const missingCriticalFiles = criticalFiles
        .map((entry) => String(entry.path ?? '').trim())
        .filter((path) => path !== '' && !criticalFileExists(manifestRoot, path));
      const status = buildId !== null && packageId !== null && missingCriticalFiles.length === 0 ? 'ok' : 'package_incomplete';

      return {
        found: true,
        status,
        source_hint: basename(candidate),
        build_id: buildId,
        package_id: packageId,
        generated_at: safeString(manifest.generated_at),
        phase_ids: toStringArray(manifest.phase_ids),
        critical_files_count: criticalFiles.length,
        expected_migrations_count: expectedMigrations.length,
        missing_critical_files: missingCriticalFiles,
      };
    } catch {
      return {
        found: true,
        status: 'package_incomplete',
        source_hint: basename(candidate),
        build_id: null,
        package_id: null,
        generated_at: null,
        phase_ids: [],
        critical_files_count: 0,
        expected_migrations_count: 0,
        missing_critical_files: [],
      };
    }
  }

  return {
    found: false,
    status: 'package_incomplete',
    source_hint: null,
    build_id: null,
    package_id: null,
    generated_at: null,
    phase_ids: [],
    critical_files_count: 0,
    expected_migrations_count: 0,
    missing_critical_files: [],
  };
}
