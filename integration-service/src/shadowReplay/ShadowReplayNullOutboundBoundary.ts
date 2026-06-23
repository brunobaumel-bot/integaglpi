/**
 * V10 Shadow Replay Lab — G2 Null Outbound Boundary.
 *
 * Every composition-root adapter method is created by `shadowReplayNullMethod`.
 * Compatibility with real contracts is proven type-only in tests via the
 * `createNullOutboundBoundary()` return type (import type of real classes).
 *
 * PHASE: integaglpi_v10_shadow_replay_lab_g2_outbound_null_isolation_fix_004
 */

import { createHash } from 'node:crypto';

import { SHADOW_REPLAY_BLOCKED_RESULT } from './ShadowReplayIsolationPolicy.js';

function descriptorHash(channel: string, operation: string): string {
  return createHash('sha256').update(`shadow_replay_null:${channel}:${operation}`).digest('hex');
}

export class ShadowReplayBlockedError extends Error {
  public readonly code = SHADOW_REPLAY_BLOCKED_RESULT;
  public readonly real = false as const;
  public readonly executed = false as const;
  public readonly descriptor_hash: string;
  public constructor(
    public readonly channel: string,
    public readonly operation: string,
  ) {
    super(`${SHADOW_REPLAY_BLOCKED_RESULT}:${channel}:${operation}`);
    this.name = 'ShadowReplayBlockedError';
    this.descriptor_hash = descriptorHash(channel, operation);
  }
}

/** Generic factory — rejects before any I/O; args never inspected or logged. */
export function shadowReplayNullMethod<F extends (...args: never[]) => unknown>(
  channel: string,
  operation: string,
): (...args: Parameters<F>) => ReturnType<F> {
  return (...args: Parameters<F>): ReturnType<F> => {
    void args;
    throw new ShadowReplayBlockedError(channel, operation);
  };
}

// Structural mirrors (no operational import) — exact match proven in tests.

type ShadowOutboundMessageRequestBody = {
  ticket_id: number;
  conversation_id: string;
  text: string;
  message_type:
    | 'text'
    | 'document'
    | 'image'
    | 'audio'
    | 'video'
    | 'interactive_buttons'
    | 'interactive_list'
    | 'template';
  glpi_user_id: number;
  idempotency_key?: string;
  template_name?: string;
  language?: string;
  template_parameters?: string[];
  buttons?: Array<{ id: string; title: string }>;
  list_options?: Array<{ id: string; title: string; description?: string }>;
  media?: {
    filename: string;
    mime_type: string;
    content_base64: string;
    document_id?: number;
  };
};

type ShadowOutboundSendOptions = { correlationId?: string };

type ShadowOutboundSendResult = {
  httpStatus: number;
  body: {
    status: string;
    message_id?: string;
    conversation_id?: string;
    postgres_message_row_id?: string;
    idempotent?: boolean;
    reason?: string;
    detail?: string;
  };
};

type ShadowCreateGlpiTicketInput = {
  title: string;
  content: string;
  requesterPhone: string;
  requesterName: string | null;
  entitiesId?: number;
  assignedUserId?: number | null;
  assignedGroupId?: number | null;
  requesterUserId?: number | null;
  itilcategoriesId?: number | null;
  glpiFormId?: number | null;
};

type ShadowCreateRestrictedGlpiUserInput = {
  email: string;
  requesterName: string | null;
  companyName: string | null;
  phoneE164: string;
  entitiesId: number;
};

type ShadowDynamicResearchInput = {
  context: string;
  ticketId: number | null;
  profileId: number | null;
  category: string | null;
  provider?: string | null;
  humanConsent: boolean;
  policy?: 'detected' | 'residual';
};

type ShadowDynamicResearchResult = {
  ok: boolean;
  status:
    | 'completed'
    | 'blocked_pii'
    | 'no_consent'
    | 'provider_unavailable'
    | 'no_actionable_result'
    | 'failed';
  message: string;
  answer: {
    diagnosis: string;
    steps: string[];
    sources?: Array<{ title: string; url: string }>;
  } | null;
  piiDetectedKinds: string[];
  actionable: boolean;
  sourceType?: 'external_ai_no_sources' | 'external_ai_with_sources';
  confidenceLabel?: 'baixa' | 'media' | 'alta';
  reviewRequired?: boolean;
};

