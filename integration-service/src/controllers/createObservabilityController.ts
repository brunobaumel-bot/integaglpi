import type { Request, Response } from 'express';

import type { ObservabilityService } from '../services/ObservabilityService.js';

export function createObservabilityController(service: ObservabilityService) {
  return async function observabilityController(req: Request, res: Response): Promise<void> {
    try {
      const body = await service.getDashboard({
        periodDays: parsePeriod(req.query.period),
        severity: parseText(req.query.severity),
        eventType: parseText(req.query.event_type),
        ticketId: parsePositiveInt(req.query.ticket_id),
        phone: parseText(req.query.phone),
        source: parseText(req.query.source),
        page: parsePositiveInt(req.query.page) ?? 1,
        limit: parsePositiveInt(req.query.limit) ?? 20,
      });

      res.status(200).json(body);
    } catch {
      res.status(500).json({
        ok: false,
        message: 'Falha ao carregar observabilidade operacional.',
      });
    }
  };
}

function parseText(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return parseText(value[0]);
  }
  const text = String(value ?? '').trim();
  return text !== '' ? text : undefined;
}

function parsePositiveInt(value: unknown): number | undefined {
  const text = parseText(value);
  if (text === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePeriod(value: unknown): number {
  const parsed = parsePositiveInt(value);
  return parsed !== undefined && [1, 7, 30].includes(parsed) ? parsed : 1;
}
