import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = {
    ...originalEnv,
    GLPI_API_BASE_URL: 'https://glpi.example.local/apirest.php',
    GLPI_APP_TOKEN: 'app-token',
    GLPI_USER_TOKEN: 'user-token',
    GLPI_HTTP_TIMEOUT_MS: '5000',
    GLPI_HTTP_RETRY_COUNT: '1',
    META_APP_SECRET: 'secret',
    META_VERIFY_TOKEN: 'verify',
    META_ACCESS_TOKEN: 'meta-token',
    META_PHONE_NUMBER_ID: 'phone-id',
    REDIS_HOST: 'redis',
    REDIS_PORT: '6379',
    CONTACT_CACHE_TTL_SECONDS: '3600',
    DB_HOST: 'postgres',
    DB_PORT: '5432',
    DB_NAME: 'db',
    DB_USER: 'user',
    DB_PASSWORD: 'password',
    DB_SSL: 'false',
  };
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('GlpiClient', () => {
  it('creates a ticket using initSession and the classic Session-Token flow', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ id: 123 }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    const ticketId = await client.createTicket({
      title: 'Test',
      content: 'Body',
      requesterPhone: '+5511999999999',
      requesterName: 'User',
    });

    expect(ticketId).toBe(123);
    expect(httpClient.request).toHaveBeenCalledTimes(2);
    expect(httpClient.request).toHaveBeenNthCalledWith(
      1,
      'https://glpi.example.local/apirest.php/initSession/',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'App-Token': expect.any(String),
          Authorization: expect.stringContaining('user_token'),
        }),
      }),
    );
    expect(httpClient.request).toHaveBeenNthCalledWith(
      2,
      'https://glpi.example.local/apirest.php/Ticket',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'App-Token': expect.any(String),
          'Session-Token': 'session-123',
        }),
      }),
    );
  });

  it('creates a follow-up using the existing ticket path and Session-Token', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ id: 987 }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    const followUpId = await client.addFollowUp({
      ticketId: 55,
      content: 'Mensagem recebida via WhatsApp',
    });

    expect(followUpId).toBe(987);
    expect(httpClient.request).toHaveBeenCalledTimes(2);
    expect(httpClient.request).toHaveBeenNthCalledWith(
      2,
      'https://glpi.example.local/apirest.php/Ticket/55/ITILFollowup',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Session-Token': 'session-123',
        }),
        body: JSON.stringify({
          input: [
            {
              items_id: 55,
              itemtype: 'Ticket',
              content: 'Mensagem recebida via WhatsApp',
            },
          ],
        }),
      }),
    );
  });

  it('accepts GLPI follow-up response as an array with first item id', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify([{ id: 3162, message: '' }]), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    const followUpId = await client.addFollowUp({
      ticketId: 55,
      content: 'Mensagem recebida via WhatsApp',
    });

    expect(followUpId).toBe(3162);
  });

  it('updates ticket status with GLPI input object payload and accepts responses without id', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ message: 'Updated' }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await client.closeTicket(2112319108);

    expect(httpClient.request).toHaveBeenCalledTimes(2);
    expect(httpClient.request).toHaveBeenNthCalledWith(
      2,
      'https://glpi.example.local/apirest.php/Ticket/2112319108',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          input: {
            id: 2112319108,
            status: 6,
            _accepted: 1,
          },
        }),
        headers: expect.objectContaining({
          'Session-Token': 'session-123',
        }),
      }),
    );
  });

  it('keeps throwing on GLPI ticket update HTTP failures with response details', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const { GlpiRequestError } = await import('../src/errors/GlpiRequestError.js');
    const glpiErrorBody = { message: 'invalid status transition' };
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify(glpiErrorBody), { status: 400 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await expect(client.closeTicket(2112319108)).rejects.toMatchObject({
      name: 'GlpiRequestError',
      statusCode: 400,
      responseBody: glpiErrorBody,
      stage: 'glpi_ticket_update',
      requestUrl: 'https://glpi.example.local/apirest.php/Ticket/2112319108',
    } satisfies Partial<InstanceType<typeof GlpiRequestError>>);
  });

  it('approves a GLPI 11 ticket solution by adding an approval follow-up and validating final closed status', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319111, status: 5 }), { status: 200 }),
      new Response(JSON.stringify([{ id: 77, status: 2 }]), { status: 200 }),
      new Response(JSON.stringify({ id: 555 }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319111, status: 6 }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await client.approveTicketSolution(2112319111, 'Cliente aprovou a solucao via WhatsApp.');

    expect(httpClient.request).toHaveBeenCalledTimes(5);
    expect(httpClient.request).toHaveBeenNthCalledWith(
      2,
      'https://glpi.example.local/apirest.php/Ticket/2112319111',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(httpClient.request).toHaveBeenNthCalledWith(
      3,
      'https://glpi.example.local/apirest.php/Ticket/2112319111/ITILSolution',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(httpClient.request).toHaveBeenNthCalledWith(
      4,
      'https://glpi.example.local/apirest.php/Ticket/2112319111/ITILFollowup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          input: [
            {
              items_id: 2112319111,
              itemtype: 'Ticket',
              content: 'Cliente aprovou a solucao via WhatsApp.',
              add_close: 1,
            },
          ],
        }),
      }),
    );
    expect(httpClient.request).toHaveBeenNthCalledWith(
      5,
      'https://glpi.example.local/apirest.php/Ticket/2112319111',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('approves a solved GLPI ticket without requiring a waiting ITILSolution', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319111, status: 5 }), { status: 200 }),
      new Response(JSON.stringify([]), { status: 200 }),
      new Response(JSON.stringify({ id: 556 }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319111, status: 6 }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await client.approveTicketSolution(2112319111, 'Audit');

    expect(httpClient.request).toHaveBeenCalledTimes(5);
    expect(httpClient.request).toHaveBeenNthCalledWith(
      4,
      'https://glpi.example.local/apirest.php/Ticket/2112319111/ITILFollowup',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('keeps throwing when GLPI rejects the solution approval endpoint', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319111, status: 5 }), { status: 200 }),
      new Response(JSON.stringify([{ id: 77, status: 2 }]), { status: 200 }),
      new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await expect(client.approveTicketSolution(2112319111, 'Audit')).rejects.toMatchObject({
      name: 'GlpiRequestError',
      statusCode: 403,
      stage: 'glpi_solution_approve',
    });
    expect(httpClient.request).toHaveBeenCalledTimes(4);
  });

  it('fails safely when approval follow-up succeeds but GLPI ticket stays solved', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319111, status: 5 }), { status: 200 }),
      new Response(JSON.stringify([{ id: 77, status: 3 }]), { status: 200 }),
      new Response(JSON.stringify({ id: 557 }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319111, status: 5 }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await expect(client.approveTicketSolution(2112319111, 'Audit')).rejects.toMatchObject({
      name: 'GlpiRequestError',
      stage: 'glpi_solution_approve',
    });
    expect(httpClient.request).toHaveBeenCalledTimes(5);
  });

  it('reopens a GLPI 11 solved ticket by adding a reopen follow-up and validating final processing status', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319112, status: 5 }), { status: 200 }),
      new Response(JSON.stringify({ id: 558 }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319112, status: 2 }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await client.reopenTicketSolution(2112319112, 'Cliente solicitou reabertura via WhatsApp.');

    expect(httpClient.request).toHaveBeenCalledTimes(4);
    expect(httpClient.request).toHaveBeenNthCalledWith(
      3,
      'https://glpi.example.local/apirest.php/Ticket/2112319112/ITILFollowup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          input: [
            {
              items_id: 2112319112,
              itemtype: 'Ticket',
              content: 'Cliente solicitou reabertura via WhatsApp.',
              add_reopen: 1,
            },
          ],
        }),
      }),
    );
    expect(httpClient.request).toHaveBeenNthCalledWith(
      4,
      'https://glpi.example.local/apirest.php/Ticket/2112319112',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('fails safely when reopen follow-up succeeds but GLPI ticket stays solved', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319112, status: 5 }), { status: 200 }),
      new Response(JSON.stringify({ id: 559 }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319112, status: 5 }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await expect(client.reopenTicketSolution(2112319112, 'Audit')).rejects.toMatchObject({
      name: 'GlpiRequestError',
      stage: 'glpi_solution_reopen',
    });
    expect(httpClient.request).toHaveBeenCalledTimes(4);
  });

  it('keeps throwing when GLPI rejects the solution reopen endpoint', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319112, status: 5 }), { status: 200 }),
      new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await expect(client.reopenTicketSolution(2112319112, 'Audit')).rejects.toMatchObject({
      name: 'GlpiRequestError',
      statusCode: 403,
      stage: 'glpi_solution_reopen',
    });
    expect(httpClient.request).toHaveBeenCalledTimes(3);
  });
});
