import { describe, expect, it, vi } from 'vitest';

import { GlpiRequestError } from '../src/errors/GlpiRequestError.js';
import { MediaProcessingService } from '../src/domain/services/MediaProcessingService.js';

function makeService(overrides?: {
  getMediaUrl?: ReturnType<typeof vi.fn>;
  downloadMedia?: ReturnType<typeof vi.fn>;
  uploadDocument?: ReturnType<typeof vi.fn>;
  linkDocumentToTicket?: ReturnType<typeof vi.fn>;
  getTicket?: ReturnType<typeof vi.fn>;
  maxBytes?: number;
}) {
  const metaClient = {
    getMediaUrl: overrides?.getMediaUrl ?? vi.fn(),
    downloadMedia: overrides?.downloadMedia ?? vi.fn(),
  };
  const glpiClient = {
    uploadDocument: overrides?.uploadDocument ?? vi.fn(),
    linkDocumentToTicket: overrides?.linkDocumentToTicket ?? vi.fn(),
    getTicket: overrides?.getTicket,
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

const JPEG_BUFFER = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
const MP4_BUFFER = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const WEBM_BUFFER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]);
const THREE_GP_BUFFER = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x33, 0x67, 0x70, 0x35]);
const PDF_BUFFER = Buffer.from('%PDF-1.4\n');

