import { describe, expect, it } from 'vitest';

import { AttachmentSecurityService, sanitizeAttachmentFilename } from '../src/domain/services/AttachmentSecurityService.js';

const service = new AttachmentSecurityService();

const samples = {
  pdf: Buffer.from('%PDF-1.4\n'),
  jpg: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ogg: Buffer.from('OggS\x00opus'),
  docx: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]),
  xlsx: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]),
};

describe('AttachmentSecurityService', () => {
  it.each([
    ['arquivo.pdf', 'application/pdf', samples.pdf],
    ['foto.jpg', 'image/jpeg', samples.jpg],
    ['imagem.png', 'image/png', samples.png],
    ['audio.ogg', 'audio/ogg', samples.ogg],
    ['documento.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', samples.docx],
    ['planilha.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', samples.xlsx],
  ])('validates supported attachment %s by magic bytes', (filename, declaredMime, buffer) => {
    const result = service.validate({
      buffer,
      filename,
      declaredMime,
      messageType: 'document',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('validated');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('blocks executable extensions even when content is present', () => {
    const result = service.validate({
      buffer: Buffer.from('MZ executable'),
      filename: 'payload.exe',
      declaredMime: 'application/octet-stream',
      messageType: 'document',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('dangerous_extension');
  });

  it('blocks MIME mismatch between extension and magic bytes', () => {
    const result = service.validate({
      buffer: samples.pdf,
      filename: 'foto.jpg',
      declaredMime: 'image/jpeg',
      messageType: 'image',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('mime_extension_mismatch');
  });

  it('blocks path traversal filenames before sanitization', () => {
    const result = service.validate({
      buffer: samples.pdf,
      filename: '../secret.pdf',
      declaredMime: 'application/pdf',
      messageType: 'document',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('path_traversal_attempt');
  });

  it('blocks files over the configured size limit', () => {
    const result = service.validate({
      buffer: Buffer.concat([samples.pdf, Buffer.alloc(64)]),
      filename: 'large.pdf',
      declaredMime: 'application/pdf',
      messageType: 'document',
      maxBytes: 4,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('file_too_large');
  });

  it('sanitizes PII-like filenames without leaking email or CPF', () => {
    expect(sanitizeAttachmentFilename('joao.12345678900@example.com-123.456.789-00.pdf')).toBe('[email].pdf');
  });
});