type ShadowAlarmEngineResult = {
  processed: number;
  fired: number;
  cooldownSkipped: number;
  dedupeSkipped: number;
  consecutiveWaiting: number;
  ticketsCreated: number;
  errors: number;
  engineDisabled: boolean;
};

export class ShadowReplayNullMetaAdapter {
  public readonly sendTextMessage = shadowReplayNullMethod<
    (input: { body: string; to: string }) => Promise<unknown>
  >('whatsapp_meta', 'sendTextMessage');

  public readonly sendTemplateMessage = shadowReplayNullMethod<
    (input: {
      to: string;
      templateName: string;
      language: string;
      parameters?: string[];
    }) => Promise<unknown>
  >('whatsapp_meta', 'sendTemplateMessage');

  public readonly sendDocumentMessage = shadowReplayNullMethod<
    (input: { to: string; mediaId: string; filename: string; caption?: string }) => Promise<unknown>
  >('whatsapp_meta', 'sendDocumentMessage');

  public readonly sendImageMessage = shadowReplayNullMethod<
    (input: { to: string; mediaId: string; caption?: string }) => Promise<unknown>
  >('whatsapp_meta', 'sendImageMessage');

  public readonly sendAudioMessage = shadowReplayNullMethod<
    (input: { to: string; mediaId: string }) => Promise<unknown>
  >('whatsapp_meta', 'sendAudioMessage');

  public readonly sendVideoMessage = shadowReplayNullMethod<
    (input: { to: string; mediaId: string; caption?: string }) => Promise<unknown>
  >('whatsapp_meta', 'sendVideoMessage');

  public readonly sendReplyButtons = shadowReplayNullMethod<
    (
      to: string,
      bodyText: string,
      buttons: Array<{ id: string; title: string }>,
      footerText?: string,
    ) => Promise<unknown>
  >('whatsapp_meta', 'sendReplyButtons');

  public readonly sendListMessage = shadowReplayNullMethod<
    (
      to: string,
      bodyText: string,
      options: Array<{ id: string; title: string; description?: string }>,
      buttonText?: string,
      sectionTitle?: string,
    ) => Promise<unknown>
  >('whatsapp_meta', 'sendListMessage');
}

export class ShadowReplayNullOutboundMessageAdapter {
  public readonly send = shadowReplayNullMethod<
    (
      body: ShadowOutboundMessageRequestBody,
      options?: ShadowOutboundSendOptions,
    ) => Promise<ShadowOutboundSendResult>
  >('outbound', 'send');
}

export class ShadowReplayNullGlpiAdapter {
  public readonly createTicket = shadowReplayNullMethod<
    (input: ShadowCreateGlpiTicketInput, options?: { timeoutMs?: number }) => Promise<number>
  >('glpi', 'createTicket');

  public readonly createRestrictedRequesterUser = shadowReplayNullMethod<
    (input: ShadowCreateRestrictedGlpiUserInput) => Promise<number>
  >('glpi', 'createRestrictedRequesterUser');
}

export class ShadowReplayNullExternalResearchAdapter {
  public readonly researchDynamic = shadowReplayNullMethod<
    (input: ShadowDynamicResearchInput) => Promise<ShadowDynamicResearchResult>
  >('cloud_research', 'researchDynamic');
}

export class ShadowReplayNullLogmeinAdapter {
  public readonly runOnce = shadowReplayNullMethod<
    () => Promise<ShadowAlarmEngineResult>
  >('logmein', 'runOnce');
}

/** DEFENSIVE_NULL_SURFACE_NO_REAL_PORT — no dedicated operational class. */
export class ShadowReplayNullEmailAdapter {
  public readonly send = shadowReplayNullMethod<
    (payload: { to: string; subject: string; body: string }) => Promise<never>
  >('email', 'send');
}

/** DEFENSIVE_NULL_SURFACE_NO_REAL_PORT — no dedicated operational class. */
export class ShadowReplayNullExternalActionAdapter {
  public readonly execute = shadowReplayNullMethod<
    (action: { kind: string; payload?: Record<string, unknown> }) => Promise<never>
  >('external_action', 'execute');
}