describe('MediaProcessingService', () => {
  it('processes image successfully: downloads, uploads, links and returns synced media_info', async () => {
    const fakeBuffer = JPEG_BUFFER;
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

  it('uploads the Document in the ticket entity before linking Document_Item when available', async () => {
    const fakeBuffer = JPEG_BUFFER;
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'https://meta.cdn/file', mimeType: 'image/jpeg', fileSize: null });
    const downloadMedia = vi.fn().mockResolvedValue({ buffer: fakeBuffer, contentType: 'image/jpeg', size: fakeBuffer.byteLength });
    const uploadDocument = vi.fn().mockResolvedValue(56);
    const linkDocumentToTicket = vi.fn().mockResolvedValue(undefined);
    const getTicket = vi.fn().mockResolvedValue({ id: 100, status: 2, entitiesId: 54 });

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument, linkDocumentToTicket, getTicket });
    const result = await service.processMedia(baseInput);

    expect(getTicket).toHaveBeenCalledWith(100);
    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'image.jpg', mimeType: 'image/jpeg', entitiesId: 54 }),
    );
    expect(linkDocumentToTicket).toHaveBeenCalledWith(56, 100);
    expect(result.mediaInfo.status).toBe('synced');
  });

  it('processes video successfully using the existing media pipeline', async () => {
    const fakeBuffer = MP4_BUFFER;
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'https://meta.cdn/video', mimeType: 'video/mp4', fileSize: null });
    const downloadMedia = vi.fn().mockResolvedValue({ buffer: fakeBuffer, contentType: 'video/mp4', size: fakeBuffer.byteLength });
    const uploadDocument = vi.fn().mockResolvedValue(57);
    const linkDocumentToTicket = vi.fn().mockResolvedValue(undefined);

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument, linkDocumentToTicket });
    const result = await service.processMedia({
      ...baseInput,
      messageType: 'video',
      mediaMetadata: { ...baseInput.mediaMetadata, mimeTypeFromWebhook: 'video/mp4' },
    });

    expect(getMediaUrl).toHaveBeenCalledWith('meta-media-id-111');
    expect(downloadMedia).toHaveBeenCalledWith('https://meta.cdn/video', 15_728_640);
    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'video.mp4', mimeType: 'video/mp4' }),
    );
    expect(linkDocumentToTicket).toHaveBeenCalledWith(57, 100);
    expect(result.mediaInfo.status).toBe('synced');
    expect(result.mediaInfo.glpi_document_id).toBe(57);
    expect(result.followUpContent).toContain('video.mp4');
  });

  it('processes audio/webm with a safe generated filename and links it to GLPI', async () => {
    const fakeBuffer = WEBM_BUFFER;
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'https://meta.cdn/audio', mimeType: 'audio/webm', fileSize: null });
    const downloadMedia = vi.fn().mockResolvedValue({ buffer: fakeBuffer, contentType: 'audio/webm', size: fakeBuffer.byteLength });
    const uploadDocument = vi.fn().mockResolvedValue(58);
    const linkDocumentToTicket = vi.fn().mockResolvedValue(undefined);

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument, linkDocumentToTicket });
    const result = await service.processMedia({
      ...baseInput,
      messageType: 'audio',
      mediaMetadata: { ...baseInput.mediaMetadata, mimeTypeFromWebhook: 'audio/webm', fileName: null },
    });

    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'audio.webm', mimeType: 'audio/webm' }),
    );
    expect(linkDocumentToTicket).toHaveBeenCalledWith(58, 100);
    expect(result.mediaInfo.status).toBe('synced');
    expect(result.mediaInfo.glpi_document_id).toBe(58);
    expect(result.followUpContent).toContain('audio.webm');
  });

  it('processes video/3gpp with a safe generated filename and links it to GLPI', async () => {
    const fakeBuffer = THREE_GP_BUFFER;
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'https://meta.cdn/video-3gpp', mimeType: 'video/3gpp', fileSize: null });
    const downloadMedia = vi.fn().mockResolvedValue({ buffer: fakeBuffer, contentType: 'video/3gpp', size: fakeBuffer.byteLength });
    const uploadDocument = vi.fn().mockResolvedValue(59);
    const linkDocumentToTicket = vi.fn().mockResolvedValue(undefined);

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument, linkDocumentToTicket });
    const result = await service.processMedia({
      ...baseInput,
      messageType: 'video',
      mediaMetadata: { ...baseInput.mediaMetadata, mimeTypeFromWebhook: 'video/3gpp', fileName: null },
    });

    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'video.3gp', mimeType: 'video/3gpp' }),
    );
    expect(linkDocumentToTicket).toHaveBeenCalledWith(59, 100);
    expect(result.mediaInfo.status).toBe('synced');
    expect(result.mediaInfo.glpi_document_id).toBe(59);
    expect(result.followUpContent).toContain('video.3gp');
  });

  it('skips processing when webhook MIME is not allowed and does not call media download or GLPI', async () => {
    const getMediaUrl = vi.fn();
    const downloadMedia = vi.fn();
    const uploadDocument = vi.fn();
    const linkDocumentToTicket = vi.fn();

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument, linkDocumentToTicket });
    const result = await service.processMedia({
      ...baseInput,
      mediaMetadata: { ...baseInput.mediaMetadata, mimeTypeFromWebhook: 'application/x-msdownload' },
    });

    expect(getMediaUrl).not.toHaveBeenCalled();
    expect(downloadMedia).not.toHaveBeenCalled();
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(linkDocumentToTicket).not.toHaveBeenCalled();
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
    const fakeBuffer = JPEG_BUFFER;
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

  it('preserves uploaded Document metadata when Document_Item linking is permission denied', async () => {
    const fakeBuffer = PDF_BUFFER;
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'https://meta.cdn/doc', mimeType: 'application/pdf', fileSize: null });
    const downloadMedia = vi.fn().mockResolvedValue({ buffer: fakeBuffer, contentType: 'application/pdf', size: fakeBuffer.byteLength });
    const uploadDocument = vi.fn().mockResolvedValue(3844);
    const linkDocumentToTicket = vi.fn().mockRejectedValue(new GlpiRequestError(
      'GLPI request failed for /Document_Item.',
      400,
      ['ERROR_GLPI_ADD', [{ id: false, message: 'Você não tem permissão para executar essa ação.' }]],
      'glpi_document_item_link',
      'https://glpi.example.local/apirest.php/Document_Item',
    ));

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument, linkDocumentToTicket });
    const result = await service.processMedia({
      messageType: 'document',
      mediaMetadata: {
        mediaId: 'meta-doc-link-denied',
        mimeTypeFromWebhook: 'application/pdf',
        fileName: 'contrato.pdf',
        caption: null,
      },
      ticketId: 2112319214,
      conversationId: 'conv-document-link-denied',
      messageId: 'wamid.document-link-denied',
      correlationId: 'WA-link-denied',
    });

    expect(result.mediaInfo).toMatchObject({
      status: 'uploaded_unlinked',
      glpi_document_id: 3844,
      glpi_ticket_id: 2112319214,
      error_code: 'GLPI_DOCUMENT_ITEM_PERMISSION_DENIED',
      error_stage: 'glpi_document_item_link',
    });
    expect(result.followUpContent).toContain('documento enviado ao GLPI');
    expect(result.followUpContent).toContain('não foi possível vincular automaticamente');
    expect(result.followUpContent).not.toContain('falha no processamento');
  });

  it('blocks document filename with path traversal before GLPI upload', async () => {
    const fakeBuffer = PDF_BUFFER;
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

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(result.mediaInfo.status).toBe('blocked');
    expect(result.mediaInfo.error).toBe('path_traversal_attempt');
    expect(result.followUpContent).toContain('Relatório mensal');
  });

  it('generates a safe filename for PDF documents without filename', async () => {
    const fakeBuffer = PDF_BUFFER;
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'https://meta.cdn/doc', mimeType: null, fileSize: null });
    const downloadMedia = vi.fn().mockResolvedValue({ buffer: fakeBuffer, contentType: 'application/pdf', size: 8 });
    const uploadDocument = vi.fn().mockResolvedValue(78);
    const linkDocumentToTicket = vi.fn().mockResolvedValue(undefined);

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument, linkDocumentToTicket });
    const result = await service.processMedia({
      messageType: 'document',
      mediaMetadata: {
        mediaId: 'meta-doc-without-filename',
        mimeTypeFromWebhook: 'application/pdf',
        fileName: null,
        caption: null,
      },
      ticketId: 201,
    });

    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'document.pdf', mimeType: 'application/pdf' }),
    );
    expect(result.mediaInfo.status).toBe('synced');
    expect(result.mediaInfo.file_name).toBe('document.pdf');
    expect(result.mediaInfo.mime_type).toBe('application/pdf');
    expect(result.followUpContent).toContain('document.pdf');
  });

  it('uses webhook PDF MIME when Meta download returns generic octet-stream', async () => {
    const fakeBuffer = PDF_BUFFER;
    const getMediaUrl = vi.fn().mockResolvedValue({ url: 'https://meta.cdn/doc', mimeType: null, fileSize: null });
    const downloadMedia = vi.fn().mockResolvedValue({
      buffer: fakeBuffer,
      contentType: 'application/octet-stream',
      size: fakeBuffer.byteLength,
    });
    const uploadDocument = vi.fn().mockResolvedValue(79);
    const linkDocumentToTicket = vi.fn().mockResolvedValue(undefined);

    const service = makeService({ getMediaUrl, downloadMedia, uploadDocument, linkDocumentToTicket });
    const result = await service.processMedia({
      messageType: 'document',
      mediaMetadata: {
        mediaId: 'meta-doc-octet-stream',
        mimeTypeFromWebhook: 'application/pdf',
        fileName: 'relatorio.pdf',
        caption: null,
      },
      ticketId: 202,
      conversationId: 'conv-202',
      messageId: 'wamid.doc-202',
      correlationId: 'WA-test-doc-202',
    });

    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'relatorio.pdf', mimeType: 'application/pdf' }),
    );
    expect(linkDocumentToTicket).toHaveBeenCalledWith(79, 202);
    expect(result.mediaInfo.status).toBe('synced');
    expect(result.mediaInfo.mime_type).toBe('application/pdf');
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
    const fakeBuffer = JPEG_BUFFER;
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
    const fakeBuffer = JPEG_BUFFER;
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
