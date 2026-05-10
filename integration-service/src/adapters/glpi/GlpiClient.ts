import type {
  AddGlpiFollowUpInput,
  CreateGlpiTicketInput,
  GlpiContactLookupResult,
  GlpiTicket,
  UploadGlpiDocumentInput,
} from './glpiTypes.js';

import { env } from '../../config/env.js';
import type { GlpiFailureStage } from '../../errors/GlpiRequestError.js';
import { GlpiRequestError } from '../../errors/GlpiRequestError.js';
import { logger } from '../../infra/logger/logger.js';
import { sanitizeUrlForLog } from '../../infra/logger/sanitizeUrlForLog.js';
import { ResilientHttpClient } from '../../infra/http/ResilientHttpClient.js';

import { joinApirestUrl } from './glpiUrlUtils.js';
import { logGlpiHttpPreflight, maskSecret } from './logGlpiHttpPreflight.js';

interface JsonObject {
  [key: string]: unknown;
}

interface GlpiRequestRuntimeOptions {
  timeoutMs?: number;
}

interface GlpiTicketSolution {
  id: number;
  status: number | null;
}

const SENSITIVE_LOG_KEYS = new Set([
  'app-token',
  'app_token',
  'authorization',
  'password',
  'senha',
  'session-token',
  'session_token',
  'token',
  'user_token',
]);

/** Resposta `/search/:itemtype`: linhas usam índices numéricos de colunas (ex.: `2` = ID). */
function readIdFromGlpiSearchRow(row: JsonObject): number | null {
  const raw = row[2] ?? row['2'] ?? row.id;

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }

  if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }

  return null;
}

function readNameFromGlpiSearchRow(row: JsonObject): string | null {
  const raw = row[1] ?? row['1'] ?? row[34] ?? row['34'];

  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function readSessionToken(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const t = (body as JsonObject).session_token;

  return typeof t === 'string' && t.length > 0 ? t : null;
}

function sanitizeSessionResponseForLog(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) {
    return body;
  }

  const o = { ...(body as JsonObject) };

  if (typeof o.session_token === 'string') {
    o.session_token = maskSecret(o.session_token);
  }

  return o;
}

function sanitizeGlpiValueForLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeGlpiValueForLog(item));
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const sanitized: JsonObject = {};
  for (const [key, val] of Object.entries(value as JsonObject)) {
    if (SENSITIVE_LOG_KEYS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    sanitized[key] = sanitizeGlpiValueForLog(val);
  }

  return sanitized;
}

function parseRequestBodyForLog(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') {
    return body === undefined ? undefined : '[non_string_body]';
  }

  try {
    return sanitizeGlpiValueForLog(JSON.parse(body));
  } catch {
    return '[unparseable_body]';
  }
}

/** GLPI REST exige payload `{ input: [...] }` com campos do CommonITIL/Ticket (`name`, não `title`). */
function buildTicketCreatePayload(input: CreateGlpiTicketInput): JsonObject {
  const safeName = input.requesterName ?? '';
  const extraContact =
    safeName.length > 0
      ? `\n\n---\nTelefone (WhatsApp): ${input.requesterPhone}\nNome: ${safeName}`
      : `\n\n---\nTelefone (WhatsApp): ${input.requesterPhone}`;

  const content = `${input.content}${extraContact}`;

  const ticketInput: JsonObject = {
    name: input.title,
    content,
    entities_id: 0,
    type: 1,
    status: 1,
    urgency: 3,
    impact: 3,
    priority: 3,
  };

  if (input.assignedUserId != null && input.assignedUserId > 0) {
    ticketInput._users_id_assign = input.assignedUserId;
  } else if (input.assignedGroupId != null && input.assignedGroupId > 0) {
    ticketInput._groups_id_assign = input.assignedGroupId;
  }

  return {
    input: [ticketInput],
  };
}

function buildTicketFollowUpPayload(input: AddGlpiFollowUpInput): JsonObject {
  return {
    input: [
      {
        items_id: input.ticketId,
        itemtype: 'Ticket',
        content: input.content,
      },
    ],
  };
}

function readIdFromTicketAddResponse(body: unknown): number | null {
  if (isJsonObject(body) && typeof body.id === 'number') {
    return body.id;
  }

  if (Array.isArray(body) && body.length > 0 && isJsonObject(body[0]) && typeof body[0].id === 'number') {
    return body[0].id;
  }

  return null;
}

