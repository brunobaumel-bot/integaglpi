import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';

const apiKey = 'test-integration-service-api-key-32chars-min';

function createService() {
  return {
    preview: vi.fn(async () => ({
      batch: { batchId: 'batch-1', status: 'previewed', totalRows: 1, validRows: 1, invalidRows: 0, duplicateRows: 0, conflictRows: 0 },
      items: [],
    })),
    confirm: vi.fn(async () => ({ batch: { batchId: 'batch-1', status: 'completed' }, items: [] })),
    getStatus: vi.fn(async () => ({ batch: { batchId: 'batch-1', status: 'completed' }, items: [] })),
    rollback: vi.fn(async () => ({ batch: { batchId: 'batch-1', status: 'rolled_back' }, items: [] })),
  };
}

function createTestApp(service = createService()) {
  const inboundWebhookService = { process: vi.fn() };
  const app = createApp({
    inboundWebhookService: inboundWebhookService as never,
    metaAppSecret: 'meta-secret',
    metaVerifyToken: 'verify-token',
    outboundMessageService: { send: vi.fn() } as never,
    integrationServiceApiKey: apiKey,
    contactAgendaImportService: service as never,
  });

  return { app, service, inboundWebhookService };
}

describe('Contact agenda import internal route', () => {
  it('requires Bearer authorization', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/internal/glpi/contact-agenda/import/preview')
      .send({ filename: 'agenda.csv', csv_content: 'telefone\n5599999999999' });

    expect(response.status).toBe(401);
  });

  it('previews CSV without calling Meta webhook processing', async () => {
    const { app, service, inboundWebhookService } = createTestApp();

    const response = await request(app)
      .post('/internal/glpi/contact-agenda/import/preview')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ filename: 'agenda.csv', csv_content: 'telefone\n5599999999999', uploaded_by: 10 });

    expect(response.status).toBe(201);
    expect(service.preview).toHaveBeenCalledWith({
      filename: 'agenda.csv',
      csvContent: 'telefone\n5599999999999',
      uploadedBy: 10,
    });
    expect(inboundWebhookService.process).not.toHaveBeenCalled();
  });

  it('supports confirm, status and rollback endpoints', async () => {
    const { app, service } = createTestApp();

    const confirm = await request(app)
      .post('/internal/glpi/contact-agenda/import/batch-1/confirm')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ confirmed_by: 10 });
    const status = await request(app)
      .get('/internal/glpi/contact-agenda/import/batch-1')
      .set('Authorization', `Bearer ${apiKey}`);
    const rollback = await request(app)
      .post('/internal/glpi/contact-agenda/import/batch-1/rollback')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ requested_by: 10, reason: 'teste' });

    expect(confirm.status).toBe(200);
    expect(status.status).toBe(200);
    expect(rollback.status).toBe(200);
    expect(service.confirm).toHaveBeenCalledWith({ batchId: 'batch-1', confirmedBy: 10 });
    expect(service.getStatus).toHaveBeenCalledWith('batch-1');
    expect(service.rollback).toHaveBeenCalledWith({ batchId: 'batch-1', requestedBy: 10, reason: 'teste' });
  });
});
