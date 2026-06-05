import {
  COPILOT_TONES,
  COPILOT_WINDOW_NOTICES,
  type CopilotDraftResult,
  type CopilotTone,
  type CopilotWindowNotice,
} from './copilotTypes.js';
import { sanitizeAiQualityText } from './sanitizeAiQualityInput.js';

function truncate(value: unknown, max: number): string {
  return sanitizeAiQualityText(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => truncate(item, maxChars))
    .filter((item) => item !== '')
    .slice(0, maxItems);
}

function isTone(value: unknown): value is CopilotTone {
  return COPILOT_TONES.includes(value as CopilotTone);
}

function isWindowNotice(value: unknown): value is CopilotWindowNotice {
  return COPILOT_WINDOW_NOTICES.includes(value as CopilotWindowNotice);
}

function normalizeTone(value: unknown): CopilotTone {
  if (isTone(value)) {
    return value;
  }

  const text = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/friendly|amigavel|humano|cordial/.test(text)) {
    return 'friendly';
  }
  if (/technical|tecnico|tecnica/.test(text)) {
    return 'technical';
  }
  if (/concise|curt|objetiv/.test(text)) {
    return 'concise';
  }

  return 'neutral';
}

function normalizeWindowNotice(value: unknown): CopilotWindowNotice {
  if (isWindowNotice(value)) {
    return value;
  }

  const text = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/closed|fechad|fora.*janela|24h.*fech/.test(text)) {
    return 'closed_24h';
  }
  if (/open|abert|dentro.*janela|24h.*abert/.test(text)) {
    return 'open_24h';
  }

  return 'unknown';
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function assertSafeDraft(value: string): void {
  if (/(senha|password|bearer|token=|api_key|app_secret|BEGIN PRIVATE KEY)/i.test(value)) {
    throw new Error('COPILOT_DRAFT_SECRET_DETECTED');
  }
  if (/\b(enviei|fechei|reabri|alterei|mudei|aprovei|executei|publiquei|acionei template)\b/i.test(value)) {
    throw new Error('COPILOT_DRAFT_UNSAFE_ACTION');
  }
}

function assertNoRawSecret(value: string): void {
  if (/(senha|password|bearer|token\s*=|api[_-]?key\s*=|app[_-]?secret\s*=|secret\s*=|BEGIN PRIVATE KEY)/i.test(value)) {
    throw new Error('COPILOT_DRAFT_SECRET_DETECTED');
  }
}

function normalizeFreeTextDraft(raw: string): CopilotDraftResult | null {
  assertNoRawSecret(raw);

  const text = truncate(raw
    .replace(/^```(?:json|text)?/i, '')
    .replace(/```$/i, '')
    .replace(/^["']|["']$/g, ''), 2_000);
  if (text.length < 40 || !/[.!?]|\n/.test(text)) {
    return null;
  }
  assertSafeDraft(text);

  return {
    draftResponse: text,
    tone: 'neutral',
    kbReferences: [],
    assumptions: ['O provedor local retornou texto livre em vez de JSON estruturado.'],
    missingInformation: ['Revise tecnicamente antes de usar o rascunho.'],
    safetyWarnings: [
      'Nenhuma mensagem foi enviada automaticamente.',
      'Rascunho recuperado de resposta não estruturada; validação humana obrigatória.',
    ],
    technicianChecklist: [
      'Conferir se o rascunho responde ao caso atual.',
      'Remover qualquer informação sensível antes de enviar.',
      'Enviar manualmente somente após revisão.',
    ],
    confidenceScore: 20,
    windowNotice: 'unknown',
    templateNotice: '',
    noAutoSend: true,
  };
}

function parseJsonCandidate(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    // Continue with common local-model wrappers below.
  }

  const fenced = value.match(/```(?:json|javascript|js)?\s*([\s\S]*?)```/i);
  if (fenced?.[1] !== undefined) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Fall through to balanced-object extraction.
    }
  }

  const firstBrace = value.indexOf('{');
  const lastBrace = value.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(value.slice(firstBrace, lastBrace + 1));
    } catch {
      // The caller will try free-text recovery.
    }
  }

  return undefined;
}

