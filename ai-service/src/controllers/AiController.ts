import type { Request, Response } from 'express';

import type { AiAnalysisService } from '../domain/services/AiAnalysisService.js';

interface AnalyzeRequestBody {
  text?: string | null;
  messageText?: string | null;
  content?: string | null;
}

function extractText(body: AnalyzeRequestBody): string | null | undefined {
  return body.text ?? body.messageText ?? body.content;
}

/** POST /analyze — mock vs provider real definido em createAiAnalysisService() (sem chamadas externas no mock). */
export function createAiController(aiAnalysisService: AiAnalysisService) {
  return {
    analyzeMessage: async (req: Request<unknown, unknown, AnalyzeRequestBody>, res: Response) => {
      try {
        const result = await aiAnalysisService.analyzeMessage({
          text: extractText(req.body ?? {}),
        });

        res.status(200).json(result);
      } catch (error: unknown) {
        req.log?.error({ error }, 'Failed to analyze inbound message.');
        res.status(503).json({
          error: 'ai_provider_unavailable',
          message: 'AI provider unavailable.',
        });
      }
    },
  };
}
