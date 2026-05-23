import type { Request, Response } from 'express';

import type { AiPilotService } from '../domain/services/AiPilotService.js';

function safeString(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function createAiPilotStatusController(service: AiPilotService) {
  return async (_req: Request, res: Response): Promise<void> => {
    const status = await service.getAsyncStatus();
    res.json({ ok: true, status });
  };
}

export function createAiPilotSyntheticTestController(service: AiPilotService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as Record<string, unknown>;
      const result = await service.runSyntheticTest({
        payload: safeString(body.payload, 6_000),
        requestedByGlpiUserId: Number.isFinite(Number(body.glpi_user_id)) ? Number(body.glpi_user_id) : null,
        syntheticOnly: true,
      });
      res.status(result.ok ? 200 : 409).json({ ok: result.ok, result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'AI_PILOT_FAILED';
      res.status(400).json({ ok: false, message });
    }
  };
}
