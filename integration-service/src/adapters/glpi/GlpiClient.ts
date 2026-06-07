import type {
  AddGlpiFollowUpInput,
  CreateRestrictedGlpiUserInput,
  CreateGlpiTicketInput,
  FindGlpiTicketForEntitySelectionInput,
  GlpiComputerAssetCandidate,
  GlpiContactLookupResult,
  GlpiItilCategory,
  GlpiTicket,
  GlpiUserLookupResult,
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

function isAbortLikeError(error: unknown): boolean {
  const err = error as Partial<NodeJS.ErrnoException> & { name?: string; message?: string };
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';

  return err.name === 'AbortError'
    || err.code === 'ABORT_ERR'
    || err.code === '20'
    || (err.code as unknown) === 20
    || message.includes('aborted')
    || message.includes('abort');
}

function buildTransportErrorBody(error: unknown, timeoutMs: number): JsonObject {
  const err = error instanceof Error ? error : new Error(String(error));
  const errno = error as NodeJS.ErrnoException;
  const timeoutLike = isAbortLikeError(error);

  return {
    error_type: timeoutLike ? 'timeout' : 'network',
    error_name: err.name,
    error_message: err.message,
    error_code: errno.code ?? null,
    timeout_ms: timeoutMs,
  };
}

/** GLPI REST exige payload `{ input: [...] }` com campos do CommonITIL/Ticket (`name`, não `title`). */
function buildTicketCreatePayload(input: CreateGlpiTicketInput): JsonObject {
  const safeName = input.requesterName ?? '';
  const extraContact =
    safeName.length > 0
      ? `\n\n---\nTelefone (WhatsApp): ${input.requesterPhone}\nNome: ${safeName}`
      : `\n\n---\nTelefone (WhatsApp): ${input.requesterPhone}`;

  const content = `${input.content}${extraContact}`;

  if (!Number.isFinite(input.entitiesId) || input.entitiesId <= 0) {
    throw new Error('GLPI_TICKET_ENTITY_REQUIRED');
  }

  const entitiesId = Math.trunc(input.entitiesId);

  const ticketInput: JsonObject = {
    name: input.title,
    content,
    entities_id: entitiesId,
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

  if (input.requesterUserId != null && input.requesterUserId > 0) {
    ticketInput._users_id_requester = input.requesterUserId;
  }

  if (input.itilcategoriesId != null && input.itilcategoriesId > 0) {
    ticketInput.itilcategories_id = Math.trunc(input.itilcategoriesId);
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

function readTicketEntityIdFromResponse(body: unknown): number | null {
  if (isJsonObject(body) && typeof body.entities_id === 'number' && Number.isFinite(body.entities_id)) {
    return body.entities_id;
  }

  if (isJsonObject(body) && typeof body.entities_id === 'string' && /^\d+$/.test(body.entities_id)) {
    return Number.parseInt(body.entities_id, 10);
  }

  return null;
}

function readTicketDeletedFromResponse(body: unknown): boolean {
  if (!isJsonObject(body)) {
    return false;
  }

  const explicitFlag = body.is_deleted ?? body.isDeleted ?? body.deleted;
  if (explicitFlag !== undefined && explicitFlag !== null) {
    return readBooleanLike(explicitFlag, false);
  }

  const deletedAt = body.date_delete ?? body.deleted_at;
  return typeof deletedAt === 'string' && deletedAt.trim() !== '';
}

function readTicketEntityIdFromSearchRow(row: JsonObject): number | null {
  const raw = row[80] ?? row['80'] ?? row.entities_id ?? row.entity_id;

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }

  if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
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

function readStringField(payload: JsonObject, field: string): string | null {
  const raw = payload[field];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
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

  public async findUsersByEmail(email: string): Promise<GlpiUserLookupResult[]> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return [];
    }

    const rows = await this.searchItemType('User', normalizedEmail, '5');
    return rows.map((row) => ({
      id: readNumericId(row) ?? 0,
      name: readName(row),
      email: normalizedEmail,
      isActive: readBooleanLike(row.is_active ?? row['8'], true),
    })).filter((user) => user.id > 0);
  }

  public async createRestrictedRequesterUser(input: CreateRestrictedGlpiUserInput): Promise<number> {
    if (!Number.isFinite(input.entitiesId) || input.entitiesId <= 0) {
      throw new Error('GLPI_USER_ENTITY_REQUIRED');
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error('GLPI_USER_VALID_EMAIL_REQUIRED');
    }

    const userBody = {
      input: [
        {
          name: normalizedEmail,
          realname: input.requesterName ?? normalizedEmail,
          firstname: '',
          useremails: [{ email: normalizedEmail, is_default: 1 }],
          phone: input.phoneE164,
          comment: [
            'Origem: WhatsApp/IntegraGLPI',
            input.companyName ? `Empresa informada: ${input.companyName}` : null,
            'Usuário criado de forma restrita: sem senha, sem perfil administrativo e sem login liberado automaticamente.',
          ].filter(Boolean).join('\n'),
          entities_id: Math.trunc(input.entitiesId),
          is_active: 0,
        },
      ],
    };

    const payload = await this.requestJson<JsonObject>(
      '/User',
      { method: 'POST', body: JSON.stringify(userBody) },
      'glpi_user_create',
    );
    const userId = readIdFromTicketAddResponse(payload);
    if (userId === null) {
      throw new GlpiRequestError(
        'GLPI restricted user creation did not return an ID.',
        undefined,
        payload,
        'glpi_user_create',
        sanitizeUrlForLog(joinApirestUrl(this.baseUrl, '/User')),
      );
    }

    return userId;
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

  public async findTicketForEntitySelection(
    input: FindGlpiTicketForEntitySelectionInput,
  ): Promise<GlpiTicket | null> {
    const tickets = await this.findTicketsForEntitySelection(input);

    return tickets[0] ?? null;
  }

  public async findTicketsForEntitySelection(
    input: FindGlpiTicketForEntitySelectionInput,
  ): Promise<GlpiTicket[]> {
    if (!Number.isFinite(input.entitiesId) || input.entitiesId <= 0) {
      return [];
    }

    const marker = typeof input.correlationMarker === 'string' && input.correlationMarker.trim() !== ''
      ? input.correlationMarker.trim()
      : null;
    const searchValues = [
      marker,
      input.requesterPhone.trim(),
      input.requesterPhone.replace(/[^\d]/g, ''),
    ].filter((value): value is string => typeof value === 'string' && value !== '');

    const seenTicketIds = new Set<number>();
    const matches: GlpiTicket[] = [];
    for (const searchValue of searchValues) {
      const rows = await this.searchTicketsByDescription(searchValue);
      for (const row of rows) {
        const ticketId = readIdFromGlpiSearchRow(row);
        if (ticketId === null || seenTicketIds.has(ticketId)) {
          continue;
        }
        seenTicketIds.add(ticketId);

        const rowEntityId = readTicketEntityIdFromSearchRow(row);
        if (rowEntityId !== null && rowEntityId !== Math.trunc(input.entitiesId)) {
          continue;
        }

        let ticket: GlpiTicket;
        if (rowEntityId !== null) {
          ticket = {
            id: ticketId,
            status: readNumberField(row, '12'),
            entitiesId: rowEntityId,
          };
        } else {
          try {
            ticket = await this.getTicket(ticketId);
          } catch (error: unknown) {
            logger.warn(
              {
                stage: 'glpi_ticket_read',
                ticketId,
                errorMessage: error instanceof Error ? error.message : String(error),
              },
              '[GLPI PoC] Ticket lookup during entity-selection reconciliation failed.',
            );
            continue;
          }
        }

        if (ticket.entitiesId === Math.trunc(input.entitiesId)) {
          matches.push(ticket);
        }
      }
      if (marker !== null && searchValue === marker && matches.length > 0) {
        break;
      }
    }

    return matches;
  }

  /**
   * Busca categorias ITIL visíveis no service desk via REST.
   * Pagina automaticamente até `MAX_ITEMS` resultados. Timeout de 5 s por request.
   * Retorna lista vazia em caso de falha para não bloquear o webhook.
   * Nunca executa POST/PUT/PATCH/DELETE — somente GET.
   */
  public async fetchItilCategories(entityId?: number | null): Promise<GlpiItilCategory[]> {
    const MAX_ITEMS = 500;
    const PAGE_SIZE = 50;
    const FETCH_TIMEOUT_MS = 5_000;
    const all: GlpiItilCategory[] = [];
    let offset = 0;

    while (all.length < MAX_ITEMS) {
      const query = new URLSearchParams();
      query.set('range', `${offset}-${offset + PAGE_SIZE - 1}`);
      query.set('expand_dropdowns', 'true');
      if (typeof entityId === 'number' && Number.isFinite(entityId) && entityId > 0) {
        query.set('entities_id', String(Math.trunc(entityId)));
      }

      const path = `/ITILCategory?${query.toString()}`;
      let response: Response;
      try {
        response = await this.send(path, { method: 'GET' }, {
          logStage: 'glpi_itilcategory_list',
          timeoutMs: FETCH_TIMEOUT_MS,
        });
      } catch (error: unknown) {
        logger.warn(
          {
            stage: 'glpi_itilcategory_list',
            offset,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          '[GLPI PoC] ITILCategory fetch transport error; stopping pagination.',
        );
        break;
      }

      if (response.status === 206 || response.status === 200) {
        const body = await safeJson(response);
        const rows = normalizeEntityCollection(body);
        if (rows.length === 0) {
          break;
        }

        for (const row of rows) {
          const id = typeof row.id === 'number' && Number.isFinite(row.id)
            ? row.id
            : typeof row.id === 'string' && /^\d+$/.test(row.id)
              ? Number.parseInt(row.id, 10)
              : null;
          if (id === null || id <= 0) {
            continue;
          }

          const name = typeof row.name === 'string' ? row.name : '';
          const completename = typeof row.completename === 'string' ? row.completename : name;
          const visible = row.is_helpdeskvisible !== undefined && row.is_helpdeskvisible !== null
            ? readBooleanLike(row.is_helpdeskvisible, true)
            : true;

          all.push({ id, name, completename, is_helpdeskvisible: visible });
        }

        if (rows.length < PAGE_SIZE) {
          break; // última página
        }

        offset += PAGE_SIZE;
      } else {
        logger.warn(
          {
            stage: 'glpi_itilcategory_list',
            httpStatus: response.status,
            offset,
          },
          '[GLPI PoC] ITILCategory fetch returned non-success status; stopping pagination.',
        );
        break;
      }
    }

    logger.info(
      { stage: 'glpi_itilcategory_list', total: all.length, entityId: entityId ?? null },
      '[GLPI PoC] ITILCategory fetch completed.',
    );

    return all;
  }

  /**
   * Pesquisa computador pelo patrimonio/etiqueta informado pelo cliente.
   * Campo GLPI: Computer.otherserial. Somente GET, sem mutar inventario.
   */
  public async findComputersByOtherserial(otherserial: string, limit = 10): Promise<GlpiComputerAssetCandidate[]> {
    const normalized = otherserial.trim();
    if (normalized === '') {
      return [];
    }

    const rows = await this.searchComputersByOtherserial(normalized, limit);

    const assets: GlpiComputerAssetCandidate[] = [];
    for (const row of rows) {
      const id = readIdFromGlpiSearchRow(row);
      if (id === null) {
        continue;
      }

      const candidate = {
        id,
        name: readNameFromGlpiSearchRow(row),
        serial: readStringField(row, '5') ?? readStringField(row, 'serial'),
        otherserial: readStringField(row, '6') ?? readStringField(row, 'otherserial'),
        entitiesId: readNumberField(row, '80') ?? readNumberField(row, 'entities_id'),
      } satisfies GlpiComputerAssetCandidate;

      assets.push(candidate.entitiesId === null
        ? await this.fetchComputerAssetCandidate(id, candidate)
        : candidate);
    }

    return assets;
  }

  public async checkApiHealth(): Promise<{ ok: boolean; latencyMs: number | null; errorStage: string | null }> {
    const startedAt = Date.now();
    try {
      await this.ensureSession();

      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        errorStage: null,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        errorStage: error instanceof GlpiRequestError ? error.stage ?? null : null,
      };
    }
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

  public async getTicket(ticketId: number): Promise<GlpiTicket & { isDeleted: boolean }> {
    const payload = await this.requestJson<JsonObject>(
      `/Ticket/${ticketId}`,
      { method: 'GET' },
      'glpi_ticket_read',
    );

    return {
      id: ticketId,
      status: readTicketStatusFromResponse(payload),
      entitiesId: readTicketEntityIdFromResponse(payload),
      isDeleted: readTicketDeletedFromResponse(payload),
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
        status,
        hasExtraInput: Object.keys(extraInput).length > 0,
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

  public async solveTicketByInactivity(ticketId: number, solutionContent: string): Promise<void> {
    const initialTicket = await this.getTicket(ticketId);
    if (initialTicket.status === 6) {
      return;
    }
    if (initialTicket.status === 5) {
      await this.closeTicket(ticketId);
      const closedTicket = await this.getTicket(ticketId);
      if (closedTicket.status === 6) {
        return;
      }
      throw new GlpiRequestError(
        'GLPI inactivity autoclose did not close the already solved ticket.',
        undefined,
        { ticketId, finalTicketStatus: closedTicket.status },
        'glpi_solution_approve',
        sanitizeUrlForLog(joinApirestUrl(this.baseUrl, `/Ticket/${ticketId}`)),
      );
    }

    const path = `/Ticket/${ticketId}/ITILSolution`;
    const solutionBody = {
      input: [
        {
          items_id: ticketId,
          itemtype: 'Ticket',
          content: solutionContent,
        },
      ],
    };

    logger.info(
      {
        stage: 'glpi_inactivity_solution_create',
        ticketId,
        glpiInactivitySolutionBody: solutionBody,
      },
      '[GLPI PoC] POST /ITILSolution inactivity solution request body',
    );

    await this.requestJson<JsonObject>(
      path,
      {
        method: 'POST',
        body: JSON.stringify(solutionBody),
      },
      'glpi_solution_approve',
    );

    let ticket = await this.getTicket(ticketId);
    if (ticket.status !== 5 && ticket.status !== 6) {
      await this.updateTicketStatus(ticketId, 5, { content: solutionContent });
      ticket = await this.getTicket(ticketId);
    }

    if (ticket.status !== 6) {
      await this.closeTicket(ticketId);
      ticket = await this.getTicket(ticketId);
    }

    if (ticket.status !== 6) {
      throw new GlpiRequestError(
        'GLPI inactivity autoclose did not close the ticket.',
        undefined,
        { ticketId, finalTicketStatus: ticket.status },
        'glpi_solution_approve',
        sanitizeUrlForLog(joinApirestUrl(this.baseUrl, path)),
      );
    }
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
    const uploadInput: JsonObject = {
      name: input.filename,
      _filename: [input.filename],
    };

    if (Number.isFinite(input.entitiesId) && Number(input.entitiesId) > 0) {
      uploadInput.entities_id = Math.trunc(Number(input.entitiesId));
      uploadInput.is_recursive = 0;
    }

    const uploadManifest = JSON.stringify({ input: uploadInput });

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
      { stage: 'glpi_document_item_link', documentId, ticketId, body },
      '[GLPI PoC] POST /Document_Item request body',
    );

    let payload: JsonObject;
    try {
      payload = await this.requestJson<JsonObject>(
        path,
        { method: 'POST', body: JSON.stringify(body) },
        'glpi_document_item_link',
      );
      if (!this.hasCreatedId(payload)) {
        throw new GlpiRequestError(
          'GLPI document link did not return a valid ID.',
          undefined,
          payload,
          'glpi_document_item_link',
          sanitizeUrlForLog(joinApirestUrl(this.baseUrl, path)),
        );
      }
    } catch (error: unknown) {
      if (
        !(error instanceof GlpiRequestError)
        || (
          error.statusCode !== undefined
          && error.statusCode !== 400
          && error.statusCode !== 403
        )
      ) {
        throw error;
      }

      logger.warn(
        {
          stage: 'glpi_document_item_link',
          documentId,
          ticketId,
          httpStatus: error.statusCode,
          fallbackPath: `/Ticket/${ticketId}/Document_Item`,
        },
        '[GLPI PoC] POST /Document_Item failed; retrying through ticket sub-item endpoint.',
      );

      await this.linkDocumentToTicketSubItem(documentId, ticketId, 'fallback');
      return;
    }

    logger.info(
      { stage: 'glpi_document_item_link', documentId, ticketId, glpiDocumentLinkResponse: payload },
      '[GLPI PoC] POST /Document_Item response body',
    );
  }

  private async linkDocumentToTicketSubItem(
    documentId: number,
    ticketId: number,
    mode: 'primary' | 'fallback',
  ): Promise<void> {
    const nestedPath = `/Ticket/${ticketId}/Document_Item`;
    const completeBody = {
      input: [{ documents_id: documentId, items_id: ticketId, itemtype: 'Ticket' }],
    };
    const minimalBody = {
      input: [{ documents_id: documentId }],
    };

    let payload: JsonObject;
    try {
      payload = await this.requestJson<JsonObject>(
        nestedPath,
        { method: 'POST', body: JSON.stringify(completeBody) },
        'glpi_document_item_link',
      );
      if (!this.hasCreatedId(payload)) {
        throw new GlpiRequestError(
          'GLPI nested document link did not return a valid ID.',
          undefined,
          payload,
          'glpi_document_item_link',
          sanitizeUrlForLog(joinApirestUrl(this.baseUrl, nestedPath)),
        );
      }
    } catch (error: unknown) {
      if (
        !(error instanceof GlpiRequestError)
        || (
          error.statusCode !== undefined
          && error.statusCode !== 400
          && error.statusCode !== 403
        )
      ) {
        throw error;
      }

      logger.warn(
        {
          stage: 'glpi_document_item_link',
          mode,
          documentId,
          ticketId,
          httpStatus: error.statusCode,
          fallbackPayload: 'minimal',
        },
        '[GLPI PoC] POST /Ticket/{id}/Document_Item complete payload failed; retrying minimal payload.',
      );

      payload = await this.requestJson<JsonObject>(
        nestedPath,
        { method: 'POST', body: JSON.stringify(minimalBody) },
        'glpi_document_item_link',
      );

      if (!this.hasCreatedId(payload)) {
        throw new GlpiRequestError(
          'GLPI nested document link did not return a valid ID.',
          undefined,
          payload,
          'glpi_document_item_link',
          sanitizeUrlForLog(joinApirestUrl(this.baseUrl, nestedPath)),
        );
      }
    }

    logger.info(
      { stage: 'glpi_document_item_link', mode, documentId, ticketId, glpiDocumentLinkResponse: payload },
      '[GLPI PoC] POST /Ticket/{id}/Document_Item response body',
    );
  }

  private hasCreatedId(payload: unknown): boolean {
    return readIdFromTicketAddResponse(payload) !== null;
  }

  /**
   * Pesquisa oficial GLPI: `GET apirest.php/search/:itemtype` com critérios (não usar `/User?searchText=` —
   * `searchText` exige chaves = id de campo).
   */
  private async searchItemType(itemType: 'User' | 'Contact', searchValue: string, field = '1'): Promise<JsonObject[]> {
    const query = new URLSearchParams();
    query.set('criteria[0][field]', field);
    query.set('criteria[0][searchtype]', 'contains');
    query.set('criteria[0][value]', searchValue);
    query.append('forcedisplay[0]', '2');
    query.append('forcedisplay[1]', '1');
    query.append('forcedisplay[2]', '5');
    query.append('forcedisplay[3]', '8');
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
          is_active: row.is_active ?? row['8'] ?? null,
          email: row.email ?? row['5'] ?? null,
        };
      })
      .filter((row) => typeof row.id === 'number') as JsonObject[];
  }

  private async searchTicketsByDescription(searchValue: string): Promise<JsonObject[]> {
    const query = new URLSearchParams();
    query.set('criteria[0][field]', '21');
    query.set('criteria[0][searchtype]', 'contains');
    query.set('criteria[0][value]', searchValue);
    query.append('forcedisplay[0]', '2');
    query.append('forcedisplay[1]', '1');
    query.append('forcedisplay[2]', '12');
    query.append('forcedisplay[3]', '15');
    query.append('forcedisplay[4]', '80');
    query.set('sort', '2');
    query.set('order', 'DESC');
    query.set('range', '0-9');

    const path = `/search/Ticket?${query.toString()}`;
    const response = await this.send(path, { method: 'GET' }, { logStage: 'glpi_ticket_read' });
    const responseBody = await safeJson(response);
    const requestUrl = sanitizeUrlForLog(joinApirestUrl(this.baseUrl, path));

    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      throw new GlpiRequestError(
        'GLPI ticket search request failed.',
        response.status,
        responseBody,
        'glpi_ticket_read',
        requestUrl,
      );
    }

    return normalizeEntityCollection(responseBody);
  }

  private async searchComputersByOtherserial(searchValue: string, limit: number): Promise<JsonObject[]> {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 50));
    const query = new URLSearchParams();
    query.set('criteria[0][field]', '6');
    query.set('criteria[0][searchtype]', 'equals');
    query.set('criteria[0][value]', searchValue);
    query.append('forcedisplay[0]', '2');
    query.append('forcedisplay[1]', '1');
    query.append('forcedisplay[2]', '5');
    query.append('forcedisplay[3]', '6');
    query.append('forcedisplay[4]', '80');
    query.set('range', `0-${safeLimit - 1}`);

    const path = `/search/Computer?${query.toString()}`;
    const response = await this.send(path, { method: 'GET' }, { logStage: 'glpi_computer_lookup' });
    const responseBody = await safeJson(response);
    const requestUrl = sanitizeUrlForLog(joinApirestUrl(this.baseUrl, path));

    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      throw new GlpiRequestError(
        'GLPI computer search request failed.',
        response.status,
        responseBody,
        'glpi_contact_lookup',
        requestUrl,
      );
    }

    return normalizeEntityCollection(responseBody);
  }

  private async fetchComputerAssetCandidate(
    computerId: number,
    fallback: GlpiComputerAssetCandidate,
  ): Promise<GlpiComputerAssetCandidate> {
    try {
      const payload = await this.requestJson<JsonObject>(
        `/Computer/${computerId}`,
        { method: 'GET' },
        'glpi_contact_lookup',
      );

      return {
        id: computerId,
        name: readStringField(payload, 'name') ?? fallback.name,
        serial: readStringField(payload, 'serial') ?? fallback.serial,
        otherserial: readStringField(payload, 'otherserial') ?? fallback.otherserial,
        entitiesId: readNumberField(payload, 'entities_id') ?? fallback.entitiesId,
      };
    } catch (error: unknown) {
      logger.warn(
        {
          stage: 'glpi_computer_lookup',
          computerId,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        '[GLPI PoC] Computer detail lookup failed; using search row candidate.',
      );

      return fallback;
    }
  }

  private async requestJson<T>(
    path: string,
    init: Omit<RequestInit, 'headers'> & { headers?: HeadersInit },
    stage: GlpiFailureStage,
    runtimeOptions?: GlpiRequestRuntimeOptions,
  ): Promise<T> {
    let response: Response;
    const timeoutMs = runtimeOptions?.timeoutMs ?? env.GLPI_HTTP_TIMEOUT_MS;
    try {
      response = await this.send(path, init, { logStage: stage, timeoutMs });
    } catch (error: unknown) {
      if (error instanceof GlpiRequestError) {
        throw error;
      }

      const responseBody = buildTransportErrorBody(error, timeoutMs);
      const requestUrl = sanitizeUrlForLog(joinApirestUrl(this.baseUrl, path));

      logger.error(
        {
          stage,
          path,
          url: requestUrl,
          timeout_ms: timeoutMs,
          error_type: responseBody.error_type,
          error_name: responseBody.error_name,
          error_message: responseBody.error_message,
          error_code: responseBody.error_code,
        },
        '[GLPI PoC] GLPI transport failed.',
      );

      throw new GlpiRequestError(
        responseBody.error_type === 'timeout'
          ? 'GLPI request timed out.'
          : 'GLPI transport failed.',
        undefined,
        responseBody,
        stage,
        requestUrl,
      );
    }
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

    let response: Response;
    try {
      response = await this.httpClient.request(url, {
        method: 'GET',
        timeoutMs: env.GLPI_HTTP_TIMEOUT_MS,
        retries: env.GLPI_HTTP_RETRY_COUNT,
        headers,
      });
    } catch (error: unknown) {
      const responseBody = buildTransportErrorBody(error, env.GLPI_HTTP_TIMEOUT_MS);
      const sanitizedUrl = sanitizeUrlForLog(url);

      logger.error(
        {
          stage: 'glpi_init_session',
          url: sanitizedUrl,
          timeout_ms: env.GLPI_HTTP_TIMEOUT_MS,
          error_type: responseBody.error_type,
          error_name: responseBody.error_name,
          error_message: responseBody.error_message,
          error_code: responseBody.error_code,
        },
        '[GLPI PoC] initSession transport failed.',
      );

      throw new GlpiRequestError(
        responseBody.error_type === 'timeout'
          ? 'GLPI initSession timed out.'
          : 'GLPI initSession transport failed.',
        undefined,
        responseBody,
        'glpi_init_session',
        sanitizedUrl,
      );
    }

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

function readBooleanLike(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'sim', 'active', 'ativo'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'nao', 'não', 'inactive', 'inativo'].includes(normalized)) {
      return false;
    }
  }

  return defaultValue;
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
