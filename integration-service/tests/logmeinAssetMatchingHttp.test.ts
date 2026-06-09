/**
 * Reconciliation Controller — Static HTTP Tests (F6)
 *
 * Testa os 3 controllers como funções puras (sem framework real):
 *   1. createReconciliationMatchingReportController
 *   2. createReconciliationCoverageGapsController
 *   3. createReconciliationPreviewController
 *
 * Invariantes verificadas:
 *   - create_ticket: false em toda resposta
 *   - real_mutation_forbidden: true em toda resposta
 *   - read_only: true em toda resposta
 *   - Erros de serviço → 500, sem raw error exposto
 *   - Parâmetros inválidos em preview → 400
 *
 * Phase: integaglpi_v9_inventory_reconciliation_001 — F6
 */

import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

import {
  createReconciliationMatchingReportController,
  createReconciliationCoverageGapsController,
  createReconciliationPreviewController,
} from '../src/controllers/reconciliation.controller.js';

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeRes() {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnThis();
  return { json, status } as unknown as Response;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return { query: {}, body: {}, params: {}, ...overrides } as Request;
}

function getJsonArg(res: Response): Record<string, unknown> {
  return (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
}

function getStatusArg(res: Response): number {
  return (res.status as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
}

// ── Fake data ─────────────────────────────────────────────────────────────────

const fakeReport = {
  schema_version: '1.0',
  phase: 'integaglpi_v9_inventory_reconciliation_001',
  feature_flag_enabled: false,
  generated_at: '2026-06-09T00:00:00.000Z',
  total_hosts_evaluated: 2,
  by_status: { strong_candidate: 1, weak_candidate: 0, ambiguous: 0, no_match: 1 },
  candidates: [],
  create_ticket: false as const,
  real_mutation_forbidden: true as const,
  readonly_note: 'Read-only.',
};

const fakePreview = {
  schema_version: '1.0',
  phase: 'integaglpi_v9_inventory_reconciliation_001',
  preview_only: true as const,
  real_mutation_forbidden: true as const,
  create_ticket: false as const,
  whatsAppSent: false as const,
  stateModified: false as const,
  hostId: 'h1',
  before: { hostId: 'h1', hostName: 'DESKTOP', equipmentTag: null, entityId: null, entitySource: 'none', matchStatus: 'no_match' },
  after: { hostId: 'h1', hostName: 'DESKTOP', equipmentTag: null, entityId: 5, entitySource: 'manual_correction', matchStatus: 'weak_candidate' },
  changes: ['Entidade: sem mapeamento → 5 (via manual_correction)'],
  checklist: ['[ ] Confirmar entidade'],
  audit_note: 'Preview gerado via F6.',
};

const fakeCoverage = {
  entries: [],
  total: 0,
  limit: 100,
  offset: 0,
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    matchingService: {
      buildReport: vi.fn().mockReturnValue(fakeReport),
      buildPreview: vi.fn().mockReturnValue(fakePreview),
    },
    readonlyRepository: {
      listHostsForMatching: vi.fn().mockResolvedValue([]),
      listGroupEntityMaps: vi.fn().mockResolvedValue([]),
      listHostsWithoutTag: vi.fn().mockResolvedValue(fakeCoverage),
      listGroupsWithoutEntity: vi.fn().mockResolvedValue(fakeCoverage),
      countHostsForMatching: vi.fn().mockResolvedValue(10),
    },
    ...overrides,
  };
}

// ── 1. Matching report controller ─────────────────────────────────────────────

describe('createReconciliationMatchingReportController', () => {
  it('200 com relatório e invariantes', async () => {
    const deps = makeDeps();
    const ctrl = createReconciliationMatchingReportController(deps as never);
    const res = makeRes();

    await ctrl(makeReq(), res);

    expect(getStatusArg(res)).toBe(200);
    const body = getJsonArg(res);
    expect(body['ok']).toBe(true);
    expect(body['read_only']).toBe(true);
    const report = body['report'] as Record<string, unknown>;
    expect(report['create_ticket']).toBe(false);
    expect(report['real_mutation_forbidden']).toBe(true);
  });

  it('repositórios chamados com limit/offset dos query params', async () => {
    const deps = makeDeps();
    const ctrl = createReconciliationMatchingReportController(deps as never);
    const req = makeReq({ query: { limit: '200', offset: '100' } });
    const res = makeRes();

    await ctrl(req, res);

    expect((deps.readonlyRepository as Record<string, ReturnType<typeof vi.fn>>)['listHostsForMatching']).toHaveBeenCalledWith(200, 100);
  });

  it('500 quando repositório lança exceção — raw error não exposto', async () => {
    const deps = makeDeps({
      readonlyRepository: {
        listHostsForMatching: vi.fn().mockRejectedValue(new Error('DB_SECRET: connection refused')),
        listGroupEntityMaps: vi.fn().mockResolvedValue([]),
        listHostsWithoutTag: vi.fn().mockResolvedValue(fakeCoverage),
        listGroupsWithoutEntity: vi.fn().mockResolvedValue(fakeCoverage),
        countHostsForMatching: vi.fn().mockResolvedValue(0),
      },
    });
    const ctrl = createReconciliationMatchingReportController(deps as never);
    const res = makeRes();

    await ctrl(makeReq(), res);

    expect(getStatusArg(res)).toBe(500);
    const body = getJsonArg(res);
    expect(body['ok']).toBe(false);
    expect(JSON.stringify(body)).not.toContain('DB_SECRET');
    expect(JSON.stringify(body)).not.toContain('connection refused');
    expect(body['create_ticket']).toBe(false);
    expect(body['real_mutation_forbidden']).toBe(true);
  });
});

// ── 2. Coverage gaps controller ───────────────────────────────────────────────

describe('createReconciliationCoverageGapsController', () => {
  it('200 com lacunas de cobertura e invariantes', async () => {
    const deps = makeDeps();
    const ctrl = createReconciliationCoverageGapsController(deps as never);
    const res = makeRes();

    await ctrl(makeReq(), res);

    expect(getStatusArg(res)).toBe(200);
    const body = getJsonArg(res);
    expect(body['ok']).toBe(true);
    expect(body['read_only']).toBe(true);
    expect(body['create_ticket']).toBe(false);
    expect(body['real_mutation_forbidden']).toBe(true);
    const gaps = body['coverage_gaps'] as Record<string, unknown>;
    expect(gaps).toBeDefined();
    expect(gaps['total_hosts']).toBe(10);
  });

  it('500 quando repositório lança exceção — raw error não exposto', async () => {
    const deps = makeDeps({
      readonlyRepository: {
        listHostsWithoutTag: vi.fn().mockRejectedValue(new Error('COVERAGE_SECRET')),
        listGroupsWithoutEntity: vi.fn().mockRejectedValue(new Error('COVERAGE_SECRET')),
        countHostsForMatching: vi.fn().mockRejectedValue(new Error('COVERAGE_SECRET')),
        listHostsForMatching: vi.fn().mockResolvedValue([]),
        listGroupEntityMaps: vi.fn().mockResolvedValue([]),
      },
    });
    const ctrl = createReconciliationCoverageGapsController(deps as never);
    const res = makeRes();

    await ctrl(makeReq(), res);

    expect(getStatusArg(res)).toBe(500);
    const body = getJsonArg(res);
    expect(body['ok']).toBe(false);
    expect(JSON.stringify(body)).not.toContain('COVERAGE_SECRET');
    expect(body['create_ticket']).toBe(false);
    expect(body['real_mutation_forbidden']).toBe(true);
  });
});

// ── 3. Preview controller ─────────────────────────────────────────────────────

describe('createReconciliationPreviewController', () => {
  const validBody = {
    host_id: 'h1',
    host_name: 'DESKTOP-ETI01',
    current_tag: '1234',
    current_entity_id: 1,
    proposed_entity_id: 5,
    proposed_entity_source: 'manual_correction',
  };

  it('200 com preview e invariantes', async () => {
    const deps = makeDeps();
    const ctrl = createReconciliationPreviewController(deps as never);
    const req = makeReq({ body: validBody });
    const res = makeRes();

    await ctrl(req, res);

    expect(getStatusArg(res)).toBe(200);
    const body = getJsonArg(res);
    expect(body['ok']).toBe(true);
    expect(body['read_only']).toBe(true);
    const preview = body['preview'] as Record<string, unknown>;
    expect(preview['preview_only']).toBe(true);
    expect(preview['real_mutation_forbidden']).toBe(true);
    expect(preview['create_ticket']).toBe(false);
    expect(preview['whatsAppSent']).toBe(false);
    expect(preview['stateModified']).toBe(false);
  });

  it('buildPreview chamado com valores corretos', async () => {
    const deps = makeDeps();
    const ctrl = createReconciliationPreviewController(deps as never);
    const req = makeReq({ body: validBody });
    const res = makeRes();

    await ctrl(req, res);

    expect((deps.matchingService as Record<string, ReturnType<typeof vi.fn>>)['buildPreview']).toHaveBeenCalledWith(
      'h1',
      'DESKTOP-ETI01',
      '1234',
      1,
      5,
      'manual_correction',
    );
  });

  it('400 quando host_id ausente', async () => {
    const deps = makeDeps();
    const ctrl = createReconciliationPreviewController(deps as never);
    const req = makeReq({ body: { host_name: 'DESKTOP', proposed_entity_id: 5 } });
    const res = makeRes();

    await ctrl(req, res);

    expect(getStatusArg(res)).toBe(400);
    const body = getJsonArg(res);
    expect(body['status']).toBe('invalid_body');
    expect(body['create_ticket']).toBe(false);
    expect(body['real_mutation_forbidden']).toBe(true);
  });

  it('400 quando proposed_entity_id ausente ou 0', async () => {
    const deps = makeDeps();
    const ctrl = createReconciliationPreviewController(deps as never);
    const req = makeReq({ body: { host_id: 'h1', host_name: 'DESKTOP', proposed_entity_id: 0 } });
    const res = makeRes();

    await ctrl(req, res);

    expect(getStatusArg(res)).toBe(400);
  });

  it('400 quando host_name ausente', async () => {
    const deps = makeDeps();
    const ctrl = createReconciliationPreviewController(deps as never);
    const req = makeReq({ body: { host_id: 'h1', proposed_entity_id: 5 } });
    const res = makeRes();

    await ctrl(req, res);

    expect(getStatusArg(res)).toBe(400);
  });

  it('500 quando serviço lança exceção — raw error não exposto', async () => {
    const deps = makeDeps({
      matchingService: {
        buildReport: vi.fn(),
        buildPreview: vi.fn().mockImplementation(() => {
          throw new Error('PREVIEW_SECRET');
        }),
      },
    });
    const ctrl = createReconciliationPreviewController(deps as never);
    const req = makeReq({ body: validBody });
    const res = makeRes();

    await ctrl(req, res);

    expect(getStatusArg(res)).toBe(500);
    expect(JSON.stringify(getJsonArg(res))).not.toContain('PREVIEW_SECRET');
    expect(getJsonArg(res)['create_ticket']).toBe(false);
    expect(getJsonArg(res)['real_mutation_forbidden']).toBe(true);
  });
});
