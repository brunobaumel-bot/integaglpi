import type { Request, Response } from 'express';

import type { AiSupervisorService } from '../domain/services/AiSupervisorService.js';
import type { AiQualitySupervisorFeedback } from '../repositories/contracts/AiQualityAnalysisRepository.js';

const ALLOWED_FEEDBACK = new Set(['useful', 'not_useful', 'incorrect']);

export function createAiQualityFeedbackController(service: AiSupervisorService) {
  return async (request: Request, response: Response): Promise<void> => {
    const analysisId = String(request.body?.analysis_id ?? '').trim();
    const feedback = String(request.body?.feedback ?? '').trim();
    const notes = String(request.body?.feedback_notes ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);

    if (analysisId === '' || !ALLOWED_FEEDBACK.has(feedback)) {
      response.status(400).json({
        success: false,
        error_code: 'INVALID_AI_FEEDBACK_REQUEST',
        message: 'analysis_id and valid feedback are required.',
      });
      return;
    }

    try {
      const analysis = await service.saveFeedback(
        analysisId,
        feedback as AiQualitySupervisorFeedback,
        notes === '' ? null : notes,
      );

      if (analysis === null) {
        response.status(404).json({
          success: false,
          error_code: 'AI_ANALYSIS_NOT_FOUND',
          message: 'AI analysis not found.',
        });
        return;
      }

      response.status(200).json({
        success: true,
        analysis,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'AI_SUPERVISOR_DISABLED' ? 409 : 500;
      response.status(status).json({
        success: false,
        error_code: message === 'AI_SUPERVISOR_DISABLED' ? 'AI_SUPERVISOR_DISABLED' : 'AI_FEEDBACK_FAILED',
        message: message === 'AI_SUPERVISOR_DISABLED'
          ? 'AI supervisor is disabled.'
          : 'AI supervisor feedback failed.',
      });
    }
  };
}
