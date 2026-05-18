import type { GlpiClient } from '../../adapters/glpi/GlpiClient.js';
import type { MetaClient } from '../../adapters/meta/MetaClient.js';
import type { InboundMediaMetadata } from '../../adapters/meta/metaWebhookTypes.js';
import { GlpiRequestError } from '../../errors/GlpiRequestError.js';
import { logger } from '../../infra/logger/logger.js';

export interface MediaInfo {
  status: 'synced' | 'uploaded_unlinked' | 'error' | 'skipped';
  provider: 'meta_whatsapp';
  media_id: string;
  message_type: string;
  mime_type: string;
  download_content_type: string | null;
  file_name: string;
  file_size: number;
  caption: string | null;
  glpi_document_id: number | null;
  glpi_ticket_id: number | null;
  error: string | null;
  error_code?: string | null;
  error_stage?: string | null;
  processed_at: string;
}

export interface ProcessMediaInput {
  messageType: string;
  mediaMetadata: InboundMediaMetadata;
  ticketId: number;
  conversationId?: string;
  messageId?: string;
  correlationId?: string;
}

export interface ProcessMediaResult {
  mediaInfo: MediaInfo;
  followUpContent: string;
}

type GlpiMediaClient =
  Pick<GlpiClient, 'uploadDocument' | 'linkDocumentToTicket'>
  & Partial<Pick<GlpiClient, 'getTicket'>>;
type MetaMediaClient = Pick<MetaClient, 'getMediaUrl' | 'downloadMedia'>;

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
]);

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
};

