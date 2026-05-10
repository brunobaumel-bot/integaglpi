import type { GlpiClient } from '../../adapters/glpi/GlpiClient.js';
import type { MetaClient } from '../../adapters/meta/MetaClient.js';
import type { InboundMediaMetadata } from '../../adapters/meta/metaWebhookTypes.js';
import { logger } from '../../infra/logger/logger.js';

export interface MediaInfo {
  status: 'synced' | 'error' | 'skipped';
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
  processed_at: string;
}

export interface ProcessMediaInput {
  messageType: string;
  mediaMetadata: InboundMediaMetadata;
  ticketId: number;
}

export interface ProcessMediaResult {
  mediaInfo: MediaInfo;
  followUpContent: string;
}

type GlpiMediaClient = Pick<GlpiClient, 'uploadDocument' | 'linkDocumentToTicket'>;
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
    const webhookMimeBase = webhookMime ? webhookMime.split(';')[0].trim() : null;

    if (webhookMimeBase && !ALLOWED_MIME_TYPES.has(webhookMimeBase)) {
      logger.info(
        { media_id: mediaMetadata.mediaId, mime_type: webhookMimeBase, message_type: messageType },
        '[integration-service][media][MIME_NOT_ALLOWED]',
      );
      return this.skippedResult(
        mediaMetadata, messageType, webhookMimeBase, ticketId, now,
        'tipo de mídia não suportado nesta versão',
      );
    }

    try {
      logger.info(
        { media_id: mediaMetadata.mediaId, message_type: messageType },
        '[integration-service][media][DOWNLOAD_START]',
      );

      const mediaUrlResponse = await this.metaClient.getMediaUrl(mediaMetadata.mediaId);

      if (!mediaUrlResponse.url) {
        throw new Error(`Empty media URL for media_id: ${mediaMetadata.mediaId}`);
      }

      const downloadResult = await this.metaClient.downloadMedia(mediaUrlResponse.url, this.maxBytes);

      const effectiveMimeBase = (downloadResult.contentType ?? webhookMimeBase ?? 'application/octet-stream')
        .split(';')[0].trim();

      if (!ALLOWED_MIME_TYPES.has(effectiveMimeBase)) {
        logger.warn(
          { media_id: mediaMetadata.mediaId, effective_mime: effectiveMimeBase },
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
          media_id: mediaMetadata.mediaId,
          filename: safeFilename,
          mime_type: effectiveMimeBase,
          size: downloadResult.size,
        },
        '[integration-service][media][DOWNLOAD_OK]',
      );

      const documentId = await this.glpiClient.uploadDocument({
        fileBuffer: downloadResult.buffer,
        filename: safeFilename,
        mimeType: effectiveMimeBase,
      });

      await this.glpiClient.linkDocumentToTicket(documentId, ticketId);

      logger.info(
        { media_id: mediaMetadata.mediaId, document_id: documentId, ticket_id: ticketId },
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
          media_id: mediaMetadata.mediaId,
          message_type: messageType,
          ticket_id: ticketId,
          errorMessage,
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
      processed_at: now,
    };
    return {
      mediaInfo: info,
      followUpContent: this.buildFallbackFollowUp(messageType, mimeType, mediaMetadata.caption, reason),
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
}
