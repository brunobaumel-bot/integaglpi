import type { NextFunction, Request, Response } from 'express';

import { MetaWebhookSignatureVerifier } from '../adapters/meta/MetaWebhookSignatureVerifier.js';
import { logger } from '../infra/logger/logger.js';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

export function createMetaWebhookSignatureMiddleware(appSecret: string) {
  const verifier = new MetaWebhookSignatureVerifier(appSecret);

  return function metaWebhookSignatureMiddleware(
    req: RawBodyRequest,
    res: Response,
    next: NextFunction,
  ): void {
    const signatureHeader = req.header('X-Hub-Signature-256');

    if (!req.rawBody || !verifier.verify(signatureHeader, req.rawBody)) {
      logger.warn(
        {
          path: req.path,
          ip: req.ip,
          method: req.method,
        },
        'Rejected webhook request due to invalid Meta signature.',
      );

      res.status(401).json({
        error: 'invalid_webhook_signature',
      });
      return;
    }

    next();
  };
}
