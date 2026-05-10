import { describe, expect, it } from 'vitest';

import {
  AUDIT_PAYLOAD_REDACTED,
  AUDIT_PAYLOAD_TRUNCATED,
  sanitizeAuditPayload,
} from '../src/domain/services/auditPayloadSanitizer.js';

describe('sanitizeAuditPayload', () => {
  it('mascara chaves sensiveis', () => {
    const sanitized = sanitizeAuditPayload({
      token: 'meta-token',
      Authorization: 'Bearer secret',
      nested: { api_key: 'key' },
    });

    expect(sanitized).toEqual({
      token: AUDIT_PAYLOAD_REDACTED,
      Authorization: AUDIT_PAYLOAD_REDACTED,
      nested: { api_key: AUDIT_PAYLOAD_REDACTED },
    });
  });

  it('sanitiza objetos e arrays recursivamente', () => {
    const sanitized = sanitizeAuditPayload({
      items: [
        { password: 'secret', keep: 'ok' },
        { media_content: 'base64data' },
      ],
    });

    expect(sanitized).toEqual({
      items: [
        { password: AUDIT_PAYLOAD_REDACTED, keep: 'ok' },
        { media_content: AUDIT_PAYLOAD_REDACTED },
      ],
    });
  });

  it('limita payload grande', () => {
    const sanitized = sanitizeAuditPayload({ text: 'x'.repeat(200) }, 50);

    expect(sanitized).toBe(AUDIT_PAYLOAD_TRUNCATED);
  });
});
