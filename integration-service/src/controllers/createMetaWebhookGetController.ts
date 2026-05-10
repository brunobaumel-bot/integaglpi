import type { Request, Response } from 'express';

export function createMetaWebhookGetController(expectedVerifyToken: string) {
  return function metaWebhookGetController(req: Request, res: Response): void {
    const hubMode = req.query['hub.mode'];
    const hubVerifyToken = req.query['hub.verify_token'];
    const hubChallenge = req.query['hub.challenge'];

    if (
      hubMode !== 'subscribe' ||
      typeof hubVerifyToken !== 'string' ||
      hubVerifyToken !== expectedVerifyToken ||
      typeof hubChallenge !== 'string'
    ) {
      res.status(403).json({
        error: 'invalid_verify_token',
      });
      return;
    }

    res.status(200).send(hubChallenge);
  };
}

