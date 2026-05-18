import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function extractBearerToken(headerValue: unknown): string | null {
  if (typeof headerValue !== 'string') {
    return null;
  }

  const [scheme, token] = headerValue.split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }

  return token.trim() || null;
}

export function createInternalBearerMiddleware(expectedApiKey: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token || !constantTimeEquals(token, expectedApiKey)) {
      return response.status(401).json({
        status: 'failed',
        error_code: 'UNAUTHORIZED',
        message: 'Invalid or missing bearer token.',
      });
    }

    return next();
  };
}