function readTicketStatusFromResponse(body: unknown): number | null {
  if (isJsonObject(body) && typeof body.status === 'number') {
    return body.status;
  }

  if (isJsonObject(body) && typeof body.status === 'string' && /^\d+$/.test(body.status)) {
    return Number.parseInt(body.status, 10);
  }

  return null;
}

function readNumberField(payload: JsonObject, field: string): number | null {
  const raw = payload[field];

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }

  if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }

  return null;
}

function readSolutionFromResponse(body: unknown): GlpiTicketSolution | null {
  if (!isJsonObject(body)) {
    return null;
  }

  const id = readNumberField(body, 'id');
  if (id === null) {
    return null;
  }

  return {
    id,
    status: readNumberField(body, 'status'),
  };
}

export class GlpiClient {
  private sessionToken: string | null = null;
  private sessionInitInFlight: Promise<void> | null = null;

  public constructor(
    private readonly baseUrl: string,
    private readonly httpClient: ResilientHttpClient,
  ) {}

  public async findContactByPhone(phoneE164: string): Promise<GlpiContactLookupResult | null> {
    const normalizedPhone = phoneE164.replace(/^\+/, '');

    const [userResult, contactResult] = await Promise.all([
      this.searchItemType('User', normalizedPhone),
      this.searchItemType('Contact', normalizedPhone),
    ]);

    const user = userResult[0] ?? null;
    const contact = contactResult[0] ?? null;

    if (!user && !contact) {
      return null;
    }

    return {
      glpiContactId: readNumericId(contact),
      glpiUserId: readNumericId(user),
      name: readName(user) ?? readName(contact),
    };
  }

  public async createTicket(input: CreateGlpiTicketInput, options?: GlpiRequestRuntimeOptions): Promise<number> {
    const ticketBody = buildTicketCreatePayload(input);

    logger.info(
      {
        stage: 'glpi_ticket_create',
        glpiTicketCreateBody: ticketBody,
        glpiTicketCreateBodyJson: JSON.stringify(ticketBody),
      },
      '[GLPI PoC] POST /Ticket request body',
    );

    const payload = await this.requestJson<JsonObject>(
      '/Ticket',
      {
        method: 'POST',
        body: JSON.stringify(ticketBody),
      },
      'glpi_ticket_create',
      options,
    );

    logger.info(
      {
        stage: 'glpi_ticket_create',
        glpiTicketCreateResponse: payload,
      },
      '[GLPI PoC] POST /Ticket response body',
    );

    const ticketId = readIdFromTicketAddResponse(payload);
    if (ticketId === null) {
      throw new GlpiRequestError(
        'GLPI ticket creation did not return an ID.',
        undefined,
        payload,
        'glpi_ticket_create',
        sanitizeUrlForLog(joinApirestUrl(this.baseUrl, '/Ticket')),
      );
    }

    return ticketId;
  }

  /** GLPI status 5 = Solved, 6 = Closed → ambos tratados como 'closed'. */
  public async getTicketStatus(ticketId: number): Promise<'open' | 'closed' | 'unknown'> {
    try {
      const ticket = await this.getTicket(ticketId);
      const status = ticket.status;
      if (status === null) return 'unknown';
      return status === 5 || status === 6 ? 'closed' : 'open';
    } catch {
      return 'unknown';
    }
  }

  public async getTicket(ticketId: number): Promise<GlpiTicket> {
    const payload = await this.requestJson<JsonObject>(
      `/Ticket/${ticketId}`,
      { method: 'GET' },
      'glpi_ticket_read',
    );

    return {
      id: ticketId,
      status: readTicketStatusFromResponse(payload),
    };
  }

