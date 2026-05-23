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
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('COPILOT_DRAFT_INVALID_JSON');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('COPILOT_DRAFT_INVALID_SHAPE');
  }

  const record = parsed as Record<string, unknown>;
  const draftResponse = truncate(record.draft_response ?? record.draftResponse, 2_000);
  if (draftResponse === '') {
    throw new Error('COPILOT_DRAFT_EMPTY');
  }
  assertSafeDraft(draftResponse);

  if (!isTone(record.tone) || !isWindowNotice(record.window_notice ?? record.windowNotice)) {
    throw new Error('COPILOT_DRAFT_INVALID_ENUM');
  }
  const windowNotice = (record.window_notice ?? record.windowNotice) as CopilotWindowNotice;
  if (record.no_auto_send !== true && record.noAutoSend !== true) {
    throw new Error('COPILOT_DRAFT_NO_AUTO_SEND_REQUIRED');
  }

  const technicianChecklist = normalizeList(record.technician_checklist ?? record.technicianChecklist, 8, 140);
  if (technicianChecklist.length === 0) {
    throw new Error('COPILOT_DRAFT_CHECKLIST_REQUIRED');
  }

  const result: CopilotDraftResult = {
    draftResponse,
    tone: record.tone,
    kbReferences: normalizeKbReferences(record.kb_references ?? record.kbReferences),
    assumptions: normalizeList(record.assumptions, 6, 140),
    missingInformation: normalizeList(record.missing_information ?? record.missingInformation, 6, 140),
    safetyWarnings: normalizeList(record.safety_warnings ?? record.safetyWarnings, 6, 160),
    technicianChecklist,
    confidenceScore: clampConfidence(record.confidence_score ?? record.confidenceScore),
    windowNotice,
    templateNotice: truncate(record.template_notice ?? record.templateNotice, 240),
    noAutoSend: true,
  };

  if (result.windowNotice === 'closed_24h' && result.templateNotice === '') {
    result.templateNotice = 'A janela de atendimento está fechada. Você precisará usar um template aprovado.';
  }

  return result;
}