function hasStructuredDraftFields(record: Record<string, unknown>): boolean {
  return record.draft_response !== undefined
    || record.draftResponse !== undefined
    || record.technician_checklist !== undefined
    || record.technicianChecklist !== undefined
    || record.no_auto_send !== undefined
    || record.noAutoSend !== undefined;
}

function normalizeKbReferences(value: unknown): CopilotDraftResult['kbReferences'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 5).map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('COPILOT_DRAFT_INVALID_KB_REFERENCE');
    }
    const record = item as Record<string, unknown>;
    const articleId = Number(record.article_id ?? record.articleId ?? 0);
    if (!Number.isInteger(articleId) || articleId <= 0) {
      throw new Error('COPILOT_DRAFT_INVALID_KB_REFERENCE');
    }

    return {
      articleId,
      title: truncate(record.title, 180),
      internalUrl: truncate(record.internal_url ?? record.internalUrl, 300),
    };
  });
}

export function parseCopilotDraftResult(raw: string): CopilotDraftResult {
  const parsed = parseJsonCandidate(raw);
  if (parsed === undefined) {
    const recovered = normalizeFreeTextDraft(raw);
    if (recovered !== null) {
      return recovered;
    }
    throw new Error('COPILOT_DRAFT_INVALID_JSON');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('COPILOT_DRAFT_INVALID_SHAPE');
  }

  const record = parsed as Record<string, unknown>;
  if (!hasStructuredDraftFields(record) && typeof record.response === 'string') {
    const nested = parseJsonCandidate(record.response);
    if (nested !== undefined && nested !== parsed) {
      return parseCopilotDraftResult(record.response);
    }
  }

  const draftResponse = truncate(
    record.draft_response
      ?? record.draftResponse
      ?? record.response
      ?? record.resposta
      ?? record.rascunho
      ?? record.draft
      ?? record.message
      ?? record.suggestion,
    2_000,
  );
  if (draftResponse === '') {
    throw new Error('COPILOT_DRAFT_EMPTY');
  }
  assertSafeDraft(draftResponse);

  const explicitNoAutoSend = record.no_auto_send ?? record.noAutoSend;
  if (explicitNoAutoSend === false) {
    throw new Error('COPILOT_DRAFT_NO_AUTO_SEND_REQUIRED');
  }

  const technicianChecklist = normalizeList(
    record.technician_checklist ?? record.technicianChecklist ?? record.checklist ?? record.check_list,
    8,
    140,
  );

  const result: CopilotDraftResult = {
    draftResponse,
    tone: normalizeTone(record.tone),
    kbReferences: normalizeKbReferences(record.kb_references ?? record.kbReferences),
    assumptions: normalizeList(record.assumptions, 6, 140),
    missingInformation: normalizeList(record.missing_information ?? record.missingInformation, 6, 140),
    safetyWarnings: normalizeList(record.safety_warnings ?? record.safetyWarnings, 6, 160),
    technicianChecklist: technicianChecklist.length > 0
      ? technicianChecklist
      : [
        'Conferir se o rascunho responde ao chamado atual.',
        'Validar informações sensíveis antes de usar.',
        'Enviar manualmente somente após revisão.',
      ],
    confidenceScore: clampConfidence(record.confidence_score ?? record.confidenceScore),
    windowNotice: normalizeWindowNotice(record.window_notice ?? record.windowNotice),
    templateNotice: truncate(record.template_notice ?? record.templateNotice, 240),
    noAutoSend: true,
  };

  if (result.windowNotice === 'closed_24h' && result.templateNotice === '') {
    result.templateNotice = 'A janela de atendimento está fechada. Você precisará usar um template aprovado.';
  }

  return result;
}