  public async updateTicketStatus(ticketId: number, status: number, extraInput: JsonObject = {}): Promise<void> {
    const updateBody = {
      input: {
        id: ticketId,
        status,
        ...extraInput,
      },
    };

    logger.info(
      {
        stage: 'glpi_ticket_update',
        ticketId,
        glpiTicketUpdateBody: updateBody,
        glpiTicketUpdateBodyJson: JSON.stringify(updateBody),
      },
      '[GLPI PoC] PUT /Ticket request body',
    );

    const payload = await this.requestJson<JsonObject>(
      `/Ticket/${ticketId}`,
      {
        method: 'PUT',
        body: JSON.stringify(updateBody),
      },
      'glpi_ticket_update',
    );

    const returnedId = readIdFromTicketAddResponse(payload);
    if (returnedId !== null && returnedId !== ticketId) {
      throw new GlpiRequestError(
        'GLPI ticket update returned an unexpected ID.',
        undefined,
        payload,
        'glpi_ticket_update',
        sanitizeUrlForLog(joinApirestUrl(this.baseUrl, `/Ticket/${ticketId}`)),
      );
    }
  }

  public async closeTicket(ticketId: number): Promise<void> {
    await this.updateTicketStatus(ticketId, 6, { _accepted: 1 });
  }

  public async getLatestTicketSolution(ticketId: number): Promise<GlpiTicketSolution | null> {
    const payload = await this.requestJson<unknown>(
      `/Ticket/${ticketId}/ITILSolution`,
      { method: 'GET' },
      'glpi_solution_read',
    );

    const latestSolution = normalizeEntityCollection(payload)
      .map(readSolutionFromResponse)
      .filter((solution): solution is GlpiTicketSolution => solution !== null)
      .sort((a, b) => b.id - a.id)[0] ?? null;

    logger.info(
      {
        stage: 'glpi_solution_read',
        ticketId,
        solutionId: latestSolution?.id ?? null,
        solutionStatus: latestSolution?.status ?? null,
      },
      '[GLPI PoC] Latest ticket solution loaded.',
    );

    return latestSolution;
  }