export interface NullOutboundBoundary {
  meta: ShadowReplayNullMetaAdapter;
  outbound: ShadowReplayNullOutboundMessageAdapter;
  glpi: ShadowReplayNullGlpiAdapter;
  externalResearch: ShadowReplayNullExternalResearchAdapter;
  logmein: ShadowReplayNullLogmeinAdapter;
  email: ShadowReplayNullEmailAdapter;
  externalAction: ShadowReplayNullExternalActionAdapter;
  readonly real_adapter_present: false;
  readonly send_allowed: false;
  readonly external_action_allowed: false;
  readonly glpi_mutation_allowed: false;
  readonly cloud_allowed: false;
}

export function createNullOutboundBoundary(): NullOutboundBoundary {
  return {
    meta: new ShadowReplayNullMetaAdapter(),
    outbound: new ShadowReplayNullOutboundMessageAdapter(),
    glpi: new ShadowReplayNullGlpiAdapter(),
    externalResearch: new ShadowReplayNullExternalResearchAdapter(),
    logmein: new ShadowReplayNullLogmeinAdapter(),
    email: new ShadowReplayNullEmailAdapter(),
    externalAction: new ShadowReplayNullExternalActionAdapter(),
    real_adapter_present: false,
    send_allowed: false,
    external_action_allowed: false,
    glpi_mutation_allowed: false,
    cloud_allowed: false,
  };
}

export const SHADOW_REPLAY_BLOCKED_OPERATIONS: ReadonlyArray<{
  adapter: keyof NullOutboundBoundary;
  method: string;
  invoke: (b: NullOutboundBoundary) => Promise<unknown>;
}> = [
  {
    adapter: 'meta',
    method: 'sendTextMessage',
    invoke: (b) => b.meta.sendTextMessage({ to: '000', body: 'x' }),
  },
  {
    adapter: 'meta',
    method: 'sendTemplateMessage',
    invoke: (b) => b.meta.sendTemplateMessage({ to: '000', templateName: 't', language: 'pt_BR' }),
  },
  {
    adapter: 'meta',
    method: 'sendDocumentMessage',
    invoke: (b) => b.meta.sendDocumentMessage({ to: '000', mediaId: 'm', filename: 'f' }),
  },
  {
    adapter: 'meta',
    method: 'sendImageMessage',
    invoke: (b) => b.meta.sendImageMessage({ to: '000', mediaId: 'm' }),
  },
  {
    adapter: 'meta',
    method: 'sendAudioMessage',
    invoke: (b) => b.meta.sendAudioMessage({ to: '000', mediaId: 'm' }),
  },
  {
    adapter: 'meta',
    method: 'sendVideoMessage',
    invoke: (b) => b.meta.sendVideoMessage({ to: '000', mediaId: 'm' }),
  },
  {
    adapter: 'meta',
    method: 'sendReplyButtons',
    invoke: (b) => b.meta.sendReplyButtons('000', 'body', [{ id: '1', title: 't' }]),
  },
  {
    adapter: 'meta',
    method: 'sendListMessage',
    invoke: (b) => b.meta.sendListMessage('000', 'body', [{ id: '1', title: 't' }]),
  },
  {
    adapter: 'outbound',
    method: 'send',
    invoke: (b) =>
      b.outbound.send({
        ticket_id: 1,
        conversation_id: 'c',
        text: 'x',
        message_type: 'text',
        glpi_user_id: 1,
      }),
  },
  {
    adapter: 'glpi',
    method: 'createTicket',
    invoke: (b) =>
      b.glpi.createTicket({
        title: 't',
        content: 'c',
        requesterPhone: '000',
        requesterName: null,
      }),
  },
  {
    adapter: 'glpi',
    method: 'createRestrictedRequesterUser',
    invoke: (b) =>
      b.glpi.createRestrictedRequesterUser({
        email: 'a@b.c',
        requesterName: null,
        companyName: null,
        phoneE164: '000',
        entitiesId: 1,
      }),
  },
  {
    adapter: 'externalResearch',
    method: 'researchDynamic',
    invoke: (b) =>
      b.externalResearch.researchDynamic({
        context: 'x',
        ticketId: null,
        profileId: null,
        category: null,
        humanConsent: true,
      }),
  },
  { adapter: 'logmein', method: 'runOnce', invoke: (b) => b.logmein.runOnce() },
  {
    adapter: 'email',
    method: 'send',
    invoke: (b) => b.email.send({ to: 'a@b.c', subject: 's', body: 'b' }),
  },
  {
    adapter: 'externalAction',
    method: 'execute',
    invoke: (b) => b.externalAction.execute({ kind: 'generic' }),
  },
];
