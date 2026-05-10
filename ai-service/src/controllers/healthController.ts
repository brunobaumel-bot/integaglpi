import type { Request, Response } from 'express';

export function healthController(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    service: 'ai-service',
  });
}