  public async approveTicketSolution(ticketId: number, auditContent: string): Promise<void> {
    const initialTicket = await this.getTicket(ticketId);
    if (initialTicket.status !== 5) {
      throw new GlpiRequestError(
        'GLPI ticket is not solved; solution approval cannot proceed.',
        undefined,
        { ticketId, ticketStatus: initialTicket.status },
        'glpi_solution_approve',
        sanitizeUrlForLog(joinApirestUrl(this.baseUrl, `/Ticket/${ticketId}`)),
      );
    }

    let latestSolution: GlpiTicketSolution | null = null;
    try {
      latestSolution = await this.getLatestTicketSolution(ticketId);
    } catch (error: unknown) {
      logger.warn(
        {
          stage: 'glpi_solution_read',
          ticketId,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        '[GLPI PoC] Latest ticket solution lookup failed; approval will rely on ticket status.',
      );
    }

    const path = `/Ticket/${ticketId}/ITILFollowup`;
    const approveBody = {
      input: [
        {
          items_id: ticketId,
          itemtype: 'Ticket',
          content: auditContent,
          add_close: 1,
        },
      ],
    };

    logger.info(
      {
        stage: 'glpi_solution_approve',
        ticketId,
        solutionId: latestSolution?.id ?? null,
        solutionStatus: latestSolution?.status ?? null,
        glpiSolutionApproveBody: approveBody,
      },
      '[GLPI PoC] POST /ITILFollowup solution approval request body',
    );

    await this.requestJson<JsonObject>(
      path,
      {
        method: 'POST',
        body: JSON.stringify(approveBody),
      },
      'glpi_solution_approve',
    );

    const ticket = await this.getTicket(ticketId);
    if (ticket.status !== 6) {
      throw new GlpiRequestError(
        'GLPI solution approval did not close the ticket.',
        undefined,
        { ticketId, solutionId: latestSolution?.id ?? null, finalTicketStatus: ticket.status },
        'glpi_solution_approve',
        sanitizeUrlForLog(joinApirestUrl(this.baseUrl, path)),
      );
    }
  }

  public async reopenTicket(ticketId: number): Promise<void> {
    await this.updateTicketStatus(ticketId, 2);
  }

  public async reopenTicketSolution(ticketId: number, auditContent: string): Promise<void> {
    const initialTicket = await this.getTicket(ticketId);
    if (initialTicket.status !== 5) {
      throw new GlpiRequestError(
        'GLPI ticket is not solved; solution reopen cannot proceed.',
        undefined,
        { ticketId, ticketStatus: initialTicket.status },
        'glpi_solution_reopen',
        sanitizeUrlForLog(joinApirestUrl(this.baseUrl, `/Ticket/${ticketId}`)),
      );
    }

    const path = `/Ticket/${ticketId}/ITILFollowup`;
    const reopenBody = {
      input: [
        {
          items_id: ticketId,
          itemtype: 'Ticket',
          content: auditContent,
          add_reopen: 1,
        },
      ],
    };

    logger.info(
      {
        stage: 'glpi_solution_reopen',
        ticketId,
        glpiSolutionReopenBody: reopenBody,
      },
      '[GLPI PoC] POST /ITILFollowup solution reopen request body',
    );

    await this.requestJson<JsonObject>(
      path,
      {
        method: 'POST',
        body: JSON.stringify(reopenBody),
      },
      'glpi_solution_reopen',
    );

    const ticket = await this.getTicket(ticketId);
    if (ticket.status !== 2) {
      throw new GlpiRequestError(
        'GLPI solution reopen did not return the ticket to processing.',
        undefined,
        { ticketId, finalTicketStatus: ticket.status },
        'glpi_solution_reopen',
        sanitizeUrlForLog(joinApirestUrl(this.baseUrl, path)),
      );
    }
  }

  public async addFollowUp(input: AddGlpiFollowUpInput): Promise<number> {
    const path = `/Ticket/${input.ticketId}/ITILFollowup`;
    const followUpBody = buildTicketFollowUpPayload(input);

    logger.info(
      {
        stage: 'glpi_followup_create',
        ticketId: input.ticketId,
        glpiFollowUpCreateBody: followUpBody,
      },
      '[GLPI PoC] POST /ITILFollowup request body',
    );

    const payload = await this.requestJson<JsonObject>(
      path,
      {
        method: 'POST',
        body: JSON.stringify(followUpBody),
      },
      'glpi_followup_create',
    );

    logger.info(
      {
        stage: 'glpi_followup_create',
        ticketId: input.ticketId,
        glpiFollowUpCreateResponse: payload,
      },
      '[GLPI PoC] POST /ITILFollowup response body',
    );

    const followUpId = readIdFromTicketAddResponse(payload);

    if (followUpId === null) {
      throw new GlpiRequestError(
        'GLPI follow-up creation did not return an ID.',
        undefined,
        payload,
        'glpi_followup_create',
        sanitizeUrlForLog(joinApirestUrl(this.baseUrl, path)),
      );
    }

    logger.info(
      {
        stage: 'glpi_followup_create',
        ticketId: input.ticketId,
        followUpId,
      },
      '[GLPI PoC] Follow-up created successfully.',
    );

    return followUpId;
  }

  /**
   * Upload de arquivo para GLPI via multipart/form-data.
   * Nota: não usa send() para não sobrescrever Content-Type necessário para boundary multipart.
   * Retry de sessão em 401 não está implementado neste método; sessão é garantida por ensureSession().
   */
  public async uploadDocument(input: UploadGlpiDocumentInput): Promise<number> {
    await this.ensureSession();

    if (!this.sessionToken) {
      throw new Error('GlpiClient: Session-Token missing after ensureSession.');
    }

    const url = joinApirestUrl(this.baseUrl, '/Document');
    const uploadManifest = JSON.stringify({
      input: {
        name: input.filename,
        _filename: [input.filename],
      },
    });

    const formData = new FormData();
    formData.append('uploadManifest', uploadManifest);
    formData.append('filename[0]', new Blob([new Uint8Array(input.fileBuffer)], { type: input.mimeType }), input.filename);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'App-Token': env.GLPI_APP_TOKEN,
      'Session-Token': this.sessionToken,
    };

    logGlpiHttpPreflight(url, 'POST', headers, { stage: 'glpi_document_upload' });

    const response = await this.httpClient.request(url, {
      method: 'POST',
      headers,
      body: formData as unknown as BodyInit,
      timeoutMs: env.GLPI_HTTP_TIMEOUT_MS,
      retries: env.GLPI_HTTP_RETRY_COUNT,
    });

    const responseBody = await safeJson(response);

    logger.info(
      {
        stage: 'glpi_document_upload',
        filename: input.filename,
        mimeType: input.mimeType,
        glpiDocumentUploadResponse: responseBody,
      },
      '[GLPI PoC] POST /Document response body',
    );

    if (!response.ok) {
      throw new GlpiRequestError(
        'GLPI document upload failed.',
        response.status,
        responseBody,
        'glpi_document_upload',
        sanitizeUrlForLog(url),
      );
    }

    const docId = readIdFromTicketAddResponse(responseBody);
    if (docId === null) {
      throw new GlpiRequestError(
        'GLPI document upload did not return an ID.',
        undefined,
        responseBody,
        'glpi_document_upload',
        sanitizeUrlForLog(url),
      );
    }

    logger.info(
      { stage: 'glpi_document_upload', documentId: docId, filename: input.filename },
      '[GLPI PoC] Document uploaded successfully.',
    );

    return docId;
  }

