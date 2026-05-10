import type { AiAnalysisResult } from '../types/AiAnalysisResult.js';

import type { AiAnalysisService, AnalyzeMessageInput } from './AiAnalysisService.js';

const TITLE_PREFIX = 'Chamado via WhatsApp: ';
const EMPTY_TEXT_TITLE_SUFFIX = 'Mensagem sem texto';
const EMPTY_TEXT_DESCRIPTION =
  'Mensagem original: a mensagem veio sem texto interpretável.';

function normalizeText(text?: string | null): string {
  return typeof text === 'string' ? text.trim() : '';
}

/** Resposta fixa compatível com `AiAnalysisResult` / consumo pelo integration-service (PoC Fase 2). */
export class MockAiAnalysisService implements AiAnalysisService {
  public async analyzeMessage(input: AnalyzeMessageInput): Promise<AiAnalysisResult> {
    const normalizedText = normalizeText(input.text);
    const titleSuffix = normalizedText.length > 0 ? normalizedText.substring(0, 20) : EMPTY_TEXT_TITLE_SUFFIX;
    const description = normalizedText.length > 0 ? `Mensagem original: ${normalizedText}` : EMPTY_TEXT_DESCRIPTION;

    return {
      shouldCreateTicket: true,
      title: `${TITLE_PREFIX}${titleSuffix}`,
      description,
      category: 'Suporte PoC',
      urgency: 3,
      analysis: 'Processado em modo Mock (Fase 2)',
    };
  }
}
