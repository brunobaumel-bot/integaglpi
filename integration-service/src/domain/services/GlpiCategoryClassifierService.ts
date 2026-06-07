/**
 * GlpiCategoryClassifierService
 *
 * Classifies a user's problem description against GLPI ITIL categories.
 *
 * Strategy (in order):
 *   1. Heuristic: keyword-based matching against category names.
 *   2. Local AI (Ollama): optional — only when explicitly configured.
 *   3. Fallback: returns confidence=0, signals manual menu.
 *
 * Rules:
 *  - Text is ALWAYS sanitized (PII removed) before any AI call.
 *  - Cloud AI is forbidden — only local (Ollama) is permitted.
 *  - Timeout: maximum 10 s for the entire classification.
 *  - Failure NEVER blocks the WhatsApp webhook.
 *  - Category must be from the entity's valid option list.
 *  - Never invents categories not present in validOptions.
 *
 * PHASE: integaglpi_ai_category_classification_001
 */

import { anonymizeAiPilotPayload } from '../../privacy/anonymizeForAiPilot.js';
import type { ActiveRoutingOption } from '../../repositories/contracts/RoutingRepository.js';
import { logger } from '../../infra/logger/logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CategoryClassificationSource = 'heuristic' | 'local_ai' | 'fallback';

export interface CategoryClassificationResult {
  categoryId: number | null;
  categoryName: string | null;
  confidence: number;
  source: CategoryClassificationSource;
  reason: string;
  sanitizedText: string;
  /** true when confidence >= autoThreshold */
  requiresConfirmation: boolean;
  /** true when confidence < confirmThreshold */
  fallbackRequired: boolean;
  autoThreshold: number;
  confirmThreshold: number;
}

// ── Heuristic patterns ────────────────────────────────────────────────────────

interface HeuristicRule {
  /** Signal keywords (PT-BR). Each match increases score. */
  signals: RegExp[];
  /** Fragments matched against GLPI category names (case-insensitive). */
  categoryHints: string[];
}

const HEURISTIC_RULES: HeuristicRule[] = [
  {
    signals: [/n[aã]o\s+liga|n[aã]o\s+inicia|n[aã]o\s+d[aá]\s+v[ií]deo|tela\s+(preta|em\s+branco)|hardware|computador\s+quebrado|pc\s+n[aã]o/i],
    categoryHints: ['hardware', 'desktop', 'equipamento', 'computador', 'pc'],
  },
  {
    signals: [/internet|sem\s+rede|sem\s+acesso|wifi|wi-fi|n[aã]o\s+conecta|rede\s+(caiu|fora|instavelidade)|conectividade|cabo\s+de\s+rede/i],
    categoryHints: ['rede', 'internet', 'conectividade', 'network', 'wifi', 'acesso'],
  },
  {
    signals: [/e[- ]?mail|outlook|correio|mensagem\s+n[aã]o\s+chega|caixa\s+de\s+entrada|smtp|imap/i],
    categoryHints: ['email', 'e-mail', 'outlook', 'correio'],
  },
  {
    signals: [/impressora|impress[aã]o|n[aã]o\s+imprime|papel\s+preso|cartucho|toner|scanner/i],
    categoryHints: ['impressora', 'impress', 'scanner'],
  },
  {
    signals: [/sistema|aplica[cç][aã]o|erro\s+no\s+sistema|programa\s+(n[aã]o\s+abre|travado|fechando)|software|sistema\s+fora/i],
    categoryHints: ['sistema', 'software', 'aplica', 'programa'],
  },
  {
    signals: [/senha|login|n[aã]o\s+consigo\s+entrar|acesso\s+negado|bloqueado|esqueci\s+a\s+senha|credencial/i],
    categoryHints: ['acesso', 'senha', 'login', 'credencial', 'autenti'],
  },
  {
    signals: [/telefone|ramal|voip|fone|chamada|n[aã]o\s+atende|liga[cç][aã]o|voz/i],
    categoryHints: ['telefone', 'ramal', 'voip', 'telecom', 'fone'],
  },
];

const HEURISTIC_MAX_CHARS = 400;

