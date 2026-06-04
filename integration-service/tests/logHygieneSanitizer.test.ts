import { describe, expect, it } from 'vitest';

import { sanitizeLogObjectForTelemetry } from '../src/infra/logger/logger.js';

describe('log hygiene sanitizer', () => {
  it('redacts phones, names and secrets in structured log payloads', () => {
    const sanitized = sanitizeLogObjectForTelemetry({
      phone_e164: '+5541988334449',
      phone_number_id: '123456789012345',
      display_phone_number: '41988334449',
      request_id: 'b53b16d3-f270-49c1-8e2e-affd12345678',
      correlation_id: 'WA-20260604-1234567890',
      contact_name: 'Cliente Auditoria',
      headers: {
        authorization: 'Bearer real-token',
        'app-token': 'app-token-value',
        user_token: 'glpi-user-token',
        'x-api-key': 'internal-key',
      },
      glpiRequestPayload: {
        input: [
          {
            name: 'Cliente Auditoria',
            content: 'Telefone (WhatsApp): +5541988334449 Nome: Cliente Auditoria',
          },
        ],
      },
      documentItem: {
        itemtype: 'Ticket',
        items_id: 2112319360,
      },
    });

    const serialized = JSON.stringify(sanitized);

    expect(serialized).toContain('[PHONE_REDACTED]');
    expect(serialized).toContain('[NAME_REDACTED]');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('b53b16d3-f270-49c1-8e2e-affd12345678');
    expect(serialized).toContain('WA-20260604-1234567890');
    expect(serialized).not.toContain('+5541988334449');
    expect(serialized).not.toContain('41988334449');
    expect(serialized).not.toContain('123456789012345');
    expect(serialized).not.toContain('real-token');
    expect(serialized).not.toContain('app-token-value');
    expect(serialized).not.toContain('glpi-user-token');
    expect(serialized).not.toContain('internal-key');
    expect(serialized).not.toContain('Cliente Auditoria');
    expect(serialized).toContain('2112319360');
  });

  it('redacts plain text tokens and phone numbers while preserving operational ids', () => {
    const sanitized = sanitizeLogObjectForTelemetry({
      conversation_id: 'conv-audit',
      glpi_ticket_id: 2112319360,
      error_type: 'glpi_permission_denied',
      message: 'authorization=Bearer abc123 telefone 41988334449',
    });

    const serialized = JSON.stringify(sanitized);

    expect(serialized).toContain('conv-audit');
    expect(serialized).toContain('2112319360');
    expect(serialized).toContain('glpi_permission_denied');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('[PHONE_REDACTED]');
    expect(serialized).not.toContain('41988334449');
    expect(serialized).not.toContain('abc123');
  });
});
