/**
 * V10 Shadow Replay Lab G6 - sanitized sample envelope contract.
 *
 * Type-only/pure-function boundary. No runtime adapter, database, cache, HTTP
 * or external service dependency is allowed in this layer.
 */

import type { ShadowReplaySanitizedMetadata } from './ShadowReplayStoreTypes.js';

export const SHADOW_REPLAY_SAMPLE_ENVELOPE_SCHEMA_VERSION = 'g6_sample_envelope_v1' as const;

export type ShadowReplaySampleSourceKind =
  | 'synthetic_ticket'
  | 'synthetic_conversation'
  | 'synthetic_message'
  | 'synthetic_case';

export type ShadowReplayRedactionKind =
  | 'email'
  | 'phone'
  | 'cpf_cnpj'
  | 'token'
  | 'url_secret'
  | 'ticket_protocol'
  | 'person_name'
  | 'private_key'
  | 'base64'
  | 'html';

export type ShadowReplaySampleValidationCode =
  | 'invalid_reference'
  | 'invalid_source_kind'
  | 'empty_summary'
  | 'forbidden_key'
  | 'residual_pii'
  | 'metadata_not_sanitized'
  | 'schema_version_mismatch';

export interface ShadowReplaySanitizationReport {
  readonly redacted: Readonly<Record<ShadowReplayRedactionKind, number>>;
  readonly truncated_fields: readonly string[];
  readonly forbidden_keys: readonly string[];
  readonly residual_pii_detected: boolean;
}

export interface ShadowReplaySampleEnvelopeInput {
  readonly run_id: string;
  readonly sample_id: string;
  readonly source_kind: ShadowReplaySampleSourceKind;
  readonly source_ref: string;
  readonly problem_summary: string;
  readonly technical_summary?: string | null;
  readonly classification?: ShadowReplaySanitizedMetadata;
  readonly metadata?: ShadowReplaySanitizedMetadata;
  readonly observed_at?: string | null;
  readonly created_at?: string | null;
}

export interface ShadowReplaySampleEnvelope {
  readonly schema_version: typeof SHADOW_REPLAY_SAMPLE_ENVELOPE_SCHEMA_VERSION;
  readonly run_id: string;
  readonly sample_id: string;
  readonly source_kind: ShadowReplaySampleSourceKind;
  readonly source_ref_hash: string;
  readonly sanitized_problem_summary: string;
  readonly sanitized_technical_summary: string;
  readonly classification_metadata: ShadowReplaySanitizedMetadata;
  readonly sanitized_metadata: ShadowReplaySanitizedMetadata;
  readonly redaction_report: ShadowReplaySanitizationReport;
  readonly observed_at: string | null;
  readonly created_at: string;
}

export interface ShadowReplaySampleValidationIssue {
  readonly code: ShadowReplaySampleValidationCode;
  readonly path: string;
  readonly message: string;
}

export interface ShadowReplaySampleValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ShadowReplaySampleValidationIssue[];
}