  /** Vincula documento ao ticket via Document_Item. */
  public async linkDocumentToTicket(documentId: number, ticketId: number): Promise<void> {
    const path = '/Document_Item';
    const body = {
      input: [{ documents_id: documentId, items_id: ticketId, itemtype: 'Ticket' }],
    };

    logger.info(
      { stage: 'glpi_document_upload', documentId, ticketId, body },
      '[GLPI PoC] POST /Document_Item request body',
    );

    const payload = await this.requestJson<JsonObject>(
      path,
      { method: 'POST', body: JSON.stringify(body) },
      'glpi_document_upload',
    );

    logger.info(
      { stage: 'glpi_document_upload', documentId, ticketId, glpiDocumentLinkResponse: payload },
      '[GLPI PoC] POST /Document_Item response body',
    );
  }

  /**
   * Pesquisa oficial GLPI: `GET apirest.php/search/:itemtype` com critérios (não usar `/User?searchText=` —
   * `searchText` exige chaves = id de campo).
   */
  private async searchItemType(itemType: 'User' | 'Contact', searchValue: string): Promise<JsonObject[]> {
    const query = new URLSearchParams();
    query.set('criteria[0][field]', '1');
    query.set('criteria[0][searchtype]', 'contains');
    query.set('criteria[0][value]', searchValue);
    query.append('forcedisplay[0]', '2');
    query.append('forcedisplay[1]', '1');
    query.set('range', '0-9');

    const path = `/search/${itemType}?${query.toString()}`;
    const response = await this.send(path, { method: 'GET' }, { logStage: 'glpi_contact_lookup' });

    const responseBody = await safeJson(response);
    const requestUrl = sanitizeUrlForLog(joinApirestUrl(this.baseUrl, path));

    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      throw new GlpiRequestError(
        `GLPI search request failed for /search/${itemType}.`,
        response.status,
        responseBody,
        'glpi_contact_lookup',
        requestUrl,
      );
    }

    const rawRows = normalizeEntityCollection(responseBody);

