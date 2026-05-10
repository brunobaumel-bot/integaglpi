import pino from 'pino';

export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-integaglpi-api-key"]',
      'req.headers["x-hub-signature-256"]',
      'metaAppSecret',
      'clientSecret',
      'refreshToken',
      'accessToken',
    ],
    censor: '[REDACTED]',
  },
});

