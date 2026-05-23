import type { Request, Response } from 'express';

import { normalizeAiQualityKbContext } from '../ai/aiQualityPrompt.js';
import type { AiSupervisorService } from '../domain/services/AiSupervisorService.js';

export function createAiQualityAnalysisController(service: AiSupervisorService) {
  return async (request: Request, response: Response): Promise<void> => {
    const conversationId = String(request.body?.conversation_id ?? '').trim();
    const glpiTicketId = Number(request.body?.ticket_id ?? request.body?.glpi_ticket_id ?? 0);
    const createdBy = Number(request.body?.glpi_user_id ?? 0);
    const kbContext = normalizeAiQualityKbContext(request.body?.kb_context);

    if (conversationId === '' || !Number.isInteger(glpiTicketId) || glpiTicketId <= 0) {
      response.status(400).json({
        success: false,
        error_code: 'INVALID_AI_ANALYSIS_REQUEST',
        message: 'conversation_id and ticket_id are required.',
      });
      return;
    }

    try {
      const analysis = await service.requestAnalysis({
        conversationId,
        glpiTicketId,
        createdBy: Number.isInteger(createdBy) && createdBy > 0 ? createdBy : null,
        kbContext,
      });

      response.status(200).json({
        success: true,
        analysis,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'AI_SUPERVISOR_DISABLED' ? 409 : 500;
      response.status(status).json({
        success: false,
        error_code: message === 'AI_SUPERVISOR_DISABLED' ? 'AI_SUPERVISOR_DISABLED' : 'AI_ANALYSIS_FAILED',
        message: message === 'AI_SUPERVISOR_DISABLED'
          ? 'AI supervisor is disabled.'
          : 'AI supervisor analysis failed.',
      });
    }
  };
}