    return rawRows
      .map((row) => {
        const id = readIdFromGlpiSearchRow(row);
        const name = readNameFromGlpiSearchRow(row);

        return {
          id,
          name,
        };
      })
      .filter(
        (row): row is JsonObject & { id: number; name: string | null } => typeof row.id === 'number',
      );
  }

  private async requestJson<T>(
    path: string,
    init: Omit<RequestInit, 'headers'> & { headers?: HeadersInit },
    stage: GlpiFailureStage,
    runtimeOptions?: GlpiRequestRuntimeOptions,
  ): Promise<T> {
    const response = await this.send(path, init, { logStage: stage, timeoutMs: runtimeOptions?.timeoutMs });
    const responseBody = await safeJson(response);
    const requestUrl = sanitizeUrlForLog(joinApirestUrl(this.baseUrl, path));

    if (!response.ok) {
      logger.error(
        {
          stage,
          path,
          httpStatus: response.status,
          url: requestUrl,
          glpiRequestPayload: parseRequestBodyForLog(init.body ?? undefined),
          glpiResponseBody: sanitizeGlpiValueForLog(responseBody),
        },
        '[GLPI PoC] GLPI request failed.',
      );

      throw new GlpiRequestError(
        `GLPI request failed for ${path}.`,
        response.status,
        responseBody,
        stage,
        requestUrl,
      );
    }

    return responseBody as T;
  }

  /** Fluxo GLPI clássico: `initSession` com `user_token`; demais pedidos com `Session-Token` apenas. */
  private async ensureSession(): Promise<void> {
    if (this.sessionToken) {
      return;
    }

    if (!this.sessionInitInFlight) {
      this.sessionInitInFlight = this.performInitSession().finally(() => {
        this.sessionInitInFlight = null;
      });
    }

    await this.sessionInitInFlight;
  }

  private async performInitSession(): Promise<void> {
    if (this.sessionToken) {
      return;
    }

    const path = '/initSession/';
    const url = joinApirestUrl(this.baseUrl, path);
    const headers: HeadersInit = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'App-Token': env.GLPI_APP_TOKEN,
      Authorization: `user_token ${env.GLPI_USER_TOKEN}`,
    };

    logGlpiHttpPreflight(url, 'GET', headers, { stage: 'glpi_init_session' });

    const response = await this.httpClient.request(url, {
      method: 'GET',
      timeoutMs: env.GLPI_HTTP_TIMEOUT_MS,
      retries: env.GLPI_HTTP_RETRY_COUNT,
      headers,
    });

    const responseBody = await safeJson(response);

    logger.info(
      {
        stage: 'glpi_init_session',
        httpStatus: response.status,
        url: sanitizeUrlForLog(url),
        responseBody: sanitizeSessionResponseForLog(responseBody),
      },
      '[GLPI PoC] initSession response',
    );

    if (!response.ok) {
      throw new GlpiRequestError(
        'GLPI initSession failed.',
        response.status,
        responseBody,
        'glpi_init_session',
        sanitizeUrlForLog(url),
      );
    }

    const token = readSessionToken(responseBody);
    if (!token) {
      throw new GlpiRequestError(
        'GLPI initSession response missing session_token.',
        response.status,
        responseBody,
        'glpi_init_session',
        sanitizeUrlForLog(url),
      );
    }

    this.sessionToken = token;
  }

  private async executeSend(
    path: string,
    init: Omit<RequestInit, 'headers'> & { headers?: HeadersInit },
    /** `sessionRetry` é só metadado de `send()`; ignorado aqui. */
    options?: { logStage?: string; sessionRetry?: boolean; timeoutMs?: number },
  ): Promise<Response> {
    if (!this.sessionToken) {
      throw new Error('GlpiClient: Session-Token missing after ensureSession.');
    }

    const url = joinApirestUrl(this.baseUrl, path);
    const method = init.method ?? 'GET';
    const headers: HeadersInit = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'App-Token': env.GLPI_APP_TOKEN,
      'Session-Token': this.sessionToken,
      ...init.headers,
    };

    logGlpiHttpPreflight(url, method, headers, { stage: options?.logStage });

    return this.httpClient.request(url, {
      ...init,
      timeoutMs: options?.timeoutMs ?? env.GLPI_HTTP_TIMEOUT_MS,
      retries: env.GLPI_HTTP_RETRY_COUNT,
      headers,
    });
  }

  private async send(
    path: string,
    init: Omit<RequestInit, 'headers'> & { headers?: HeadersInit },
    options?: { logStage?: string; sessionRetry?: boolean; timeoutMs?: number },
  ): Promise<Response> {
    await this.ensureSession();

    let response = await this.executeSend(path, init, options);

    if (response.status === 401 && !options?.sessionRetry) {
      this.sessionToken = null;
      await this.ensureSession();
      response = await this.executeSend(path, init, { ...options, sessionRetry: true });
    }

    return response;
  }
}

function readNumericId(payload: JsonObject | null): number | null {
  const id = payload?.id;

  if (typeof id === 'number' && Number.isFinite(id)) {
    return id;
  }

  if (typeof id === 'string' && /^\d+$/.test(id)) {
    return Number.parseInt(id, 10);
  }

  return null;
}

function readName(payload: JsonObject | null): string | null {
  const name = payload?.name;

  return typeof name === 'string' && name.length > 0 ? name : null;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeEntityCollection(payload: unknown): JsonObject[] {
  if (Array.isArray(payload)) {
    return payload.filter(isJsonObject);
  }

  if (isJsonObject(payload)) {
    if (Array.isArray(payload.data)) {
      return payload.data.filter(isJsonObject);
    }

    if (Array.isArray(payload.items)) {
      return payload.items.filter(isJsonObject);
    }
  }

  return [];
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null;
}