function baseMimeType(value: string | null | undefined): string | null {
  const normalized = value?.split(';')[0]?.trim().toLowerCase() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function maskMediaId(mediaId: string): string {
  if (mediaId.length <= 8) {
    return '[redacted]';
  }

  return `${mediaId.slice(0, 4)}...${mediaId.slice(-4)}`;
}

function classifyError(error: unknown): string {
  const name = error instanceof Error ? error.name.toLowerCase() : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (name.includes('abort') || message.includes('abort') || message.includes('timeout')) {
    return 'timeout';
  }

  return 'processing_error';
}

function isDocumentItemPermissionDenied(error: unknown): boolean {
  if (error instanceof GlpiRequestError) {
    const responseText = JSON.stringify(error.responseBody ?? '').toLowerCase();
    return error.statusCode === 403
      || responseText.includes('permission')
      || responseText.includes('permiss')
      || responseText.includes('error_glpi_add');
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('permission') || message.includes('permiss');
}

export class MediaProcessingService {
  public constructor(
    private readonly metaClient: MetaMediaClient,
    private readonly glpiClient: GlpiMediaClient,
    private readonly maxBytes: number,
  ) {}

  public async processMedia(input: ProcessMediaInput): Promise<ProcessMediaResult> {
    const { messageType, mediaMetadata, ticketId } = input;
    const now = new Date().toISOString();
    const webhookMime = mediaMetadata.mimeTypeFromWebhook;
    const webhookMimeBase = baseMimeType(webhookMime);
    let stage = 'meta_media_url';

    if (webhookMimeBase && !ALLOWED_MIME_TYPES.has(webhookMimeBase)) {
      logger.info(
        {
          media_id: maskMediaId(mediaMetadata.mediaId),
          mime_type: webhookMimeBase,
          message_type: messageType,
          conversation_id: input.conversationId ?? null,
          message_id: input.messageId ?? null,
          correlation_id: input.correlationId ?? null,
        },
        '[integration-service][media][MIME_NOT_ALLOWED]',
      );
      return this.skippedResult(
        mediaMetadata, messageType, webhookMimeBase, ticketId, now,
        'tipo de mídia não suportado nesta versão',
      );
    }

    try {
      logger.info(
        {
          media_id: maskMediaId(mediaMetadata.mediaId),
          message_type: messageType,
          conversation_id: input.conversationId ?? null,
          message_id: input.messageId ?? null,
          correlation_id: input.correlationId ?? null,
          stage,
        },
        '[integration-service][media][DOWNLOAD_START]',
      );

      const mediaUrlResponse = await this.metaClient.getMediaUrl(mediaMetadata.mediaId);

      if (!mediaUrlResponse.url) {
        throw new Error(`Empty media URL for media_id: ${mediaMetadata.mediaId}`);
      }

      if (typeof mediaUrlResponse.fileSize === 'number' && mediaUrlResponse.fileSize > this.maxBytes) {
        throw new Error(
          `Media size ${mediaUrlResponse.fileSize} bytes exceeds limit of ${this.maxBytes} bytes.`,
        );
      }

      stage = 'media_download';
      const downloadResult = await this.metaClient.downloadMedia(mediaUrlResponse.url, this.maxBytes);

      const downloadedMimeBase = baseMimeType(downloadResult.contentType);
      const mediaUrlMimeBase = baseMimeType(mediaUrlResponse.mimeType);
      const effectiveMimeBase = downloadedMimeBase && downloadedMimeBase !== 'application/octet-stream'
        ? downloadedMimeBase
        : mediaUrlMimeBase ?? webhookMimeBase ?? 'application/octet-stream';

      stage = 'mime_validation';
      if (!ALLOWED_MIME_TYPES.has(effectiveMimeBase)) {
        logger.warn(
          {
            media_id: maskMediaId(mediaMetadata.mediaId),
            effective_mime: effectiveMimeBase,
            webhook_mime: webhookMimeBase,
            media_url_mime: mediaUrlMimeBase,
            download_content_type: downloadedMimeBase,
            conversation_id: input.conversationId ?? null,
            message_id: input.messageId ?? null,
            correlation_id: input.correlationId ?? null,
          },
          '[integration-service][media][MIME_NOT_ALLOWED_POST_DOWNLOAD]',
        );
        return this.skippedResult(
          mediaMetadata, messageType, effectiveMimeBase, ticketId, now,
          'tipo de mídia não suportado nesta versão',
          downloadResult.contentType, downloadResult.size,
        );
      }

      const safeFilename = this.buildSafeFilename(messageType, effectiveMimeBase, mediaMetadata.fileName);

      logger.info(
        {
          media_id: maskMediaId(mediaMetadata.mediaId),
          filename: safeFilename,
          mime_type: effectiveMimeBase,
          size: downloadResult.size,
          conversation_id: input.conversationId ?? null,
          message_id: input.messageId ?? null,
          correlation_id: input.correlationId ?? null,
        },
        '[integration-service][media][DOWNLOAD_OK]',
      );

      stage = 'glpi_document_upload';
      const ticketEntityId = await this.resolveTicketEntityId(ticketId, input);
      const documentId = await this.glpiClient.uploadDocument({
        fileBuffer: downloadResult.buffer,
        filename: safeFilename,
        mimeType: effectiveMimeBase,
        entitiesId: ticketEntityId,
      });

      stage = 'glpi_document_item_link';
      try {
        await this.glpiClient.linkDocumentToTicket(documentId, ticketId);
      } catch (error: unknown) {
        return this.uploadedUnlinkedResult({
          mediaMetadata,
          messageType,
          ticketId,
          now,
          documentId,
          safeFilename,
          effectiveMimeBase,
          downloadContentType: downloadResult.contentType,
          fileSize: downloadResult.size,
          error,
          context: input,
        });
      }

      logger.info(
        {
          media_id: maskMediaId(mediaMetadata.mediaId),
          document_id: documentId,
          ticket_id: ticketId,
          conversation_id: input.conversationId ?? null,
          message_id: input.messageId ?? null,
          correlation_id: input.correlationId ?? null,
        },
        '[integration-service][media][UPLOAD_OK]',
      );

      const info: MediaInfo = {
        status: 'synced',
        provider: 'meta_whatsapp',
        media_id: mediaMetadata.mediaId,
        message_type: messageType,
        mime_type: effectiveMimeBase,
        download_content_type: downloadResult.contentType,
        file_name: safeFilename,
        file_size: downloadResult.size,
        caption: mediaMetadata.caption,
        glpi_document_id: documentId,
        glpi_ticket_id: ticketId,
        error: null,
        error_code: null,
        error_stage: null,
        processed_at: now,
      };

      return {
        mediaInfo: info,
        followUpContent: this.buildSuccessFollowUp(
          safeFilename, effectiveMimeBase, downloadResult.size, mediaMetadata.caption,
        ),
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(
        {
          media_id: maskMediaId(mediaMetadata.mediaId),
          message_type: messageType,
          mime_type: webhookMimeBase ?? null,
          filename: mediaMetadata.fileName ?? null,
          ticket_id: ticketId,
          conversation_id: input.conversationId ?? null,
          message_id: input.messageId ?? null,
          correlation_id: input.correlationId ?? null,
          stage,
          error_type: classifyError(error),
          error_message: errorMessage,
        },
        '[integration-service][media][PROCESS_ERROR]',
      );

      const info: MediaInfo = {
        status: 'error',
        provider: 'meta_whatsapp',
        media_id: mediaMetadata.mediaId,
        message_type: messageType,
        mime_type: webhookMimeBase ?? 'unknown',
        download_content_type: null,
        file_name: this.buildSafeFilename(messageType, webhookMimeBase ?? '', mediaMetadata.fileName),
        file_size: 0,
        caption: mediaMetadata.caption,
        glpi_document_id: null,
        glpi_ticket_id: ticketId,
        error: errorMessage,
        error_code: null,
        error_stage: stage,
        processed_at: now,
      };

      return {
        mediaInfo: info,
        followUpContent: this.buildFallbackFollowUp(
          messageType, webhookMimeBase, mediaMetadata.caption, 'falha no processamento',
        ),
      };
    }
  }

  private skippedResult(
    mediaMetadata: InboundMediaMetadata,
    messageType: string,
    mimeType: string | null,
    ticketId: number,
    now: string,
    reason: string,
    downloadContentType?: string | null,
    fileSize?: number,
  ): ProcessMediaResult {
    const info: MediaInfo = {
      status: 'skipped',
      provider: 'meta_whatsapp',
      media_id: mediaMetadata.mediaId,
      message_type: messageType,
      mime_type: mimeType ?? 'unknown',
      download_content_type: downloadContentType ?? null,
      file_name: this.buildSafeFilename(messageType, mimeType ?? '', mediaMetadata.fileName),
      file_size: fileSize ?? 0,
      caption: mediaMetadata.caption,
      glpi_document_id: null,
      glpi_ticket_id: ticketId,
      error: `${reason}: ${mimeType ?? 'unknown'}`,
      error_code: null,
      error_stage: null,
      processed_at: now,
    };
    return {
      mediaInfo: info,
      followUpContent: this.buildFallbackFollowUp(messageType, mimeType, mediaMetadata.caption, reason),
    };
  }

  private async resolveTicketEntityId(ticketId: number, input: ProcessMediaInput): Promise<number | null> {
    if (typeof this.glpiClient.getTicket !== 'function') {
      return null;
    }

    try {
      const ticket = await this.glpiClient.getTicket(ticketId);
      if (typeof ticket.entitiesId === 'number' && Number.isFinite(ticket.entitiesId) && ticket.entitiesId > 0) {
        return Math.trunc(ticket.entitiesId);
      }
    } catch (error: unknown) {
      logger.warn(
        {
          stage: 'glpi_ticket_read',
          ticket_id: ticketId,
          conversation_id: input.conversationId ?? null,
          message_id: input.messageId ?? null,
          correlation_id: input.correlationId ?? null,
          error_message: error instanceof Error ? error.message : String(error),
        },
        '[integration-service][media][TICKET_ENTITY_LOOKUP_FAILED]',
      );
    }

    return null;
  }

  private uploadedUnlinkedResult(input: {
    mediaMetadata: InboundMediaMetadata;
    messageType: string;
    ticketId: number;
    now: string;
    documentId: number;
    safeFilename: string;
    effectiveMimeBase: string;
    downloadContentType: string | null;
    fileSize: number;
    error: unknown;
    context: ProcessMediaInput;
  }): ProcessMediaResult {
    const errorMessage = input.error instanceof Error ? input.error.message : String(input.error);
    const errorCode = isDocumentItemPermissionDenied(input.error)
      ? 'GLPI_DOCUMENT_ITEM_PERMISSION_DENIED'
      : 'GLPI_DOCUMENT_ITEM_LINK_FAILED';

    logger.error(
      {
        media_id: maskMediaId(input.mediaMetadata.mediaId),
        document_id: input.documentId,
        ticket_id: input.ticketId,
        conversation_id: input.context.conversationId ?? null,
        message_id: input.context.messageId ?? null,
        correlation_id: input.context.correlationId ?? null,
        stage: 'glpi_document_item_link',
        error_code: errorCode,
        error_type: classifyError(input.error),
        error_message: errorMessage,
      },
      '[integration-service][media][DOCUMENT_UPLOADED_UNLINKED]',
    );

    return {
      mediaInfo: {
        status: 'uploaded_unlinked',
        provider: 'meta_whatsapp',
        media_id: input.mediaMetadata.mediaId,
        message_type: input.messageType,
        mime_type: input.effectiveMimeBase,
        download_content_type: input.downloadContentType,
        file_name: input.safeFilename,
        file_size: input.fileSize,
        caption: input.mediaMetadata.caption,
        glpi_document_id: input.documentId,
        glpi_ticket_id: input.ticketId,
        error: errorMessage,
        error_code: errorCode,
        error_stage: 'glpi_document_item_link',
        processed_at: input.now,
      },
      followUpContent: this.buildUploadedUnlinkedFollowUp(input.safeFilename, input.mediaMetadata.caption),
    };
  }

  private buildSafeFilename(messageType: string, mimeType: string | null | undefined, rawFilename: string | null): string {
    if (rawFilename) {
      const sanitized = rawFilename
        .replace(/[/\\:*?"<>|]/g, '_')
        .replace(/\.\./g, '_')
        .replace(/\x00/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 100)
        .trim();
      if (sanitized && sanitized !== '_') {
        return sanitized;
      }
    }
    const ext = MIME_TO_EXTENSION[mimeType?.split(';')[0].trim() ?? ''] ?? '';
    return `${messageType}${ext}`;
  }

  private formatHumanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }

  private sanitizeText(text: string): string {
    return text
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .slice(0, 1_000);
  }

  private buildSuccessFollowUp(
    filename: string, mimeType: string, size: number, caption: string | null,
  ): string {
    const lines = [
      `[WhatsApp] Cliente enviou uma mídia: ${filename} (${mimeType}, ${this.formatHumanSize(size)}).`,
    ];
    if (caption) {
      lines.push(`Legenda: ${this.sanitizeText(caption)}`);
    }
    return lines.join('\n');
  }

  private buildFallbackFollowUp(
    messageType: string, mimeType: string | null | undefined, caption: string | null, reason: string,
  ): string {
    const typeLabel = mimeType ? `${messageType} (${mimeType})` : messageType;
    const lines = [`[WhatsApp] Mídia recebida: [${typeLabel}] — ${reason}.`];
    if (caption) {
      lines.push(`Legenda: ${this.sanitizeText(caption)}`);
    }
    return lines.join('\n');
  }

  private buildUploadedUnlinkedFollowUp(filename: string, caption: string | null): string {
    const lines = [
      `[WhatsApp] Mídia recebida: ${this.sanitizeText(filename)} — documento enviado ao GLPI, mas não foi possível vincular automaticamente ao chamado.`,
    ];
    if (caption) {
      lines.push(`Legenda: ${this.sanitizeText(caption)}`);
    }
    return lines.join('\n');
  }
}
