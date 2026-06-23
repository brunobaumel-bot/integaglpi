/**
 * V10 Shadow Replay Lab G15 - curated sample pack generator.
 *
 * Produces shadow-replay-samples/curated-v1/samples.sanitized.jsonl
 * and expected-manifest.json from synthetic G6 envelopes.
 *
 * Run once (or to regenerate after changes to the sanitizer):
 *   npx tsc -p tsconfig.shadow-replay.json
 *   node scripts/v10ShadowReplayGenerateSamplePack.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createShadowReplaySampleEnvelope } from '../dist-shadow-replay/ShadowReplaySampleSanitizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_DIR = join(__dirname, '..', 'shadow-replay-samples', 'curated-v1');
const DATE = '2026-06-23T00:00:00.000Z';

const VALID_CASES = [
  {
    run_id: 'shadow-run-g15-curated-vpn-001',
    sample_id: 'shadow-sample-g15-curated-vpn-001',
    source_kind: 'synthetic_case',
    source_ref: 'shadow-source-g15-curated-vpn-001',
    problem_summary: 'Usuario nao consegue conectar a VPN corporativa apos troca de notebook. Tunnel nao estabelece.',
    technical_summary: 'Cliente VPN instalado na versao 5.x. Perfil do usuario valido no AD. Certificado de cliente ausente no novo dispositivo.',
    classification: { category: 'vpn', confidence: 0.95 },
    metadata: { synthetic: true, phase: 'g15', fixture_index: 1 },
    observed_at: DATE,
    created_at: DATE,
  },
  {
    run_id: 'shadow-run-g15-curated-remote-001',
    sample_id: 'shadow-sample-g15-curated-remote-001',
    source_kind: 'synthetic_case',
    source_ref: 'shadow-source-g15-curated-remote-001',
    problem_summary: 'Tecnico nao consegue conectar na estacao remota do usuario via ferramenta de suporte.',
    technical_summary: 'Conexao recusada na porta padrao. Firewall local do cliente pode estar bloqueando. Servico de acesso remoto verificado e ativo.',
    classification: { category: 'remote_access', confidence: 0.88 },
    metadata: { synthetic: true, phase: 'g15', fixture_index: 2 },
    observed_at: DATE,
    created_at: DATE,
  },
  {
    run_id: 'shadow-run-g15-curated-login-001',
    sample_id: 'shadow-sample-g15-curated-login-001',
    source_kind: 'synthetic_case',
    source_ref: 'shadow-source-g15-curated-login-001',
    problem_summary: 'Usuario bloqueado apos varias tentativas de login no sistema corporativo.',
    technical_summary: 'Conta bloqueada no controlador de dominio. Reset de senha e desbloqueio de conta necessarios.',
    classification: { category: 'password_login', confidence: 0.97 },
    metadata: { synthetic: true, phase: 'g15', fixture_index: 3 },
    observed_at: DATE,
    created_at: DATE,
  },
  {
    run_id: 'shadow-run-g15-curated-printer-001',
    sample_id: 'shadow-sample-g15-curated-printer-001',
    source_kind: 'synthetic_case',
    source_ref: 'shadow-source-g15-curated-printer-001',
    problem_summary: 'Impressora de rede nao aparece na lista de dispositivos apos reinstalacao do Windows.',
    technical_summary: 'Driver de impressora nao instalado. IP da impressora verificado e acessivel. Fila de impressao limpa.',
    classification: { category: 'printer', confidence: 0.92 },
    metadata: { synthetic: true, phase: 'g15', fixture_index: 4 },
    observed_at: DATE,
    created_at: DATE,
  },
  {
    run_id: 'shadow-run-g15-curated-network-001',
    sample_id: 'shadow-sample-g15-curated-network-001',
    source_kind: 'synthetic_case',
    source_ref: 'shadow-source-g15-curated-network-001',
    problem_summary: 'Computador conectado na rede local mas sem acesso a internet.',
    technical_summary: 'Gateway padrao configurado corretamente. DNS sem resposta para dominios externos. Proxy da empresa verificado.',
    classification: { category: 'network_no_internet', confidence: 0.90 },
    metadata: { synthetic: true, phase: 'g15', fixture_index: 5 },
    observed_at: DATE,
    created_at: DATE,
  },
  {
    run_id: 'shadow-run-g15-curated-slow-001',
    sample_id: 'shadow-sample-g15-curated-slow-001',
    source_kind: 'synthetic_case',
    source_ref: 'shadow-source-g15-curated-slow-001',
    problem_summary: 'Sistema operacional com lentidao severa ao abrir qualquer aplicativo.',
    technical_summary: 'CPU em uso elevado por processo desconhecido. Antivirus em scan completo em segundo plano. Disco sem espaco livre.',
    classification: { category: 'slow_performance', confidence: 0.85 },
    metadata: { synthetic: true, phase: 'g15', fixture_index: 6 },
    observed_at: DATE,
    created_at: DATE,
  },
  {
    run_id: 'shadow-run-g15-curated-email-001',
    sample_id: 'shadow-sample-g15-curated-email-001',
    source_kind: 'synthetic_case',
    source_ref: 'shadow-source-g15-curated-email-001',
    problem_summary: 'Usuario nao consegue enviar ou receber mensagens no cliente de correio eletronico.',
    technical_summary: 'Configuracao de servidor SMTP/IMAP incorreta apos migracao de dominio. Credenciais expiradas no perfil de e-mail.',
    classification: { category: 'email_issue', confidence: 0.93 },
    metadata: { synthetic: true, phase: 'g15', fixture_index: 7 },
    observed_at: DATE,
    created_at: DATE,
  },
  {
    run_id: 'shadow-run-g15-curated-syserr-001',
    sample_id: 'shadow-sample-g15-curated-syserr-001',
    source_kind: 'synthetic_case',
    source_ref: 'shadow-source-g15-curated-syserr-001',
    problem_summary: 'Sistema ERP apresenta erro critico ao tentar salvar um registro de pedido.',
    technical_summary: 'Excecao de banco de dados capturada no log do sistema. Tabela de pedidos com bloqueio de linha. Reindexacao necessaria.',
    classification: { category: 'system_error', confidence: 0.91 },
    metadata: { synthetic: true, phase: 'g15', fixture_index: 8 },
    observed_at: DATE,
    created_at: DATE,
  },
];

// Invalid sample 1: has forbidden raw_payload key
const INVALID_RAW_PAYLOAD = {
  schema_version: 'g6_sample_envelope_v1',
  run_id: 'shadow-run-g15-invalid-rawpayload-001',
  sample_id: 'shadow-sample-g15-invalid-rawpayload-001',
  source_kind: 'synthetic_case',
  source_ref_hash: 'a'.repeat(64),
  sanitized_problem_summary: 'Caso invalido contendo payload bruto proibido.',
  sanitized_technical_summary: 'Este envelope contem uma chave raw_payload que deve ser rejeitada.',
  classification_metadata: { category: 'vpn' },
  sanitized_metadata: { synthetic: true },
  raw_payload: { text: 'conteudo bruto proibido nao deve passar' },
  redaction_report: {
    redacted: { email: 0, phone: 0, cpf_cnpj: 0, token: 0, url_secret: 0, ticket_protocol: 0, person_name: 0, private_key: 0, base64: 0, html: 0 },
    truncated_fields: [],
    forbidden_keys: [],
    residual_pii_detected: false,
  },
  observed_at: DATE,
  created_at: DATE,
};

// Invalid sample 2: has source_ref (plain text) instead of only source_ref_hash
const INVALID_SOURCE_REF = {
  schema_version: 'g6_sample_envelope_v1',
  run_id: 'shadow-run-g15-invalid-sourceref-001',
  sample_id: 'shadow-sample-g15-invalid-sourceref-001',
  source_kind: 'synthetic_case',
  source_ref: 'raw-ticket-chamado-ref-12345',
  source_ref_hash: 'b'.repeat(64),
  sanitized_problem_summary: 'Caso invalido com referencia de origem nao hasheada presente.',
  sanitized_technical_summary: 'Este envelope contem source_ref raw que deve ser rejeitado.',
  classification_metadata: { category: 'printer' },
  sanitized_metadata: { synthetic: true },
  redaction_report: {
    redacted: { email: 0, phone: 0, cpf_cnpj: 0, token: 0, url_secret: 0, ticket_protocol: 0, person_name: 0, private_key: 0, base64: 0, html: 0 },
    truncated_fields: [],
    forbidden_keys: [],
    residual_pii_detected: false,
  },
  observed_at: DATE,
  created_at: DATE,
};

mkdirSync(PACK_DIR, { recursive: true });

const validEnvelopes = VALID_CASES.map((c) =>
  createShadowReplaySampleEnvelope({
    run_id: c.run_id,
    sample_id: c.sample_id,
    source_kind: /** @type {any} */ (c.source_kind),
    source_ref: c.source_ref,
    problem_summary: c.problem_summary,
    technical_summary: c.technical_summary,
    classification: c.classification,
    metadata: c.metadata,
    observed_at: c.observed_at,
    created_at: c.created_at,
  }),
);

const allLines = [
  ...validEnvelopes.map((e) => JSON.stringify(e)),
  JSON.stringify(INVALID_RAW_PAYLOAD),
  JSON.stringify(INVALID_SOURCE_REF),
];

const jsonlContent = `${allLines.join('\n')}\n`;
writeFileSync(join(PACK_DIR, 'samples.sanitized.jsonl'), jsonlContent, 'utf8');

const categories = validEnvelopes
  .map((e) => e.classification_metadata['category'])
  .filter(Boolean)
  .sort((a, b) => String(a).localeCompare(String(b)));

const manifest = {
  schema_version: 'g15_curated_sample_pack_v1',
  pack_name: 'curated-v1',
  total_lines: allLines.length,
  expected_valid: validEnvelopes.length,
  expected_rejected: 2,
  rejection_codes: ['raw_key_forbidden', 'source_ref_not_hash'],
  categories_covered: [...new Set(categories)].sort(),
  generated_at: DATE,
};
writeFileSync(join(PACK_DIR, 'expected-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

process.stdout.write(`Generated ${allLines.length} lines (${validEnvelopes.length} valid, 2 invalid) in ${PACK_DIR}\n`);
process.stdout.write(`Categories: ${manifest.categories_covered.join(', ')}\n`);
