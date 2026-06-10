/**
 * ControlledAutomationService — F5 Controlled Automation (Advisory-Only)
 *
 * Advisory-only preview system. No real execution of any kind.
 * All action types are classified in the action matrix as:
 *   - advisory_only    : returns advisory text; no execution; human review required.
 *   - preview_allowed  : returns sanitized preview of what would happen; no side effects.
 *   - blocked_this_phase: always returns BLOCKED; no preview; not negotiable.
 *
 * Safety invariants (F5 contract — ABSOLUTE — hardcoded, not configurable):
 *   - real_execution_forbidden: true  (literal, never changes)
 *   - human_review_checkbox_required: true (PHP layer enforces)
 *   - no_ticket_creation: true
 *   - no_whatsapp_send: true
 *   - no_remote_session: true
 *   - no_glpi_asset_mutation: true
 *   - no_llm_executor: true
 *   - no_schema_change: true
 *   - audit_required: true
 *
 * Feature flag CONTROLLED_AUTOMATION_ENABLED=false:
 *   When false, all requests return { status: 'feature_disabled' } without processing.
 *
 * Phase: integaglpi_v9_controlled_automation_001 — F5
 */

import { env } from '../../config/env.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AutomationActionClass =
  | 'advisory_only'
  | 'preview_allowed'
  | 'blocked_this_phase';

export type AutomationActionType =
  | 'suppress_alarm_rule'
  | 'update_equipment_tag'
  | 'run_disk_check'
  | 'run_rule_test'
  | 'generate_coverage_report'
  | 'restart_logmein_agent'
  | 'create_maintenance_ticket'
  | 'send_whatsapp_alert';

/** Signals that the automation service can accept for advisory generation. */
export interface AutomationSignals {
  /** Alarm type that triggered the advisory request (optional). */
  alarmType?: string | null;
  /** Host ID for context (optional — no PII). */
  hostId?: string | null;
  /** Rule UUID for context (optional). */
  ruleId?: string | null;
  /** Arbitrary metadata (sanitized by caller). */
  metadata?: Record<string, string | number | boolean | null> | null;
}

export interface AdvisoryResult {
  /** Always false — immutable F5 invariant. */
  readonly real_execution_forbidden: true;
  /** Always true — human review is required before any action. */
  readonly human_review_checkbox_required: true;
  status: 'advisory' | 'preview' | 'blocked' | 'feature_disabled';
  actionType: AutomationActionType;
  actionClass: AutomationActionClass;
  /** Human-readable advisory text (deterministic — no LLM). */
  advisoryText: string;
  /** Step-by-step checklist for human review (null when blocked/disabled). */
  checklist: string[] | null;
  /** Estimated impact description (null when blocked/disabled). */
  estimatedImpact: string | null;
  /** Always false — never changes. */
  readonly create_ticket: false;
  /** Always false — never changes. */
  readonly whatsAppSent: false;
  /** Always false — never changes. */
  readonly stateModified: false;
}

// ── Action matrix ─────────────────────────────────────────────────────────────

/**
 * The action matrix is the source of truth for what can and cannot be done.
 * It is evaluated in code — not in configuration.
 * Adding an entry here requires a cursor-reviewed commit.
 */
const ACTION_MATRIX: Record<AutomationActionType, AutomationActionClass> = {
  // Advisory only — human must review before any manual action.
  suppress_alarm_rule: 'advisory_only',
  update_equipment_tag: 'advisory_only',

  // Preview allowed — shows what would happen, no side effects.
  run_disk_check: 'preview_allowed',
  run_rule_test: 'preview_allowed',
  generate_coverage_report: 'preview_allowed',

  // Blocked this phase — not negotiable.
  restart_logmein_agent: 'blocked_this_phase',
  create_maintenance_ticket: 'blocked_this_phase',
  send_whatsapp_alert: 'blocked_this_phase',
};

// ── Advisory text builders ─────────────────────────────────────────────────────

function buildAdvisoryText(
  actionType: AutomationActionType,
  actionClass: AutomationActionClass,
  signals: AutomationSignals,
): string {
  if (actionClass === 'blocked_this_phase') {
    const reason: Record<AutomationActionType, string> = {
      restart_logmein_agent:
        'Reiniciar agente LogMeIn via automação remota não é permitido nesta fase. Acesse o console LogMeIn manualmente.',
      create_maintenance_ticket:
        'Criação automática de ticket não é permitida. Crie o ticket manualmente no GLPI.',
      send_whatsapp_alert:
        'Envio de mensagem WhatsApp não é permitido via automação. Use o canal manual.',
      suppress_alarm_rule: 'BLOCKED',
      update_equipment_tag: 'BLOCKED',
      run_disk_check: 'BLOCKED',
      run_rule_test: 'BLOCKED',
      generate_coverage_report: 'BLOCKED',
    };
    return reason[actionType] ?? `Ação "${actionType}" bloqueada nesta fase.`;
  }

  const alarmContext = signals.alarmType ? ` para alarme "${signals.alarmType}"` : '';
  const hostContext = signals.hostId ? ` no host "${signals.hostId}"` : '';

  switch (actionType) {
    case 'suppress_alarm_rule':
      return (
        `AVISO: Suprimir uma regra de alarme${alarmContext}${hostContext} irá parar o monitoramento ` +
        `para esse tipo de evento. Revise a configuração de cooldown antes de suprimir. ` +
        `Nenhuma alteração foi feita — aprovação humana obrigatória.`
      );
    case 'update_equipment_tag':
      return (
        `AVISO: Atualizar o equipment_tag${hostContext} afeta a conciliação LogMeIn ↔ GLPI. ` +
        `Verifique o tag correto no GLPI antes de aplicar. ` +
        `Nenhuma alteração foi feita — aprovação humana obrigatória.`
      );
    case 'run_disk_check':
      return (
        `Preview de verificação de disco${hostContext}. ` +
        `Resultado simulado com dados de inventário de hardware disponíveis. ` +
        `Nenhuma ação executada.`
      );
    case 'run_rule_test':
      return (
        `Preview de teste de regra${alarmContext}${hostContext}. ` +
        `Simulação estática — nenhuma regra modificada, nenhum evento gerado.`
      );
    case 'generate_coverage_report':
      return (
        `Preview de relatório de cobertura LogMeIn ↔ GLPI. ` +
        `Dados de gaps de mapeamento (sem PII). Nenhuma alteração.`
      );
    default:
      return `Advisory para ação "${actionType}"${alarmContext}${hostContext}. Nenhuma alteração executada.`;
  }
}

