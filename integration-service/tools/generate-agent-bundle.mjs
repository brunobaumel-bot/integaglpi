/**
 * Gera bundle JSON para applyAgentBundle a partir de export JSONL.
 * Uso: node tools/generate-agent-bundle.mjs tmp/kb_export_eligible.jsonl tmp/agent_bundle.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { enrichAgentCandidate } from '../dist/domain/services/AgentKbEnricher.js';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error('Uso: node tools/generate-agent-bundle.mjs <export.jsonl> <bundle.json>');
  process.exit(1);
}

const lines = readFileSync(inPath, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '');
const bundle = [];

for (let i = 0; i < lines.length; i++) {
  try {
    const row = JSON.parse(lines[i]);
    bundle.push({ id: row.id, enrichment: enrichAgentCandidate(row) });
  } catch (err) {
    console.error(`Linha ${i + 1} inválida:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

writeFileSync(outPath, JSON.stringify(bundle, null, 0));
console.log(JSON.stringify({ input_lines: lines.length, bundle_items: bundle.length, out: outPath }));
