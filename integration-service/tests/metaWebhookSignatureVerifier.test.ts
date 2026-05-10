import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { MetaWebhookSignatureVerifier } from '../src/adapters/meta/MetaWebhookSignatureVerifier.js';

describe('MetaWebhookSignatureVerifier', () => {
  it('accepts a valid Meta signature', () => {
    const rawBody = Buffer.from(JSON.stringify({ entry: [] }));
    const secret = 'super-secret';
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex');

    const verifier = new MetaWebhookSignatureVerifier(secret);

    expect(verifier.verify(`sha256=${signature}`, rawBody)).toBe(true);
  });

  it('rejects an invalid Meta signature', () => {
    const rawBody = Buffer.from(JSON.stringify({ entry: [] }));
    const verifier = new MetaWebhookSignatureVerifier('super-secret');

    expect(verifier.verify('sha256=deadbeef', rawBody)).toBe(false);
  });
});