function buildChecklist(
  actionType: AutomationActionType,
  actionClass: AutomationActionClass,
): string[] | null {
  if (actionClass === 'blocked_this_phase') return null;

  switch (actionType) {
    case 'suppress_alarm_rule':
      return [
        '[ ] Confirmar que o alarme é um falso positivo recorrente',
        '[ ] Verificar cooldown configurado (cooldown_minutes)',
        '[ ] Documentar motivo da supressão no ticket GLPI correspondente',
        '[ ] Revisar regra em 7 dias para reativação',
        '[ ] Aprovar manualmente no painel de regras LogMeIn',
      ];
    case 'update_equipment_tag':
      return [
        '[ ] Confirmar equipment_tag correto no GLPI (campo "Número de série" ou custom field)',
        '[ ] Verificar que o host não tem mapeamento duplicado',
        '[ ] Atualizar tag via interface LogMeIn (campo Custom Field)',
        '[ ] Aguardar próximo ciclo de sincronização (mín. 15 min)',
        '[ ] Verificar conciliação no relatório de cobertura',
      ];
    case 'run_disk_check':
      return [
        '[ ] Verificar partição com menor espaço livre',
        '[ ] Confirmar threshold de alerta configurado na regra',
        '[ ] Se crítico: acionar técnico responsável pelo host',
        '[ ] Resultado desta simulação é baseado nos dados de hardware inventariados',
      ];
    case 'run_rule_test':
      return [
        '[ ] Revisar parâmetros da regra (threshold, cooldown, consecutive checks)',
        '[ ] Confirmar que o host de teste é representativo',
        '[ ] Resultado é uma simulação estática — não reflete estado em tempo real',
      ];
    case 'generate_coverage_report':
      return [
        '[ ] Revisar hosts sem mapeamento de entidade GLPI',
        '[ ] Revisar grupos sem mapeamento de entidade',
        '[ ] Revisar hosts sem equipment_tag',
        '[ ] Acionar responsável pela conciliação LogMeIn ↔ GLPI',
      ];
    default:
      return ['[ ] Revisar ação antes de executar manualmente'];
  }
}

function buildEstimatedImpact(
  actionType: AutomationActionType,
  actionClass: AutomationActionClass,
): string | null {
  if (actionClass === 'blocked_this_phase') return null;

  switch (actionType) {
    case 'suppress_alarm_rule':
      return 'Interrupção do monitoramento para esse tipo de alarme até reativação manual.';
    case 'update_equipment_tag':
      return 'Melhora a taxa de conciliação LogMeIn ↔ GLPI. Sem impacto operacional imediato.';
    case 'run_disk_check':
      return 'Zero impacto — leitura de dados de inventário já coletados.';
    case 'run_rule_test':
      return 'Zero impacto — simulação estática sem efeitos colaterais.';
    case 'generate_coverage_report':
      return 'Zero impacto — relatório de leitura.';
    default:
      return 'Impacto desconhecido — avaliar antes de executar.';
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export class ControlledAutomationService {
  /**
   * Generate an advisory for the requested action type.
   *
   * Never executes any action. All invariants are enforced at the code level,
   * not at the configuration level.
   */
  public generateAdvisory(
    actionType: AutomationActionType,
    signals: AutomationSignals = {},
  ): AdvisoryResult {
    const featureFlagEnabled = env.CONTROLLED_AUTOMATION_ENABLED;

    if (!featureFlagEnabled) {
      return {
        real_execution_forbidden: true,
        human_review_checkbox_required: true,
        status: 'feature_disabled',
        actionType,
        actionClass: ACTION_MATRIX[actionType],
        advisoryText: 'Automação controlada desabilitada (CONTROLLED_AUTOMATION_ENABLED=false).',
        checklist: null,
        estimatedImpact: null,
        create_ticket: false,
        whatsAppSent: false,
        stateModified: false,
      };
    }

    const actionClass = ACTION_MATRIX[actionType];
    const advisoryText = buildAdvisoryText(actionType, actionClass, signals);
    const checklist = buildChecklist(actionType, actionClass);
    const estimatedImpact = buildEstimatedImpact(actionType, actionClass);

    const status =
      actionClass === 'blocked_this_phase'
        ? 'blocked'
        : actionClass === 'preview_allowed'
          ? 'preview'
          : 'advisory';

    return {
      real_execution_forbidden: true,
      human_review_checkbox_required: true,
      status,
      actionType,
      actionClass,
      advisoryText,
      checklist,
      estimatedImpact,
      create_ticket: false,
      whatsAppSent: false,
      stateModified: false,
    };
  }

  /**
   * List all available action types and their matrix classification.
   * Read-only introspection — no side effects.
   */
  public getActionMatrix(): Record<AutomationActionType, AutomationActionClass> {
    // Return a copy to prevent mutation.
    return { ...ACTION_MATRIX };
  }
}
