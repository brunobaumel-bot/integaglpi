import { describe, expect, it, vi } from 'vitest';

import { MediaProcessingService } from '../src/domain/services/MediaProcessingService.js';

function makeService(overrides?: {
  getMediaUrl?: ReturnType<typeof vi.fn>;
  downloadMedia?: ReturnType<typeof vi.fn>;
  uploadDocument?: ReturnType<typeof vi.fn>;
  linkDocumentToTicket?: ReturnType<typeof vi.fn>;
  maxBytes?: number;
}) {
  const metaClient = {
    getMediaUrl: overrides?.getMediaUrl ?? vi.fn(),
    downloadMedia: overrides?.downloadMedia ?? vi.fn(),
  };
  const glpiClient = {
    uploadDocument: overrides?.uploadDocument ?? vi.fn(),
    linkDocumentToTicket: overrides?.linkDocumentToTicket ?? vi.fn(),
  };
  return new MediaProcessingService(metaClient, glpiClient, overrides?.maxBytes ?? 15_728_640);
}

const baseInput = {
  messageType: 'image',
  mediaMetadata: {
    mediaId: 'meta-media-id-111',
    mimeTypeFromWebhook: 'image/jpeg',
    fileName: null,
    caption: null,
  },
  ticketId: 100,
};

describe('MediaProcessingService', () => {
  it('processes image successfully: downloads, uploads, links and returns synced media_info', async () => {
    const fakeBuffer = Buffer.from('fake-image-data');
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'https://meta.cdn/file', mimeType: 'image/jpeg', fileSize: null });
    const downloadMedia = vi.fn().mockResolvedValue({ buffer: fakeBuffer, contentType: 'image/jpeg', size: fakeBuffer.byteLength });
    const uploadDocument = vi.fn().mockResolvedValue(55);
    const linkDocumentToTicket = vi.fn().mockResolvedValue(undefined);

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument, linkDocumentToTicket });
    const result = await service.processMedia(baseInput);

    expect(getMediaUrl).toHaveBeenCalledWith('meta-media-id-111');
    expect(downloadMedia).toHaveBeenCalledWith('https://meta.cdn/file', 15_728_640);
    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'image.jpg', mimeType: 'image/jpeg' }),
    );
    expect(linkDocumentToTicket).toHaveBeenCalledWith(55, 100);
    expect(result.mediaInfo.status).toBe('synced');
    expect(result.mediaInfo.glpi_document_id).toBe(55);
    expect(result.mediaInfo.glpi_ticket_id).toBe(100);
    expect(result.mediaInfo.file_size).toBe(fakeBuffer.byteLength);
    expect(result.followUpContent).toContain('image.jpg');
    expect(result.followUpContent).toContain('image/jpeg');
  });

  it('skips processing when webhook MIME is not in allowlist and returns skipped media_info', async () => {
    const getMediaUrl = vi.fn();
    const downloadMedia = vi.fn();
    const uploadDocument = vi.fn();

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument });
    const result = await service.processMedia({
      ...baseInput,
      messageType: 'video',
      mediaMetadata: { ...baseInput.mediaMetadata, mimeTypeFromWebhook: 'video/mp4' },
    });

    expect(getMediaUrl).not.toHaveBeenCalled();
    expect(downloadMedia).not.toHaveBeenCalled();
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(result.mediaInfo.status).toBe('skipped');
    expect(result.mediaInfo.glpi_document_id).toBeNull();
    expect(result.followUpContent).toContain('não suportado');
  });

  it('returns error status when download fails without throwing', async () => {
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'https://meta.cdn/file', mimeType: null, fileSize: null });
    const downloadMedia = vi.fn().mockRejectedValue(new Error('Connection timeout'));
    const uploadDocument = vi.fn();

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument });
    const result = await service.processMedia(baseInput);

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(result.mediaInfo.status).toBe('error');
    expect(result.mediaInfo.error).toContain('Connection timeout');
    expect(result.mediaInfo.glpi_document_id).toBeNull();
    expect(result.followUpContent).toContain('falha no processamento');
  });

  it('blocks media when webhook MIME is allowed but downloaded Content-Type is not allowed', async () => {
    const fakeBuffer = Buffer.from('danger');
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'https://meta.cdn/file', mimeType: 'image/jpeg', fileSize: null });
    const downloadMedia = vi.fn().mockResolvedValue({
      buffer: fakeBuffer,
      contentType: 'application/x-msdownload',
      size: fakeBuffer.byteLength,
    });
    const uploadDocument = vi.fn();
    const linkDocumentToTicket = vi.fn();

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument, linkDocumentToTicket });
    const result = await service.processMedia(baseInput);

    expect(result.mediaInfo.status).toBe('skipped');
    expect(result.mediaInfo.mime_type).toBe('application/x-msdownload');
    expect(result.mediaInfo.error).toContain('application/x-msdownload');
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(linkDocumentToTicket).not.toHaveBeenCalled();
  });

  it('returns error status when GLPI upload fails without throwing', async () => {
    const fakeBuffer = Buffer.from('data');
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'https://meta.cdn/file', mimeType: null, fileSize: null });
    const downloadMedia = vi.fn().mockResolvedValue({ buffer: fakeBuffer, contentType: 'image/jpeg', size: 4 });
    const uploadDocument = vi.fn().mockRejectedValue(new Error('GLPI upload timeout'));
    const linkDocumentToTicket = vi.fn();

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument, linkDocumentToTicket });
    const result = await service.processMedia(baseInput);

    expect(linkDocumentToTicket).not.toHaveBeenCalled();
    expect(result.mediaInfo.status).toBe('error');
    expect(result.mediaInfo.error).toContain('GLPI upload timeout');
  });

  it('uses document filename when provided and sanitizes it', async () => {
    const fakeBuffer = Buffer.from('pdf-data');
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'https://meta.cdn/doc', mimeType: null, fileSize: null });
    const downloadMedia = vi.fn().mockResolvedValue({ buffer: fakeBuffer, contentType: 'application/pdf', size: 8 });
    const uploadDocument = vi.fn().mockResolvedValue(77);
    const linkDocumentToTicket = vi.fn().mockResolvedValue(undefined);

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument, linkDocumentToTicket });
    const result = await service.processMedia({
      messageType: 'document',
      mediaMetadata: {
        mediaId: 'meta-doc-222',
        mimeTypeFromWebhook: 'application/pdf',
        fileName: '../../../etc/passwd',
        caption: 'Relatório mensal',
      },
      ticketId: 200,
    });

    expect(result.mediaInfo.status).toBe('synced');
    // Path traversal chars replaced
    expect(result.mediaInfo.file_name).not.toContain('../');
    expect(result.followUpContent).toContain('Relatório mensal');
  });

  it('rejects file exceeding maxBytes limit', async () => {
    const bigBuffer = Buffer.alloc(100);
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'https://meta.cdn/big', mimeType: null, fileSize: null });
    const downloadMedia = vi.fn().mockResolvedValue({ buffer: bigBuffer, contentType: 'image/jpeg', size: 100 });
    const uploadDocument = vi.fn();

    // maxBytes = 50 → download mock returns buffer of 100 but our service receives it already built
    // In reality downloadMedia would throw; here we simulate the service receiving an oversized buffer via error
    const downloadMediaThrows = vi.fn().mockRejectedValue(new Error('Media size 100 bytes exceeds limit of 50 bytes.'));
    const service = makeService({ getMediaUrl, downloadMedia: downloadMediaThrows, uploadDocument, maxBytes: 50 });
    const result = await service.processMedia(baseInput);

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(result.mediaInfo.status).toBe('error');
    expect(result.mediaInfo.error).toContain('exceeds limit');
  });

  it('includes caption in success followup', async () => {
    const fakeBuffer = Buffer.from('img');
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'https://meta.cdn/img', mimeType: null, fileSize: null });
    const downloadMedia = vi.fn().mockResolvedValue({ buffer: fakeBuffer, contentType: 'image/jpeg', size: 3 });
    const uploadDocument = vi.fn().mockResolvedValue(88);
    const linkDocumentToTicket = vi.fn().mockResolvedValue(undefined);

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument, linkDocumentToTicket });
    const result = await service.processMedia({
      messageType: 'image',
      mediaMetadata: { mediaId: 'img-333', mimeTypeFromWebhook: 'image/jpeg', fileName: null, caption: 'Comprovante' },
      ticketId: 300,
    });

    expect(result.followUpContent).toContain('Comprovante');
  });

  it('escapes angle brackets in captions before building GLPI followup content', async () => {
    const fakeBuffer = Buffer.from('img');
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'https://meta.cdn/img', mimeType: null, fileSize: null });
    const downloadMedia = vi.fn().mockResolvedValue({ buffer: fakeBuffer, contentType: 'image/jpeg', size: 3 });
    const uploadDocument = vi.fn().mockResolvedValue(89);
    const linkDocumentToTicket = vi.fn().mockResolvedValue(undefined);

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument, linkDocumentToTicket });
    const result = await service.processMedia({
      messageType: 'image',
      mediaMetadata: {
        mediaId: 'img-334',
        mimeTypeFromWebhook: 'image/jpeg',
        fileName: null,
        caption: '<script>alert(1)</script>',
      },
      ticketId: 300,
    });

    expect(result.followUpContent).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.followUpContent).not.toContain('<script>');
  });
});
