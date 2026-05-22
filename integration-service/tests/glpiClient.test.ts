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
  it('maps GLPI soft-deleted ticket flags from getTicket', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({
        id: 2112319001,
        status: 2,
        entities_id: 42,
        is_deleted: 1,
      }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await expect(client.getTicket(2112319001)).resolves.toMatchObject({
      id: 2112319001,
      status: 2,
      entitiesId: 42,
      isDeleted: true,
    });
  });

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
      entitiesId: 42,
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

  it('rejects ticket creation without a valid entity', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const httpClient = {
      request: vi.fn(),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await expect(client.createTicket({
      title: 'No entity',
      content: 'Body',
      requesterPhone: '+5511999999999',
      requesterName: 'User',
      entitiesId: 0,
    })).rejects.toThrow('GLPI_TICKET_ENTITY_REQUIRED');
    expect(httpClient.request).not.toHaveBeenCalled();
  });

  it('wraps initSession aborts as a controlled GLPI timeout error', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const { GlpiRequestError } = await import('../src/errors/GlpiRequestError.js');
    const abortError = new Error('This operation was aborted.') as Error & { name: string; code: number };
    abortError.name = 'AbortError';
    abortError.code = 20;
    const httpClient = {
      request: vi.fn().mockRejectedValue(abortError),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await expect(client.createTicket({
      title: 'Timeout',
      content: 'Body',
      requesterPhone: '+5511999999999',
      requesterName: 'User',
      entitiesId: 42,
    })).rejects.toMatchObject({
      name: 'GlpiRequestError',
      message: 'GLPI initSession timed out.',
      stage: 'glpi_init_session',
      requestUrl: 'https://glpi.example.local/apirest.php/initSession/',
      responseBody: expect.objectContaining({
        error_type: 'timeout',
        error_name: 'AbortError',
        error_message: 'This operation was aborted.',
        error_code: 20,
        timeout_ms: 5000,
      }),
    } satisfies Partial<InstanceType<typeof GlpiRequestError>>);
  });

  it('wraps ticket create aborts with the ticket-create stage and runtime timeout', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const abortError = new Error('This operation was aborted.') as Error & { name: string; code: number };
    abortError.name = 'AbortError';
    abortError.code = 20;
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
    ];
    const httpClient = {
      request: vi.fn()
        .mockImplementationOnce(async () => responses.shift())
        .mockRejectedValueOnce(abortError),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await expect(client.createTicket({
      title: 'Timeout',
      content: 'Body',
      requesterPhone: '+5511999999999',
      requesterName: 'User',
      entitiesId: 42,
    }, { timeoutMs: 45_000 })).rejects.toMatchObject({
      name: 'GlpiRequestError',
      message: 'GLPI request timed out.',
      stage: 'glpi_ticket_create',
      requestUrl: 'https://glpi.example.local/apirest.php/Ticket',
      responseBody: expect.objectContaining({
        error_type: 'timeout',
        error_name: 'AbortError',
        error_message: 'This operation was aborted.',
        error_code: 20,
        timeout_ms: 45_000,
      }),
    });
    expect(httpClient.request).toHaveBeenNthCalledWith(
      2,
      'https://glpi.example.local/apirest.php/Ticket',
      expect.objectContaining({
        timeoutMs: 45_000,
      }),
    );
  });

  it('maps entitiesId > 0 to GLPI entities_id on ticket create', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-xyz' }), { status: 200 }),
      new Response(JSON.stringify({ id: 555 }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await client.createTicket({
      title: 'Ent',
      content: 'Body',
      requesterPhone: '+5511999999999',
      requesterName: null,
      entitiesId: 42,
    });

    const ticketCall = (httpClient.request as ReturnType<typeof vi.fn>).mock.calls[1];
    const body = JSON.parse(String(ticketCall[1].body)) as {
      input: Array<{ entities_id?: number }>;
    };

    expect(body.input[0]?.entities_id).toBe(42);
  });

  it('adds linked GLPI requester user to ticket create payload when available', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-xyz' }), { status: 200 }),
      new Response(JSON.stringify({ id: 555 }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await client.createTicket({
      title: 'Ent',
      content: 'Body',
      requesterPhone: '+5511999999999',
      requesterName: 'Maria',
      entitiesId: 42,
      requesterUserId: 77,
    });

    const ticketCall = (httpClient.request as ReturnType<typeof vi.fn>).mock.calls[1];
    const body = JSON.parse(String(ticketCall[1].body)) as {
      input: Array<{ _users_id_requester?: number }>;
    };

    expect(body.input[0]?._users_id_requester).toBe(77);
  });

  it('searches GLPI users by normalized email without creating a local fallback match', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({
        data: [
          {
            2: 44,
            1: 'Maria Silva',
            5: 'maria@example.com',
            8: 1,
          },
        ],
      }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    const users = await client.findUsersByEmail(' MARIA@EXAMPLE.COM ');

    expect(users).toEqual([
      { id: 44, name: 'Maria Silva', email: 'maria@example.com', isActive: true },
    ]);
    const searchCall = (httpClient.request as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(searchCall[0]).toContain('/search/User?');
    expect(decodeURIComponent(String(searchCall[0]))).toContain('criteria[0][field]=5');
    expect(decodeURIComponent(String(searchCall[0]))).toContain('criteria[0][value]=maria@example.com');
  });

  it('finds an entity-selection ticket by correlation marker without exposing Meta or plugin tokens', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({
        data: [
          {
            2: 2112319301,
            1: 'Atendimento WhatsApp',
            12: 1,
            80: 119,
          },
        ],
      }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);
    const ticket = await client.findTicketForEntitySelection({
      correlationMarker: '[IntegraGLPI correlation_id: entity_selection:conv-1:119]',
      requesterPhone: '+5511999999999',
      entitiesId: 119,
    });

    expect(ticket).toEqual({
      id: 2112319301,
      status: 1,
      entitiesId: 119,
    });
    const searchCall = (httpClient.request as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(searchCall[0]).toContain('/search/Ticket?');
    expect(decodeURIComponent(String(searchCall[0]))).toContain('criteria[0][field]=21');
    const decodedSearchUrl = decodeURIComponent(String(searchCall[0])).replace(/\+/g, ' ');
    expect(decodedSearchUrl).toContain(
      'criteria[0][value]=[IntegraGLPI correlation_id: entity_selection:conv-1:119]',
    );
  });

  it('creates a restricted GLPI requester user without password, admin profile or active login', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ id: 77 }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    const userId = await client.createRestrictedRequesterUser({
      email: ' MARIA@EXAMPLE.COM ',
      requesterName: 'Maria Silva',
      companyName: 'Etica',
      phoneE164: '+5541999999999',
      entitiesId: 54,
    });

    expect(userId).toBe(77);
    const createUserCall = (httpClient.request as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(createUserCall[0]).toBe('https://glpi.example.local/apirest.php/User');
    const body = JSON.parse(String(createUserCall[1].body)) as {
      input: Array<Record<string, unknown>>;
    };

    expect(body.input[0]).toMatchObject({
      name: 'maria@example.com',
      realname: 'Maria Silva',
      firstname: '',
      phone: '+5541999999999',
      entities_id: 54,
      is_active: 0,
    });
    expect(body.input[0]).not.toHaveProperty('password');
    expect(body.input[0]).not.toHaveProperty('profiles_id');
  });

  it('blocks restricted GLPI user creation without a real entity', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const httpClient = {
      request: vi.fn(),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await expect(client.createRestrictedRequesterUser({
      email: 'maria@example.com',
      requesterName: 'Maria Silva',
      companyName: 'Etica',
      phoneE164: '+5541999999999',
      entitiesId: 0,
    })).rejects.toThrow('GLPI_USER_ENTITY_REQUIRED');
    expect(httpClient.request).not.toHaveBeenCalled();
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

  it('uploads a GLPI document with the ticket entity in uploadManifest when provided', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ id: 3844 }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    const documentId = await client.uploadDocument({
      fileBuffer: Buffer.from('pdf'),
      filename: 'contrato.pdf',
      mimeType: 'application/pdf',
      entitiesId: 54,
    });

    expect(documentId).toBe(3844);
    const uploadCall = (httpClient.request as ReturnType<typeof vi.fn>).mock.calls[1];
    const formData = uploadCall[1].body as FormData;
    const manifest = JSON.parse(String(formData.get('uploadManifest'))) as {
      input: { entities_id?: number; is_recursive?: number; name?: string };
    };

    expect(uploadCall[0]).toBe('https://glpi.example.local/apirest.php/Document');
    expect(manifest.input).toMatchObject({
      name: 'contrato.pdf',
      entities_id: 54,
      is_recursive: 0,
    });
  });

  it('links a document to a ticket using Document_Item payload', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ id: 9001 }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await client.linkDocumentToTicket(3844, 2112319214);

    expect(httpClient.request).toHaveBeenCalledTimes(2);
    expect(httpClient.request).toHaveBeenNthCalledWith(
      2,
      'https://glpi.example.local/apirest.php/Document_Item',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          input: [{ documents_id: 3844, items_id: 2112319214, itemtype: 'Ticket' }],
        }),
      }),
    );
  });

  it('retries document linking through the ticket sub-item endpoint with complete payload when Document_Item is denied', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify(['ERROR_GLPI_ADD', [{ id: false, message: 'Você não tem permissão para executar essa ação.' }]]), { status: 400 }),
      new Response(JSON.stringify({ id: 9002 }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await client.linkDocumentToTicket(3844, 2112319214);

    expect(httpClient.request).toHaveBeenCalledTimes(3);
    expect(httpClient.request).toHaveBeenNthCalledWith(
      2,
      'https://glpi.example.local/apirest.php/Document_Item',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(httpClient.request).toHaveBeenNthCalledWith(
      3,
      'https://glpi.example.local/apirest.php/Ticket/2112319214/Document_Item',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          input: [{ documents_id: 3844, items_id: 2112319214, itemtype: 'Ticket' }],
        }),
      }),
    );
  });

  it('retries ticket sub-item document linking with minimal payload when complete nested payload is denied', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify(['ERROR_GLPI_ADD', [{ id: false, message: 'flat denied' }]]), { status: 400 }),
      new Response(JSON.stringify(['ERROR_GLPI_ADD', [{ id: false, message: 'nested complete denied' }]]), { status: 400 }),
      new Response(JSON.stringify({ id: 9005 }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await client.linkDocumentToTicket(3848, 2112319218);

    expect(httpClient.request).toHaveBeenCalledTimes(4);
    expect(httpClient.request).toHaveBeenNthCalledWith(
      3,
      'https://glpi.example.local/apirest.php/Ticket/2112319218/Document_Item',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          input: [{ documents_id: 3848, items_id: 2112319218, itemtype: 'Ticket' }],
        }),
      }),
    );
    expect(httpClient.request).toHaveBeenNthCalledWith(
      4,
      'https://glpi.example.local/apirest.php/Ticket/2112319218/Document_Item',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          input: [{ documents_id: 3848 }],
        }),
      }),
    );
  });

  it('retries document linking when Document_Item returns HTTP OK without a valid link id', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify([{ id: false, message: 'link not created' }]), { status: 200 }),
      new Response(JSON.stringify({ id: 9003 }), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await client.linkDocumentToTicket(3845, 2112319215);

    expect(httpClient.request).toHaveBeenCalledTimes(3);
    expect(httpClient.request).toHaveBeenNthCalledWith(
      2,
      'https://glpi.example.local/apirest.php/Document_Item',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          input: [{ documents_id: 3845, items_id: 2112319215, itemtype: 'Ticket' }],
        }),
      }),
    );
    expect(httpClient.request).toHaveBeenNthCalledWith(
      3,
      'https://glpi.example.local/apirest.php/Ticket/2112319215/Document_Item',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          input: [{ documents_id: 3845, items_id: 2112319215, itemtype: 'Ticket' }],
        }),
      }),
    );
  });

  it('fails document linking when both Document_Item endpoints return no valid link id', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify([{ id: false, message: 'link not created' }]), { status: 200 }),
      new Response(JSON.stringify([{ id: false, message: 'nested link not created' }]), { status: 200 }),
      new Response(JSON.stringify([{ id: false, message: 'minimal nested link not created' }]), { status: 200 }),
    ];

    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };

    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await expect(client.linkDocumentToTicket(3846, 2112319216)).rejects.toMatchObject({
      message: 'GLPI nested document link did not return a valid ID.',
      stage: 'glpi_document_item_link',
    });
    expect(httpClient.request).toHaveBeenCalledTimes(4);
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

  it('closes a ticket for inactivity by creating an ITILSolution and validating closed status', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319227, status: 2 }), { status: 200 }),
      new Response(JSON.stringify({ id: 7001 }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319227, status: 5 }), { status: 200 }),
      new Response(JSON.stringify({ message: 'Updated' }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319227, status: 6 }), { status: 200 }),
    ];
    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };
    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await client.solveTicketByInactivity(2112319227, 'Encerrado por falta de retorno do usuário');

    expect(httpClient.request).toHaveBeenCalledWith(
      'https://glpi.example.local/apirest.php/Ticket/2112319227/ITILSolution',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          input: [{
            items_id: 2112319227,
            itemtype: 'Ticket',
            content: 'Encerrado por falta de retorno do usuário',
          }],
        }),
      }),
    );
    expect(httpClient.request).toHaveBeenCalledWith(
      'https://glpi.example.local/apirest.php/Ticket/2112319227',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          input: {
            id: 2112319227,
            status: 6,
            _accepted: 1,
          },
        }),
      }),
    );
  });

  it('falls back to ticket status update before closing when inactivity solution does not solve the ticket', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319227, status: 2 }), { status: 200 }),
      new Response(JSON.stringify({ id: 7001 }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319227, status: 2 }), { status: 200 }),
      new Response(JSON.stringify({ message: 'Updated' }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319227, status: 5 }), { status: 200 }),
      new Response(JSON.stringify({ message: 'Updated' }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319227, status: 6 }), { status: 200 }),
    ];
    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };
    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await client.solveTicketByInactivity(2112319227, 'Encerrado por falta de retorno do usuário');

    expect(httpClient.request).toHaveBeenCalledWith(
      'https://glpi.example.local/apirest.php/Ticket/2112319227',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          input: {
            id: 2112319227,
            status: 5,
            content: 'Encerrado por falta de retorno do usuário',
          },
        }),
      }),
    );
    expect(httpClient.request).toHaveBeenCalledWith(
      'https://glpi.example.local/apirest.php/Ticket/2112319227',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          input: {
            id: 2112319227,
            status: 6,
            _accepted: 1,
          },
        }),
      }),
    );
  });

  it('closes an already solved ticket for inactivity without creating another solution', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    const responses = [
      new Response(JSON.stringify({ session_token: 'session-123' }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319227, status: 5 }), { status: 200 }),
      new Response(JSON.stringify({ message: 'Updated' }), { status: 200 }),
      new Response(JSON.stringify({ id: 2112319227, status: 6 }), { status: 200 }),
    ];
    const httpClient = {
      request: vi.fn().mockImplementation(async () => responses.shift()),
    };
    const client = new GlpiClient('https://glpi.example.local/apirest.php', httpClient as never);

    await client.solveTicketByInactivity(2112319227, 'Encerrado por falta de retorno do usuário');

    expect(httpClient.request).not.toHaveBeenCalledWith(
      'https://glpi.example.local/apirest.php/Ticket/2112319227/ITILSolution',
      expect.anything(),
    );
    expect(httpClient.request).toHaveBeenCalledWith(
      'https://glpi.example.local/apirest.php/Ticket/2112319227',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          input: {
            id: 2112319227,
            status: 6,
            _accepted: 1,
          },
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
