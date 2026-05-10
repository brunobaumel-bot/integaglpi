import { z } from 'zod';

const metaMediaObjectSchema = z.object({
  id: z.string().min(1),
  mime_type: z.string().optional(),
  sha256: z.string().optional(),
  caption: z.string().optional(),
});

const metaDocumentObjectSchema = metaMediaObjectSchema.extend({
  filename: z.string().optional(),
});

const metaAudioObjectSchema = metaMediaObjectSchema.extend({
  voice: z.boolean().optional(),
});

const metaInteractiveObjectSchema = z.object({
  type: z.string().optional(),
  button_reply: z
    .object({
      id: z.string().optional(),
      title: z.string().optional(),
    })
    .optional(),
});

const metaMessageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  timestamp: z.string().optional(),
  type: z.string().min(1),
  text: z
    .object({
      body: z.string().optional(),
    })
    .optional(),
  image: metaMediaObjectSchema.optional(),
  document: metaDocumentObjectSchema.optional(),
  audio: metaAudioObjectSchema.optional(),
  interactive: metaInteractiveObjectSchema.optional(),
});

const metaContactSchema = z.object({
  profile: z
    .object({
      name: z.string().optional(),
    })
    .optional(),
  wa_id: z.string().optional(),
});

const metaValueSchema = z.object({
  messaging_product: z.string().optional(),
  metadata: z
    .object({
      display_phone_number: z.string().optional(),
      phone_number_id: z.string().optional(),
    })
    .optional(),
  contacts: z.array(metaContactSchema).optional(),
  messages: z.array(metaMessageSchema).optional(),
  statuses: z.array(z.record(z.string(), z.unknown())).optional(),
});

const metaChangeSchema = z.object({
  field: z.string(),
  value: metaValueSchema,
});

const metaEntrySchema = z.object({
  id: z.string(),
  changes: z.array(metaChangeSchema),
});

export const metaWebhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(metaEntrySchema),
});

export type MetaWebhookPayload = z.infer<typeof metaWebhookPayloadSchema>;

export interface InboundMediaMetadata {
  mediaId: string;
  mimeTypeFromWebhook: string | null;
  fileName: string | null;
  caption: string | null;
}

export interface ParsedMetaInboundMessage {
  eventId: string;
  eventType: 'message';
  messageId: string;
  senderPhone: string;
  recipientPhone: string;
  messageType: string;
  messageText: string | null;
  mediaMetadata: InboundMediaMetadata | null;
  contactName: string | null;
  timestamp: string | null;
  rawPayload: MetaWebhookPayload;
}
