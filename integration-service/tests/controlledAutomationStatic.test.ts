/**
 * Controlled Automation — Static Unit Tests (F5)
 *
 * Validação de invariantes sem acesso externo:
 *   - real_execution_forbidden: true — literal invariant em toda resposta
 *   - human_review_checkbox_required: true — sempre verdadeiro
 *   - create_ticket: false — literal invariant
 *   - whatsAppSent: false — literal invariant
 *   - stateModified: false — literal invariant
 *   - blocked_this_phase: restart_logmein_agent, create_maintenance_ticket, send_whatsapp_alert
 *   - advisory_only: suppress_alarm_rule, update_equipment_tag
 *   - preview_allowed: run_disk_check, run_rule_test, generate_coverage_report
 *   - feature_disabled quando CONTROLLED_AUTOMATION_ENABLED=false (default)
 *   - getActionMatrix() retorna matriz sem ações bloqueadas como advisory
 *
 * Phase: integaglpi_v9_controlled_automation_001 — F5
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  ControlledAutomationService,
  type AutomationActionType,
} from '../src/domain/services/ControlledAutomationService.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeService(): ControlledAutomationService {
  return new ControlledAutomationService();
}

const BLOCKED_ACTIONS: AutomationActionType[] = [
  'restart_logmein_agent',
  'create_maintenance_ticket',
  'send_whatsapp_alert',
];

const ADVISORY_ONLY_ACTIONS: AutomationActionType[] = [
  'suppress_alarm_rule',
  'update_equipment_tag',
];

const PREVIEW_ALLOWED_ACTIONS: AutomationActionType[] = [
  'run_disk_check',
  'run_rule_test',
  'generate_coverage_report',
];

// ── Invariants — absolute safety ──────────────────────────────────────────────

describe('ControlledAutomationService — safety invariants absolutos', () => {
  let svc: ControlledAutomationService;
  const ALL_ACTIONS: AutomationActionType[] = [
    ...BLOCKED_ACTIONS,
    ...ADVISORY_ONLY_ACTIONS,
    ...PREVIEW_ALLOWED_ACTIONS,
  ];

  beforeEach(() => {
    process.env['CONTROLLED_AUTOMATION_ENABLED'] = 'true'; // test with feature on
    svc = makeService();
  });

  afterEach(() => {
    delete process.env['CONTROLLED_AUTOMATION_ENABLED'];
  });

  it('real_execution_forbidden === true em TODAS as ações', () => {
    for (const action of ALL_ACTIONS) {
      const result = svc.generateAdvisory(action);
      expect(result.real_execution_forbidden).toBe(true);
      expect(result.real_execution_forbidden).not.toBeFalsy();
    }
  });

  it('human_review_checkbox_required === true em TODAS as ações', () => {
    for (const action of ALL_ACTIONS) {
      const result = svc.generateAdvisory(action);
      expect(result.human_review_checkbox_required).toBe(true);
    }
  });

  it('create_ticket === false em TODAS as ações (literal)', () => {
    for (const action of ALL_ACTIONS) {
      const result = svc.generateAdvisory(action);
      expect(result.create_ticket).toBe(false);
      expect(result.create_ticket).not.toBeTruthy();
    }
  });

  it('whatsAppSent === false em TODAS as ações', () => {
    for (const action of ALL_ACTIONS) {
      const result = svc.generateAdvisory(action);
      expect(result.whatsAppSent).toBe(false);
    }
  });

  it('stateModified === false em TODAS as ações', () => {
    for (const action of ALL_ACTIONS) {
      const result = svc.generateAdvisory(action);
      expect(result.stateModified).toBe(false);
    }
  });

  it('nenhuma advisory contém PII (tokens, senhas, telefones)', () => {
    const piiPatterns = [/password|senha|token|bearer/i, /\d{11}/];
    for (const action of ALL_ACTIONS) {
      const json = JSON.stringify(svc.generateAdvisory(action));
      for (const p of piiPatterns) {
        expect(json).not.toMatch(p);
      }
    }
  });
});

// ── Feature flag ───────────────────────────────────────────────────────────────

describe('feature flag CONTROLLED_AUTOMATION_ENABLED', () => {
  afterEach(() => {
    delete process.env['CONTROLLED_AUTOMATION_ENABLED'];
  });

  it('status === feature_disabled quando env não configurado', () => {
    delete process.env['CONTROLLED_AUTOMATION_ENABLED'];
    const svc = makeService();
    const r = svc.generateAdvisory('suppress_alarm_rule');
    expect(r.status).toBe('feature_disabled');
  });

  it('status === feature_disabled quando CONTROLLED_AUTOMATION_ENABLED=false', () => {
    process.env['CONTROLLED_AUTOMATION_ENABLED'] = 'false';
    const svc = makeService();
    const r = svc.generateAdvisory('suppress_alarm_rule');
    expect(r.status).toBe('feature_disabled');
  });

  it('invariantes de segurança mantidos mesmo no estado feature_disabled', () => {
    delete process.env['CONTROLLED_AUTOMATION_ENABLED'];
    const svc = makeService();
    const r = svc.generateAdvisory('restart_logmein_agent');
    expect(r.real_execution_forbidden).toBe(true);
    expect(r.create_ticket).toBe(false);
    expect(r.whatsAppSent).toBe(false);
    expect(r.stateModified).toBe(false);
  });
});

// ── Action matrix — blocked ────────────────────────────────────────────────────

describe('BLOCKED_THIS_PHASE — não negociável', () => {
  beforeEach(() => {
    process.env['CONTROLLED_AUTOMATION_ENABLED'] = 'true';
  });

  afterEach(() => {
    delete process.env['CONTROLLED_AUTOMATION_ENABLED'];
  });

  for (const action of BLOCKED_ACTIONS) {
    it(`${action} → status=blocked, actionClass=blocked_this_phase`, () => {
      const svc = makeService();
      const r = svc.generateAdvisory(action);
      expect(r.status).toBe('blocked');
      expect(r.actionClass).toBe('blocked_this_phase');
      expect(r.checklist).toBeNull();
      expect(r.estimatedImpact).toBeNull();
    });
  }

  it('advisoryText de ações bloqueadas explica o bloqueio', () => {
    const svc = makeService();
    for (const action of BLOCKED_ACTIONS) {
      const r = svc.generateAdvisory(action);
      expect(r.advisoryText.length).toBeGreaterThan(20);
      expect(r.advisoryText.toLowerCase()).toMatch(/não é permitid[oa]|não.*autom|bloqueada/i);
    }
  });
});

// ── Action matrix — advisory_only ─────────────────────────────────────────────

describe('ADVISORY_ONLY — requer aprovação humana', () => {
  beforeEach(() => {
    process.env['CONTROLLED_AUTOMATION_ENABLED'] = 'true';
  });

  afterEach(() => {
    delete process.env['CONTROLLED_AUTOMATION_ENABLED'];
  });

  for (const action of ADVISORY_ONLY_ACTIONS) {
    it(`${action} → status=advisory, actionClass=advisory_only`, () => {
      const svc = makeService();
      const r = svc.generateAdvisory(action);
      expect(r.status).toBe('advisory');
      expect(r.actionClass).toBe('advisory_only');
      expect(Array.isArray(r.checklist)).toBe(true);
      expect(r.checklist!.length).toBeGreaterThan(0);
      expect(typeof r.estimatedImpact).toBe('string');
    });
  }

  it('checklist contém prefixo de checkbox "[ ]"', () => {
    const svc = makeService();
    for (const action of ADVISORY_ONLY_ACTIONS) {
      const r = svc.generateAdvisory(action);
      expect(r.checklist!.some((item) => item.includes('[ ]'))).toBe(true);
    }
  });

  it('advisory inclui aviso sobre aprovação humana', () => {
    const svc = makeService();
    for (const action of ADVISORY_ONLY_ACTIONS) {
      const r = svc.generateAdvisory(action);
      expect(r.advisoryText.toLowerCase()).toMatch(/aprovação|obrigatório|nenhuma.*feita|nenhuma.*executada/i);
    }
  });
});

// ── Action matrix — preview_allowed ───────────────────────────────────────────

describe('PREVIEW_ALLOWED — simulação sem efeitos', () => {
  beforeEach(() => {
    process.env['CONTROLLED_AUTOMATION_ENABLED'] = 'true';
  });

  afterEach(() => {
    delete process.env['CONTROLLED_AUTOMATION_ENABLED'];
  });

  for (const action of PREVIEW_ALLOWED_ACTIONS) {
    it(`${action} → status=preview, actionClass=preview_allowed`, () => {
      const svc = makeService();
      const r = svc.generateAdvisory(action);
      expect(r.status).toBe('preview');
      expect(r.actionClass).toBe('preview_allowed');
      expect(Array.isArray(r.checklist)).toBe(true);
      expect(typeof r.estimatedImpact).toBe('string');
    });
  }

  it('preview de run_disk_check menciona "zero impacto"', () => {
    const svc = makeService();
    const r = svc.generateAdvisory('run_disk_check');
    expect(r.estimatedImpact!.toLowerCase()).toContain('zero');
  });

  it('preview de run_rule_test menciona simulação estática', () => {
    const svc = makeService();
    const r = svc.generateAdvisory('run_rule_test');
    expect(r.advisoryText.toLowerCase()).toContain('simulação');
  });
});

// ── Signals ───────────────────────────────────────────────────────────────────

describe('Signals — contexto no advisory', () => {
  beforeEach(() => {
    process.env['CONTROLLED_AUTOMATION_ENABLED'] = 'true';
  });

  afterEach(() => {
    delete process.env['CONTROLLED_AUTOMATION_ENABLED'];
  });

  it('alarmType passado via signals aparece no advisory text', () => {
    const svc = makeService();
    const r = svc.generateAdvisory('suppress_alarm_rule', { alarmType: 'host_offline' });
    expect(r.advisoryText).toContain('host_offline');
  });

  it('hostId passado via signals aparece no advisory text', () => {
    const svc = makeService();
    const r = svc.generateAdvisory('run_disk_check', { hostId: 'HOST-ABC' });
    expect(r.advisoryText).toContain('HOST-ABC');
  });

  it('signals sem valores → advisory text genérico sem erros', () => {
    const svc = makeService();
    const r = svc.generateAdvisory('suppress_alarm_rule', {});
    expect(typeof r.advisoryText).toBe('string');
    expect(r.advisoryText.length).toBeGreaterThan(0);
  });
});

// ── getActionMatrix ───────────────────────────────────────────────────────────

describe('getActionMatrix — introspection', () => {
  it('retorna objeto com todas as ações', () => {
    const svc = makeService();
    const matrix = svc.getActionMatrix();
    const expectedActions = [
      ...BLOCKED_ACTIONS,
      ...ADVISORY_ONLY_ACTIONS,
      ...PREVIEW_ALLOWED_ACTIONS,
    ];
    for (const action of expectedActions) {
      expect(action in matrix).toBe(true);
    }
  });

  it('ações bloqueadas têm class blocked_this_phase', () => {
    const svc = makeService();
    const matrix = svc.getActionMatrix();
    for (const action of BLOCKED_ACTIONS) {
      expect(matrix[action]).toBe('blocked_this_phase');
    }
  });

  it('ações advisory têm class advisory_only', () => {
    const svc = makeService();
    const matrix = svc.getActionMatrix();
    for (const action of ADVISORY_ONLY_ACTIONS) {
      expect(matrix[action]).toBe('advisory_only');
    }
  });

  it('ações preview têm class preview_allowed', () => {
    const svc = makeService();
    const matrix = svc.getActionMatrix();
    for (const action of PREVIEW_ALLOWED_ACTIONS) {
      expect(matrix[action]).toBe('preview_allowed');
    }
  });

  it('retorna cópia — mutação não afeta o original', () => {
    const svc = makeService();
    const matrix1 = svc.getActionMatrix();
    (matrix1 as Record<string, string>)['suppress_alarm_rule'] = 'blocked_this_phase';
    const matrix2 = svc.getActionMatrix();
    expect(matrix2['suppress_alarm_rule']).toBe('advisory_only');
  });
});