/**
 * Runs heuristic keyword matching against valid category names.
 * Returns the best match and a confidence score, or null if no match.
 */
function runHeuristic(
  sanitizedText: string,
  validOptions: ActiveRoutingOption[],
): { option: ActiveRoutingOption; confidence: number; reason: string } | null {
  if (validOptions.length === 0) return null;
  const text = sanitizedText.slice(0, HEURISTIC_MAX_CHARS).toLowerCase();

  const scores = new Map<number, { option: ActiveRoutingOption; score: number; hints: string[] }>();

  for (const rule of HEURISTIC_RULES) {
    const signalMatched = rule.signals.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(text);
    });
    if (!signalMatched) continue;

    for (const opt of validOptions) {
      const catName = `${opt.label} ${opt.optionKey}`.toLowerCase();
      for (const hint of rule.categoryHints) {
        if (catName.includes(hint)) {
          const existing = scores.get(opt.id) ?? { option: opt, score: 0, hints: [] };
          existing.score += 1;
          existing.hints.push(hint);
          scores.set(opt.id, existing);
        }
      }
    }
  }

  if (scores.size === 0) return null;

  // Pick best score.
  let best: { option: ActiveRoutingOption; score: number; hints: string[] } | null = null;
  for (const entry of scores.values()) {
    if (!best || entry.score > best.score) best = entry;
  }
  if (!best) return null;

  // Normalize confidence: 1 signal match = 0.60, 2 = 0.75, 3+ = 0.90.
  const confidence = best.score === 1 ? 0.60 : best.score === 2 ? 0.75 : 0.90;
  return {
    option: best.option,
    confidence,
    reason: `heuristic:signals=${best.hints.slice(0, 3).join(',')}`,
  };
}

// ── Local AI (Ollama) ─────────────────────────────────────────────────────────

interface LocalAiConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

const LOCAL_AI_CLASSIFY_TIMEOUT_MS = 10_000;

/**
 * Builds a prompt asking Ollama to pick from valid categories.
 * Prompt is tight — returns only the category number or "0" if uncertain.
 */
function buildClassifyPrompt(sanitizedText: string, options: ActiveRoutingOption[]): string {
  const numberedList = options.map((o, i) => `${i + 1}. ${o.label}`).join('\n');
  return (
    `Você é um assistente de helpdesk. Com base no problema descrito abaixo, escolha o número da categoria mais adequada da lista. ` +
    `Se não tiver certeza, responda apenas "0". Responda SOMENTE com o número, sem explicação.\n\n` +
    `Problema: "${sanitizedText.slice(0, 280)}"\n\n` +
    `Categorias:\n${numberedList}\n\n` +
    `Número da categoria (ou 0):`
  );
}

