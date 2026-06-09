/**
 * LogMeIn Asset Matching — Static Unit Tests (F6)
 *
 * Validação de invariantes sem acesso externo:
 *   - assessTagQuality: valid/invalid/missing
 *   - assessHostnameQuality: corporate/generic/unknown
 *   - computeScore: cobertura dos 5 cenários de scoring
 *   - buildReason: determinístico, sem PII
 *   - deriveSignals: sinais corretos por host
 *   - LogmeinAssetMatchingService.buildReport:
 *       create_ticket: false (literal)
 *       real_mutation_forbidden: true (literal)
 *       feature_flag_enabled=false quando env não configurado
 *       ambiguity detection (diff < AMBIGUITY_THRESHOLD)
 *       by_status counts corretos
 *   - LogmeinAssetMatchingService.buildPreview:
 *       preview_only: true / stateModified: false / create_ticket: false
 *       checklist não vazio
 *   - Nenhum campo de resultado contém PII
 *
 * Phase: integaglpi_v9_inventory_reconciliation_001 — F6
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  assessTagQuality,
  assessHostnameQuality,
  computeScore,
  buildReason,
  deriveSignals,
  LogmeinAssetMatchingService,
  SCORE_EQUIPMENT_TAG_EXACT,
  SCORE_HOSTNAME_PLUS_ENTITY,
  SCORE_HOSTNAME_ONLY,
  SCORE_GROUP_PLUS_ENTITY,
  SCORE_NO_MATCH,
  AMBIGUITY_THRESHOLD,
  type MatchSignals,
} from '../src/domain/services/LogmeinAssetMatchingService.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSignals(overrides: Partial<MatchSignals> = {}): MatchSignals {
  return {
    hasEquipmentTag: false,
    tagQuality: 'missing',
    hasEntityMapping: false,
    hostnameQuality: 'generic',
    entityId: null,
    entitySource: 'none',
    ...overrides,
  };
}

function makeHost(overrides: Partial<{
  externalId: string;
  hostName: string;
  equipmentTag: string | null;
  groupExternalId: string;
  groupName: string;
}> = {}) {
  return {
    externalId: 'host-001',
    hostName: 'DESKTOP-TEST',
    equipmentTag: null,
    groupExternalId: 'grp-001',
    groupName: 'Grupo Teste',
    ...overrides,
  };
}

function makeService(): LogmeinAssetMatchingService {
  return new LogmeinAssetMatchingService();
}

// ── assessTagQuality ──────────────────────────────────────────────────────────

describe('assessTagQuality', () => {
  it('null → missing', () => expect(assessTagQuality(null)).toBe('missing'));
  it('"" → missing', () => expect(assessTagQuality('')).toBe('missing'));
  it('"  " → missing (whitespace)', () => expect(assessTagQuality('  ')).toBe('missing'));
  it('"1234" → valid (4 digits)', () => expect(assessTagQuality('1234')).toBe('valid'));
  it('"0001" → valid', () => expect(assessTagQuality('0001')).toBe('valid'));
  it('"9999" → valid', () => expect(assessTagQuality('9999')).toBe('valid'));
  it('"123" → invalid (3 digits)', () => expect(assessTagQuality('123')).toBe('invalid'));
  it('"12345" → invalid (5 digits)', () => expect(assessTagQuality('12345')).toBe('invalid'));
  it('"AB12" → invalid (mixed)', () => expect(assessTagQuality('AB12')).toBe('invalid'));
  it('"ABCD" → invalid (letters)', () => expect(assessTagQuality('ABCD')).toBe('invalid'));
  it('"1234 " (with trailing space) → tag trimmed → valid', () =>
    expect(assessTagQuality('1234 ')).toBe('valid'));
});

// ── assessHostnameQuality ─────────────────────────────────────────────────────

describe('assessHostnameQuality', () => {
  it('"" → unknown', () => expect(assessHostnameQuality('')).toBe('unknown'));
  it('"LOCALHOST" → generic', () => expect(assessHostnameQuality('LOCALHOST')).toBe('generic'));
  it('"DESKTOP" → generic (generic keyword)', () => expect(assessHostnameQuality('DESKTOP')).toBe('generic'));
  it('"123" → generic (all numeric)', () => expect(assessHostnameQuality('123')).toBe('generic'));
  it('"PC" → generic (too short < 4)', () => expect(assessHostnameQuality('PC')).toBe('generic'));
  it('"DESKTOP-ABC123" → corporate (pattern)', () => expect(assessHostnameQuality('DESKTOP-ABC123')).toBe('corporate'));
  it('"NOTEBOOK-ETI01" → corporate', () => expect(assessHostnameQuality('NOTEBOOK-ETI01')).toBe('corporate'));
  it('"WKS-CORP01" → corporate', () => expect(assessHostnameQuality('WKS-CORP01')).toBe('corporate'));
  it('"WORKSTATION-01" → corporate', () => expect(assessHostnameQuality('WORKSTATION-01')).toBe('corporate'));
  it('"DEVICE_1234" → corporate (tag suffix)', () => expect(assessHostnameQuality('DEVICE_1234')).toBe('corporate'));
  it('"ETI-1234" → corporate (tag suffix)', () => expect(assessHostnameQuality('ETI-1234')).toBe('corporate'));
});

// ── computeScore ──────────────────────────────────────────────────────────────

describe('computeScore — F6 scoring matrix', () => {
  it('equipment_tag_exact (valid tag + entity mapping) → 0.90, strong_candidate', () => {
    const signals = makeSignals({ tagQuality: 'valid', hasEntityMapping: true, entityId: 1 });
    const { score, baseStatus } = computeScore(signals);
    expect(score).toBe(SCORE_EQUIPMENT_TAG_EXACT);
    expect(baseStatus).toBe('strong_candidate');
  });

  it('hostname_plus_entity (corporate + entity) → 0.70, strong_candidate', () => {
    const signals = makeSignals({ hostnameQuality: 'corporate', hasEntityMapping: true, entityId: 1 });
    const { score, baseStatus } = computeScore(signals);
    expect(score).toBe(SCORE_HOSTNAME_PLUS_ENTITY);
    expect(baseStatus).toBe('strong_candidate');
  });

  it('hostname_only (corporate, no entity) → 0.40, weak_candidate', () => {
    const signals = makeSignals({ hostnameQuality: 'corporate', hasEntityMapping: false });
    const { score, baseStatus } = computeScore(signals);
    expect(score).toBe(SCORE_HOSTNAME_ONLY);
    expect(baseStatus).toBe('weak_candidate');
  });

  it('group_plus_entity (generic hostname + entity) → 0.30, weak_candidate', () => {
    const signals = makeSignals({ hostnameQuality: 'generic', hasEntityMapping: true, entityId: 1 });
    const { score, baseStatus } = computeScore(signals);
    expect(score).toBe(SCORE_GROUP_PLUS_ENTITY);
    expect(baseStatus).toBe('weak_candidate');
  });

  it('no_match (generic, no entity, no tag) → 0.00, no_match', () => {
    const signals = makeSignals({ hostnameQuality: 'generic', hasEntityMapping: false });
    const { score, baseStatus } = computeScore(signals);
    expect(score).toBe(SCORE_NO_MATCH);
    expect(baseStatus).toBe('no_match');
  });

  it('equipment_tag_exact precede hostname_plus_entity quando ambos aplicáveis', () => {
    const signals = makeSignals({
      tagQuality: 'valid',
      hostnameQuality: 'corporate',
      hasEntityMapping: true,
      entityId: 1,
    });
    const { score } = computeScore(signals);
    expect(score).toBe(SCORE_EQUIPMENT_TAG_EXACT); // tag wins
  });

  it('AMBIGUITY_THRESHOLD = 0.20', () => {
    expect(AMBIGUITY_THRESHOLD).toBe(0.20);
  });
});

// ── buildReason ───────────────────────────────────────────────────────────────

describe('buildReason — determinístico, sem PII', () => {
  const PII_PATTERNS = [/password|senha|token|bearer|api_key/i, /\d{11}/];

  it('strong_candidate contém "forte"', () => {
    const signals = makeSignals({ tagQuality: 'valid', hasEntityMapping: true, entityId: 1 });
    const reason = buildReason(signals, SCORE_EQUIPMENT_TAG_EXACT, 'strong_candidate');
    expect(reason.toLowerCase()).toContain('forte');
  });

  it('weak_candidate contém "fraco"', () => {
    const signals = makeSignals({ hostnameQuality: 'corporate', hasEntityMapping: false });
    const reason = buildReason(signals, SCORE_HOSTNAME_ONLY, 'weak_candidate');
    expect(reason.toLowerCase()).toContain('fraco');
  });

  it('no_match contém "nenhuma correspondência"', () => {
    const signals = makeSignals({});
    const reason = buildReason(signals, SCORE_NO_MATCH, 'no_match');
    expect(reason.toLowerCase()).toContain('nenhuma');
  });

  it('ambiguous menciona "ambiguidade"', () => {
    const signals = makeSignals({ tagQuality: 'valid', hasEntityMapping: true, entityId: 1 });
    const reason = buildReason(signals, SCORE_EQUIPMENT_TAG_EXACT, 'ambiguous');
    expect(reason.toLowerCase()).toContain('ambiguidade');
  });

  it('inclui porcentagem de score no texto', () => {
    const signals = makeSignals({ hostnameQuality: 'corporate', hasEntityMapping: true, entityId: 1 });
    const reason = buildReason(signals, SCORE_HOSTNAME_PLUS_ENTITY, 'strong_candidate');
    expect(reason).toContain('%');
  });

  it('nenhum texto contém PII', () => {
    const statuses = ['strong_candidate', 'weak_candidate', 'ambiguous', 'no_match'] as const;
    for (const status of statuses) {
      const signals = makeSignals({ tagQuality: 'valid', hasEntityMapping: true, entityId: 1 });
      const reason = buildReason(signals, 0.90, status);
      for (const p of PII_PATTERNS) {
        expect(reason).not.toMatch(p);
      }
    }
  });
});

// ── deriveSignals ─────────────────────────────────────────────────────────────

describe('deriveSignals', () => {
  it('host com tag válida e grupo mapeado → tagQuality=valid, hasEntityMapping=true', () => {
    const host = makeHost({ equipmentTag: '1234', groupExternalId: 'grp-001' });
    const entityMap = new Map([['grp-001', 5]]);
    const signals = deriveSignals(host, entityMap);
    expect(signals.tagQuality).toBe('valid');
    expect(signals.hasEntityMapping).toBe(true);
    expect(signals.entityId).toBe(5);
    expect(signals.entitySource).toBe('group_map');
  });

  it('host sem tag e grupo não mapeado → tagQuality=missing, hasEntityMapping=false', () => {
    const host = makeHost({ equipmentTag: null, groupExternalId: 'grp-999' });
    const entityMap = new Map<string, number>();
    const signals = deriveSignals(host, entityMap);
    expect(signals.tagQuality).toBe('missing');
    expect(signals.hasEntityMapping).toBe(false);
    expect(signals.entityId).toBeNull();
    expect(signals.entitySource).toBe('none');
  });

  it('hostname corporativo → hostnameQuality=corporate', () => {
    const host = makeHost({ hostName: 'DESKTOP-ETI01' });
    const signals = deriveSignals(host, new Map());
    expect(signals.hostnameQuality).toBe('corporate');
  });
});

// ── LogmeinAssetMatchingService — invariants ──────────────────────────────────

describe('LogmeinAssetMatchingService — invariantes absolutos', () => {
  beforeEach(() => {
    delete process.env['INVENTORY_RECONCILIATION_ENABLED'];
  });

  afterEach(() => {
    delete process.env['INVENTORY_RECONCILIATION_ENABLED'];
  });

  it('create_ticket === false em todo relatório (literal invariant)', () => {
    const svc = makeService();
    const report = svc.buildReport([], new Map());
    expect(report.create_ticket).toBe(false);
    expect(report.create_ticket).not.toBeTruthy();
  });

  it('real_mutation_forbidden === true em todo relatório (literal invariant)', () => {
    const svc = makeService();
    const report = svc.buildReport([], new Map());
    expect(report.real_mutation_forbidden).toBe(true);
  });

  it('feature_flag_enabled=false quando env não configurado', () => {
    delete process.env['INVENTORY_RECONCILIATION_ENABLED'];
    const svc = makeService();
    const report = svc.buildReport([], new Map());
    expect(report.feature_flag_enabled).toBe(false);
  });

  it('feature_flag_enabled=true quando INVENTORY_RECONCILIATION_ENABLED=true', () => {
    process.env['INVENTORY_RECONCILIATION_ENABLED'] = 'true';
    const svc = makeService();
    const report = svc.buildReport([], new Map());
    expect(report.feature_flag_enabled).toBe(true);
  });

  it('relatório sem hosts → total_hosts_evaluated=0, by_status zerado', () => {
    const svc = makeService();
    const report = svc.buildReport([], new Map());
    expect(report.total_hosts_evaluated).toBe(0);
    expect(report.by_status.strong_candidate).toBe(0);
    expect(report.by_status.weak_candidate).toBe(0);
    expect(report.by_status.ambiguous).toBe(0);
    expect(report.by_status.no_match).toBe(0);
  });

  it('cada candidato herda invariantes create_ticket=false, real_mutation_forbidden=true', () => {
    const svc = makeService();
    const hosts = [makeHost({ equipmentTag: '1234', groupExternalId: 'grp-001' })];
    const entityMap = new Map([['grp-001', 1]]);
    const report = svc.buildReport(hosts, entityMap);
    for (const c of report.candidates) {
      expect(c.create_ticket).toBe(false);
      expect(c.real_mutation_forbidden).toBe(true);
      expect(c.whatsAppSent).toBe(false);
    }
  });

  it('by_status soma total_hosts_evaluated', () => {
    const svc = makeService();
    const hosts = [
      makeHost({ externalId: 'h1', equipmentTag: '1234', groupExternalId: 'grp-001' }), // strong
      makeHost({ externalId: 'h2', equipmentTag: null, groupExternalId: 'grp-002' }),   // no_match or weak
    ];
    const entityMap = new Map([['grp-001', 1]]);
    const report = svc.buildReport(hosts, entityMap);
    const total = Object.values(report.by_status).reduce((a, b) => a + b, 0);
    expect(total).toBe(report.total_hosts_evaluated);
  });
});

// ── Ambiguity detection ───────────────────────────────────────────────────────

describe('LogmeinAssetMatchingService — ambiguity detection', () => {
  it('dois hosts com score diff < AMBIGUITY_THRESHOLD para mesma entidade → ambiguous', () => {
    const svc = makeService();
    // Both map to entity 1 via group, but h1 has a corporate hostname (0.70) and
    // h2 has a valid tag (0.90). Diff = 0.20 — equals threshold → NOT ambiguous.
    // Use diff < 0.20: give both score 0.70 by using corporate hostname + entity mapping.
    const hosts = [
      makeHost({
        externalId: 'h1',
        hostName: 'DESKTOP-ETI01',
        equipmentTag: null,
        groupExternalId: 'grp-001',
      }),
      makeHost({
        externalId: 'h2',
        hostName: 'NOTEBOOK-ETI02',
        equipmentTag: null,
        groupExternalId: 'grp-001',
      }),
    ];
    const entityMap = new Map([['grp-001', 1]]);
    const report = svc.buildReport(hosts, entityMap);
    // Both have score 0.70; diff = 0 < 0.20 → ambiguous.
    expect(report.candidates.every((c) => c.status === 'ambiguous')).toBe(true);
    expect(report.by_status.ambiguous).toBe(2);
  });

  it('candidato ambíguo tem alternatives não-vazio', () => {
    const svc = makeService();
    const hosts = [
      makeHost({ externalId: 'h1', hostName: 'DESKTOP-ETI01', equipmentTag: null, groupExternalId: 'grp-001' }),
      makeHost({ externalId: 'h2', hostName: 'NOTEBOOK-ETI02', equipmentTag: null, groupExternalId: 'grp-001' }),
    ];
    const entityMap = new Map([['grp-001', 1]]);
    const report = svc.buildReport(hosts, entityMap);
    const h1 = report.candidates.find((c) => c.hostId === 'h1');
    expect(h1).toBeDefined();
    expect(h1!.alternatives.length).toBeGreaterThan(0);
    expect(h1!.alternatives[0]!.hostId).toBe('h2');
  });

  it('hosts em grupos diferentes com mesmo score → NÃO são ambíguos entre si', () => {
    const svc = makeService();
    const hosts = [
      makeHost({ externalId: 'h1', hostName: 'DESKTOP-ETI01', equipmentTag: null, groupExternalId: 'grp-001' }),
      makeHost({ externalId: 'h2', hostName: 'NOTEBOOK-ETI02', equipmentTag: null, groupExternalId: 'grp-002' }),
    ];
    const entityMap = new Map([['grp-001', 1], ['grp-002', 2]]);
    const report = svc.buildReport(hosts, entityMap);
    // Diferent entities → no collision → strong_candidate, not ambiguous.
    expect(report.candidates.every((c) => c.status === 'strong_candidate')).toBe(true);
  });
});

// ── buildPreview ─────────────────────────────────────────────────────────────

describe('LogmeinAssetMatchingService.buildPreview — invariantes', () => {
  it('preview_only === true', () => {
    const svc = makeService();
    const p = svc.buildPreview('h1', 'DESKTOP', null, null, 5, 'manual_correction');
    expect(p.preview_only).toBe(true);
  });

  it('real_mutation_forbidden === true', () => {
    const svc = makeService();
    const p = svc.buildPreview('h1', 'DESKTOP', null, null, 5, 'manual_correction');
    expect(p.real_mutation_forbidden).toBe(true);
  });

  it('create_ticket === false', () => {
    const svc = makeService();
    const p = svc.buildPreview('h1', 'DESKTOP', null, null, 5, 'manual_correction');
    expect(p.create_ticket).toBe(false);
  });

  it('whatsAppSent === false', () => {
    const svc = makeService();
    const p = svc.buildPreview('h1', 'DESKTOP', null, null, 5, 'manual_correction');
    expect(p.whatsAppSent).toBe(false);
  });

  it('stateModified === false', () => {
    const svc = makeService();
    const p = svc.buildPreview('h1', 'DESKTOP', null, null, 5, 'manual_correction');
    expect(p.stateModified).toBe(false);
  });

  it('checklist não vazio e contém prefixo "[ ]"', () => {
    const svc = makeService();
    const p = svc.buildPreview('h1', 'DESKTOP', '1234', 1, 5, 'manual_correction');
    expect(Array.isArray(p.checklist)).toBe(true);
    expect(p.checklist.length).toBeGreaterThan(0);
    expect(p.checklist.some((item) => item.includes('[ ]'))).toBe(true);
  });

  it('before.entityId é o valor atual, after.entityId é o proposto', () => {
    const svc = makeService();
    const p = svc.buildPreview('h1', 'DESKTOP', null, 3, 7, 'manual_correction');
    expect(p.before.entityId).toBe(3);
    expect(p.after.entityId).toBe(7);
  });

  it('changes array não vazio quando há diferença', () => {
    const svc = makeService();
    const p = svc.buildPreview('h1', 'DESKTOP', null, 1, 5, 'manual_correction');
    expect(p.changes.length).toBeGreaterThan(0);
  });

  it('nenhum campo de preview contém PII (token, senha, IP)', () => {
    const piiPatterns = [/password|senha|token|bearer|api_key/i, /\d{11}/];
    const svc = makeService();
    const p = svc.buildPreview('h1', 'DESKTOP', '1234', null, 5, 'manual_correction');
    const json = JSON.stringify(p);
    for (const pattern of piiPatterns) {
      expect(json).not.toMatch(pattern);
    }
  });
});

// ── PII check — full report ───────────────────────────────────────────────────

describe('PII — nenhum campo sensível no relatório completo', () => {
  const PII_PATTERNS = [/password|senha|token|bearer|api_key|mac_address|local_ip/i, /\d{11}/];

  it('relatório com candidatos não contém PII', () => {
    const svc = makeService();
    const hosts = [
      makeHost({ externalId: 'h1', hostName: 'DESKTOP-ETI01', equipmentTag: '1234', groupExternalId: 'grp-001' }),
      makeHost({ externalId: 'h2', equipmentTag: null, groupExternalId: 'grp-002' }),
    ];
    const entityMap = new Map([['grp-001', 1]]);
    const report = svc.buildReport(hosts, entityMap);
    const json = JSON.stringify(report);
    for (const p of PII_PATTERNS) {
      expect(json).not.toMatch(p);
    }
  });
});
