import { env } from '../../config/env.js';
import { GlpiRequestError } from '../../errors/GlpiRequestError.js';
import { logger } from '../../infra/logger/logger.js';
import { ResilientHttpClient } from '../../infra/http/ResilientHttpClient.js';

interface MetaSendTextMessageInput {
  body: string;
  to: string;
}

export interface MetaReplyButton {
  id: string;
  title: string;
}

export interface MetaMediaUrlResponse {
  url: string;
  mimeType: string | null;
  fileSize: number | null;
}

export interface MetaMediaDownloadResult {
  buffer: Buffer;
  contentType: string | null;
  size: number;
}

export class MetaClient {
  private readonly graphApiBaseUrl = 'https://graph.facebook.com/v23.0';

  public constructor(private readonly httpClient: ResilientHttpClient) {}

  public async getMediaUrl(mediaId: string): Promise<MetaMediaUrlResponse> {
    const response = await this.httpClient.request(
      `${this.graphApiBaseUrl}/${mediaId}`,
      {
        method: 'GET',
        timeoutMs: env.GLPI_HTTP_TIMEOUT_MS,
        retries: env.GLPI_HTTP_RETRY_COUNT,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
        },
      },
    );

    const responseBody = await safeJson(response);

    if (!response.ok) {
      logger.error(
        {
          media_id: mediaId,
          meta_http_status: response.status,
          meta_error: extractMetaError(responseBody),
        },
        '[integration-service][meta][MEDIA_URL_ERROR]',
      );
      throw new GlpiRequestError('Meta media URL fetch failed.', response.status, responseBody);
    }

    const body = responseBody as Record<string, unknown>;

    return {
      url: typeof body.url === 'string' ? body.url : '',
      mimeType: typeof body.mime_type === 'string' ? body.mime_type : null,
      fileSize: typeof body.file_size === 'number' ? body.file_size : null,
    };
  }

  public async downloadMedia(url: string, maxBytes: number): Promise<MetaMediaDownloadResult> {
    const response = await this.httpClient.request(url, {
      method: 'GET',
      timeoutMs: 30_000,
      retries: 1,
      headers: {
        Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
      },
    });

    if (!response.ok) {
      throw new GlpiRequestError('Meta media download failed.', response.status);
    }

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? null;
    const contentLength = parseContentLength(response.headers.get('content-length'));

    if (contentLength !== null && contentLength > maxBytes) {
      throw new Error(
        `Media size ${contentLength} bytes exceeds limit of ${maxBytes} bytes.`,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('DOWNLOAD_STREAM_UNSUPPORTED');
    }

    const chunks: Buffer[] = [];
    let receivedBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = Buffer.from(value);
        receivedBytes += chunk.byteLength;

        if (receivedBytes > maxBytes) {
          await reader.cancel();
          throw new Error(
            `Media size ${receivedBytes} bytes exceeds limit of ${maxBytes} bytes.`,
          );
        }

        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }

    const buffer = Buffer.concat(chunks, receivedBytes);
    return { buffer, contentType, size: buffer.byteLength };
  }

  public async sendTextMessage(input: MetaSendTextMessageInput): Promise<unknown> {
    const response = await this.httpClient.request(
      `${this.graphApiBaseUrl}/${env.META_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        timeoutMs: env.GLPI_HTTP_TIMEOUT_MS,
        retries: env.GLPI_HTTP_RETRY_COUNT,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: input.to,
          type: 'text',
          text: {
            body: input.body,
          },
        }),
      },
    );

    const responseBody = await safeJson(response);

    if (!response.ok) {
      logger.error(
        {
          meta_http_status: response.status,
          meta_response_body: responseBody,
          meta_error: extractMetaError(responseBody),
        },
        '[integration-service][meta][SEND_ERROR]',
      );
      throw new GlpiRequestError('Meta message send failed.', response.status, responseBody);
    }

    return responseBody;
  }

  public async sendReplyButtons(
    to: string,
    bodyText: string,
    buttons: MetaReplyButton[],
    footerText?: string,
  ): Promise<unknown> {
    if (buttons.length < 1 || buttons.length > 3) {
      throw new Error('Meta reply buttons require between 1 and 3 buttons.');
    }

    const sanitizedButtons = buttons.map((button) => {
      const id = button.id.trim();
      if (!id) {
        throw new Error('Meta reply button id cannot be empty.');
      }

      return {
        id,
        title: sanitizeReplyButtonTitle(button.title),
      };
    });

    const response = await this.httpClient.request(
      `${this.graphApiBaseUrl}/${env.META_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        timeoutMs: env.GLPI_HTTP_TIMEOUT_MS,
        retries: env.GLPI_HTTP_RETRY_COUNT,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: {
              text: bodyText,
            },
            ...(footerText ? { footer: { text: footerText } } : {}),
            action: {
              buttons: sanitizedButtons.map((button) => ({
                type: 'reply',
                reply: {
                  id: button.id,
                  title: button.title,
                },
              })),
            },
          },
        }),
      },
    );

    const responseBody = await safeJson(response);

    if (!response.ok) {
      logger.error(
        {
          meta_http_status: response.status,
          meta_response_body: responseBody,
          meta_error: extractMetaError(responseBody),
        },
        '[integration-service][meta][SEND_BUTTONS_ERROR]',
      );
      throw new GlpiRequestError('Meta reply buttons send failed.', response.status, responseBody);
    }

    return responseBody;
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sanitizeReplyButtonTitle(title: string): string {
  const sanitized = title
    .trim()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 20)
    .trim();

  return sanitized || 'Opção';
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export interface MetaErrorDetail {
  type?: string;
  code?: number;
  error_subcode?: number;
  message?: string;
  fbtrace_id?: string;
}

export function extractMetaError(body: unknown): MetaErrorDetail | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const e = (body as Record<string, unknown>).error;
  if (!e || typeof e !== 'object') return undefined;
  const err = e as Record<string, unknown>;
  return {
    type:          typeof err.type          === 'string' ? err.type          : undefined,
    code:          typeof err.code          === 'number' ? err.code          : undefined,
    error_subcode: typeof err.error_subcode === 'number' ? err.error_subcode : undefined,
    message:       typeof err.message       === 'string' ? err.message       : undefined,
    fbtrace_id:    typeof err.fbtrace_id    === 'string' ? err.fbtrace_id    : undefined,
  };
}
