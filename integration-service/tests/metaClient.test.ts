import { describe, expect, it, vi } from 'vitest';

import { MetaClient } from '../src/adapters/meta/MetaClient.js';

describe('MetaClient', () => {
  it('sends outbound messages using META_ACCESS_TOKEN and META_PHONE_NUMBER_ID', async () => {
    const responses = [new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 })];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new MetaClient(httpClient as never);

    await client.sendTextMessage({
      to: '5511999999999',
      body: 'hello world',
    });

    expect(httpClient.request).toHaveBeenCalledTimes(1);
    expect(httpClient.request).toHaveBeenCalledWith(
      expect.stringContaining('/messages'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('Bearer '),
        }),
      }),
    );
  });

  it('sends reply buttons using sanitized titles and option keys as ids', async () => {
    const httpClient = {
      request: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: 'wamid.buttons' }] }), { status: 200 }),
      ),
    };

    const client = new MetaClient(httpClient as never);

    await client.sendReplyButtons(
      '5511999999999',
      'Escolha uma opção:',
      [
        { id: 'suporte', title: 'Suporte técnico com título longo demais' },
        { id: 'financeiro', title: 'Financeiro\n\tInterno' },
      ],
    );

    const requestBody = JSON.parse(httpClient.request.mock.calls[0]?.[1].body as string) as {
      type: string;
      interactive: {
        type: string;
        action: { buttons: Array<{ reply: { id: string; title: string } }> };
      };
    };

    expect(requestBody.type).toBe('interactive');
    expect(requestBody.interactive.type).toBe('button');
    expect(requestBody.interactive.action.buttons).toEqual([
      { type: 'reply', reply: { id: 'suporte', title: 'Suporte técnico com' } },
      { type: 'reply', reply: { id: 'financeiro', title: 'Financeiro Interno' } },
    ]);
  });

  it('uploads and sends a PDF document through Meta media endpoints', async () => {
    const httpClient = {
      request: vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'meta-uploaded-media' }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: 'wamid.document' }] }), { status: 200 })),
    };

    const client = new MetaClient(httpClient as never);

    const mediaId = await client.uploadMedia({
      buffer: Buffer.from('%PDF-1.4'),
      mimeType: 'application/pdf',
      filename: 'relatorio.pdf',
    });
    await client.sendDocumentMessage({
      to: '5511999999999',
      mediaId,
      filename: 'relatorio.pdf',
      caption: 'Anexo do chamado #1.',
    });

    expect(mediaId).toBe('meta-uploaded-media');
    expect(httpClient.request).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/media'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.not.objectContaining({
          'Content-Type': expect.any(String),
        }),
      }),
    );
    expect(JSON.parse(httpClient.request.mock.calls[1]?.[1].body as string)).toMatchObject({
      type: 'document',
      document: {
        id: 'meta-uploaded-media',
        filename: 'relatorio.pdf',
        caption: 'Anexo do chamado #1.',
      },
    });
  });

  it('rejects media download before reading when Content-Length exceeds maxBytes', async () => {
    const httpClient = {
      request: vi.fn().mockResolvedValue(
        new Response(new ReadableStream(), {
          status: 200,
          headers: {
            'content-length': '100',
            'content-type': 'image/jpeg',
          },
        }),
      ),
    };

    const client = new MetaClient(httpClient as never);

    await expect(client.downloadMedia('https://meta.cdn/file', 50)).rejects.toThrow('exceeds limit');
  });

  it('rejects media download when streaming body is unavailable', async () => {
    const httpClient = {
      request: vi.fn().mockResolvedValue(
        new Response(null, {
          status: 200,
          headers: {
            'content-length': '10',
            'content-type': 'image/jpeg',
          },
        }),
      ),
    };

    const client = new MetaClient(httpClient as never);

    await expect(client.downloadMedia('https://meta.cdn/file', 50)).rejects.toThrow('DOWNLOAD_STREAM_UNSUPPORTED');
  });

  it('stops streaming media download when received bytes exceed maxBytes', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(30));
        controller.enqueue(new Uint8Array(25));
        controller.close();
      },
    });
    const httpClient = {
      request: vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'image/png',
          },
        }),
      ),
    };

    const client = new MetaClient(httpClient as never);

    await expect(client.downloadMedia('https://meta.cdn/file', 50)).rejects.toThrow('exceeds limit');
  });

  it('downloads media by stream when size remains within maxBytes', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello '));
        controller.enqueue(new TextEncoder().encode('media'));
        controller.close();
      },
    });
    const httpClient = {
      request: vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'application/pdf; charset=binary',
          },
        }),
      ),
    };

    const client = new MetaClient(httpClient as never);
    const result = await client.downloadMedia('https://meta.cdn/file', 50);

    expect(result.contentType).toBe('application/pdf');
    expect(result.size).toBe(11);
    expect(result.buffer.toString('utf8')).toBe('hello media');
  });
});
