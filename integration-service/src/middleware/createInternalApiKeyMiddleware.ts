import { timingSafeEqual } from 'node:crypto';

import type { RequestHandler } from 'express';

function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization || !authorization.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  const token = authorization.slice(7).trim();

  return token.length > 0 ? token : null;
}

export function createInternalApiKeyMiddleware(expectedApiKey: string): RequestHandler {
  return (req, res, next) => {
    const bearer = extractBearerToken(req.headers.authorization);
    const headerRaw = req.headers['x-integaglpi-api-key'];
    const headerKey = typeof headerRaw === 'string' ? headerRaw.trim() : '';
    const provided = bearer ?? (headerKey.length > 0 ? headerKey : '');

    const expectedBuffer = Buffer.from(expectedApiKey, 'utf8');
    const providedBuffer = Buffer.from(provided, 'utf8');

    if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
      res.status(401).json({
        status: 'failed',
        error_code: 'UNAUTHORIZED',
        message: 'Invalid or missing API key.',
      });
      return;
    }

    next();
  };
}