async function callLocalAi(
  sanitizedText: string,
  validOptions: ActiveRoutingOption[],
  config: LocalAiConfig,
): Promise<{ option: ActiveRoutingOption; confidence: number } | null> {
  if (validOptions.length === 0) return null;
  const prompt = buildClassifyPrompt(sanitizedText, validOptions);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/api/generate`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, prompt, stream: false }),
    });
    if (!response.ok) return null;
    const raw = await response.json() as { response?: string };
    const text = (raw.response ?? '').trim();
    const n = parseInt(text, 10);
    if (!Number.isFinite(n) || n < 1 || n > validOptions.length) return null;
    const option = validOptions[n - 1];
    return option ? { option, confidence: 0.82 } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export interface CategoryClassifierConfig {
  autoThreshold?: number;
  confirmThreshold?: number;
  localAi?: LocalAiConfig | null;
}

export class GlpiCategoryClassifierService {
  private readonly autoThreshold: number;
  private readonly confirmThreshold: number;
  private readonly localAiConfig: LocalAiConfig | null;

  public constructor(config: CategoryClassifierConfig = {}) {
    this.autoThreshold = config.autoThreshold ?? 0.85;
    this.confirmThreshold = config.confirmThreshold ?? 0.55;
    this.localAiConfig = config.localAi ?? null;
  }

  /**
   * Sanitizes and classifies a user's problem description.
   * NEVER throws — returns fallback result on any error.
   */
  public async classify(
    rawText: string,
    validOptions: ActiveRoutingOption[],
    entityId: number,
  ): Promise<CategoryClassificationResult> {
    const base: Omit<CategoryClassificationResult, 'categoryId' | 'categoryName' | 'confidence' | 'source' | 'reason' | 'sanitizedText'> = {
      requiresConfirmation: false,
      fallbackRequired: true,
      autoThreshold: this.autoThreshold,
      confirmThreshold: this.confirmThreshold,
    };

    // Validate entity guard.
    if (!entityId || entityId <= 0) {
      logger.warn({ entity_id: entityId }, '[category_classifier] classify() called without valid entityId — returning fallback');
      return { ...base, categoryId: null, categoryName: null, confidence: 0, source: 'fallback', reason: 'entity_missing', sanitizedText: '' };
    }

    if (validOptions.length === 0) {
      return { ...base, categoryId: null, categoryName: null, confidence: 0, source: 'fallback', reason: 'no_valid_categories', sanitizedText: '' };
    }

    // PII sanitization — text sent to AI is always sanitized.
    const sanitized = anonymizeAiPilotPayload(rawText);
    const sanitizedText = sanitized.text.slice(0, HEURISTIC_MAX_CHARS);

    if (sanitizedText.trim().length < 3) {
      return { ...base, categoryId: null, categoryName: null, confidence: 0, source: 'fallback', reason: 'text_too_short', sanitizedText };
    }

    let categoryId: number | null = null;
    let categoryName: string | null = null;
    let confidence = 0;
    let source: CategoryClassificationSource = 'fallback';
    let reason = 'no_match';

    // 1. Heuristic.
    try {
      const heuristicResult = runHeuristic(sanitizedText, validOptions);
      if (heuristicResult) {
        categoryId = heuristicResult.option.glpiItilCategoryId ?? null;
        categoryName = heuristicResult.option.label;
        confidence = heuristicResult.confidence;
        source = 'heuristic';
        reason = heuristicResult.reason;
      }
    } catch (err: unknown) {
      logger.warn({ error: err instanceof Error ? err.message : String(err) }, '[category_classifier] heuristic error');
    }

    // 2. Local AI (optional) — only if heuristic is insufficient OR if AI gives higher confidence.
    if (this.localAiConfig && (confidence < this.autoThreshold)) {
      try {
        const aiResult = await callLocalAi(sanitizedText, validOptions, {
          ...this.localAiConfig,
          timeoutMs: Math.min(this.localAiConfig.timeoutMs, LOCAL_AI_CLASSIFY_TIMEOUT_MS),
        });
        if (aiResult && aiResult.confidence > confidence) {
          categoryId = aiResult.option.glpiItilCategoryId ?? null;
          categoryName = aiResult.option.label;
          confidence = aiResult.confidence;
          source = 'local_ai';
          reason = `local_ai:model=${this.localAiConfig.model}`;
        }
      } catch (err: unknown) {
        // AI failure must never block — log and continue with heuristic result.
        logger.warn({ error: err instanceof Error ? err.message : String(err) }, '[category_classifier] local_ai error — using heuristic result');
      }
    }

    const requiresConfirmation = confidence >= this.confirmThreshold && confidence < this.autoThreshold;
    const fallbackRequired = confidence < this.confirmThreshold || categoryId === null;

    logger.info(
      {
        entity_id: entityId,
        category_id: categoryId,
        category_name: categoryName,
        confidence,
        source,
        reason,
        requires_confirmation: requiresConfirmation,
        fallback_required: fallbackRequired,
        pii_kinds_detected: sanitized.detectedKinds.length,
        ai_cloud: false,
      },
      '[category_classifier][CATEGORY_CLASSIFIED]',
    );

    return {
      categoryId,
      categoryName,
      confidence,
      source,
      reason,
      sanitizedText,
      requiresConfirmation,
      fallbackRequired,
      autoThreshold: this.autoThreshold,
      confirmThreshold: this.confirmThreshold,
    };
  }
}
