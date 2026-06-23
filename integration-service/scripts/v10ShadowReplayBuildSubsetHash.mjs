#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALGORITHM_VERSION = 'g2_build_subset_hash_v1';
const ROOT_POLICY = 'project_root_posix_relative_paths';

const FIXED_PATHS = [
  'integration-service/package.json',
  'integration-service/package-lock.json',
  'integration-service/tsconfig.json',
  'integration-service/tsconfig.shadow-replay.json',
  'integration-service/Dockerfile.shadow-replay',
  'integration-service/Dockerfile.shadow-replay.dockerignore',
];

const SHADOW_REPLAY_ROOT = 'integration-service/src/shadowReplay';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function collectFiles(rootDir, relativeDir) {
  const absoluteDir = path.join(rootDir, ...relativeDir.split('/'));
  const entries = readdirSync(absoluteDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  const files = [];
  for (const entry of entries) {
    const relativePath = `${relativeDir}/${entry.name}`;
    const absolutePath = path.join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(rootDir, relativePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(toPosixPath(relativePath));
    }
  }
  return files;
}

function resolveProjectRoot() {
  const argIndex = process.argv.findIndex((arg) => arg === '--root');
  if (argIndex >= 0) {
    const value = process.argv[argIndex + 1];
    if (!value) {
      throw new Error('Missing value for --root');
    }
    return path.resolve(value);
  }

  if (process.argv[2] && !process.argv[2].startsWith('--')) {
    return path.resolve(process.argv[2]);
  }

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

function buildCanonicalManifest(projectRoot) {
  const paths = [
    ...FIXED_PATHS,
    ...collectFiles(projectRoot, SHADOW_REPLAY_ROOT),
  ].sort();

  const files = paths.map((relativePath) => {
    const absolutePath = path.join(projectRoot, ...relativePath.split('/'));
    const stat = statSync(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`Build subset path is not a file: ${relativePath}`);
    }
    const content = readFileSync(absolutePath);
    return {
      path: relativePath,
      sha256: sha256(content),
      size_bytes: content.length,
    };
  });

  return {
    algorithm_version: ALGORITHM_VERSION,
    root_policy: ROOT_POLICY,
    paths,
    files,
  };
}

const projectRoot = resolveProjectRoot();
const canonicalManifest = buildCanonicalManifest(projectRoot);
const canonicalJson = `${JSON.stringify(canonicalManifest)}\n`;
const output = {
  ...canonicalManifest,
  canonical_json_sha256: sha256(Buffer.from(canonicalJson, 'utf8')),
  build_subset_hash: sha256(Buffer.from(canonicalJson, 'utf8')),
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
