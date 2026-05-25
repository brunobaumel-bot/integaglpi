import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RedisKeyLock } from '../../cache/RedisKeyLock.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';
import { analyzeHistoricalMiningDataset } from '../../historicalMining/engine.js';
import { loadHistoricalMiningDataset, validateHistoricalWindow, validateMaxRows } from '../../historicalMining/input.js';
import { sanitizeHistoricalText } from '../../historicalMining/sanitizer.js';
import { persistHistoricalMiningResult } from '../../historicalMining/repository.js';
import type {
  HistoricalMiningDataset,
  HistoricalMiningRejection,
  HistoricalMiningResult,
} from '../../historicalMining/types.js';
import { generateKbCandidatesFromHistory } from '../../kbCandidates/generator.js';
import { loadKbCandidateGenerationInput, persistKbCandidates } from '../../kbCandidates/repository.js';
import type { KeyLock } from '../contracts/KeyLock.js';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_UI_ROWS = 5_000;

export class AiOperationsError extends Error {
  public constructor(
    public readonly errorCode: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export interface HistoricalMiningUiInput {
  filename: string;
  jsonlContent: string;
  maxRows: number;
  windowStart?: string;
  windowEnd?: string;
  dryRunToken?: string;
  requestedBy?: number | null;
}

export interface KbCandidateUiInput {
  runId: string;
  maxCandidates: number;
  minConfidence: number;
  dryRun?: boolean;
  requestedBy?: number | null;
}

interface MiningRunOptions {
  windowStart?: Date;
  windowEnd?: Date;
  maxRows: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseOptionalDate(value?: string): Date | undefined {
  const text = String(value ?? '').trim();
  return text === '' ? undefined : new Date(text);
}

function normalizePositiveInteger(value: number, fallback: number, max: number): number {
  if (!Number.isInteger(value) || value < 1) {
    return fallback;
  }

  return Math.min(value, max);
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'history.jsonl';
}

export class AiOperationsService {
  public constructor(
    private readonly executor: SqlExecutor,
    private readonly lock: KeyLock = new RedisKeyLock(60_000, 0, 0),
  ) {}

  public async previewHistoricalMining(input: HistoricalMiningUiInput) {
    const { result, options, dataset } = await this.analyzeUploadedJsonl(input);
    const token = this.dryRunToken(result.run.inputHash, options);

    await this.audit('HISTORICAL_MINING_UPLOAD_VALIDATED', 'success', input.requestedBy ?? null, {
      input_hash: result.run.inputHash,
      rows_seen: result.run.rowsSeen,
      rows_processed: result.run.rowsProcessed,
      rows_rejected: result.run.rowsRejected,
    });
    await this.audit('HISTORICAL_MINING_DRY_RUN', 'success', input.requestedBy ?? null, {
      input_hash: result.run.inputHash,
      rows_processed: result.run.rowsProcessed,
      patterns: result.patterns.length,
      insights: result.insights.length,
    });

    return {
      dry_run_token: token,
      summary: this.summaryFor(result, true),
      preview_rows: result.evidence.slice(0, 5).map((item) => ({
        ticket_id_hash: item.ticketIdHash,
        excerpt: sanitizeHistoricalText(item.anonymizedExcerpt, 240),
      })),
      rejection_reasons: this.rejectionReasonsFor(dataset),
      rejection_examples: this.rejectionExamplesFor(dataset),
      next_action: this.nextActionFor(result, dataset, true),
      patterns: result.patterns.slice(0, 10),
      insights: result.insights.slice(0, 10),
      evidence: result.evidence.slice(0, 10),
    };
  }

  public async executeHistoricalMining(input: HistoricalMiningUiInput) {
    return this.withOperationLock(this.miningLockKey(input), async () => {
      const { result, options, dataset } = await this.analyzeUploadedJsonl(input);
      const expectedToken = this.dryRunToken(result.run.inputHash, options);
      if (!input.dryRunToken || input.dryRunToken !== expectedToken) {
        await this.audit('HISTORICAL_MINING_EXECUTION_BLOCKED', 'blocked', input.requestedBy ?? null, {
          reason: 'dry_run_required',
          input_hash: result.run.inputHash,
        });
        throw new AiOperationsError(
          'HISTORICAL_MINING_DRY_RUN_REQUIRED',
          'Execute o dry-run e confirme o mesmo arquivo antes da mineração real.',
          409,
        );
      }
      if (result.run.rowsProcessed <= 0) {
        await this.audit('HISTORICAL_MINING_EXECUTION_BLOCKED', 'blocked', input.requestedBy ?? null, {
          reason: 'no_processable_rows',
          input_hash: result.run.inputHash,
          rows_seen: result.run.rowsSeen,
          rows_rejected: result.run.rowsRejected,
          rejection_reasons: this.rejectionReasonsFor(dataset),
        });
        throw new AiOperationsError(
          'HISTORICAL_MINING_NO_PROCESSABLE_ROWS',
          'A execução real foi bloqueada porque o dry-run não encontrou linhas processáveis.',
          409,
        );
      }

      await persistHistoricalMiningResult(this.executor, result, 'glpi_ui');
      await this.audit('HISTORICAL_MINING_EXECUTED', 'success', input.requestedBy ?? null, {
        run_id: result.run.runId,
        input_hash: result.run.inputHash,
        rows_processed: result.run.rowsProcessed,
        patterns: result.patterns.length,
        insights: result.insights.length,
      });

      return {
        summary: this.summaryFor(result, false),
        rejection_reasons: this.rejectionReasonsFor(dataset),
        rejection_examples: this.rejectionExamplesFor(dataset),
        next_action: this.nextActionFor(result, dataset, false),
        patterns: result.patterns.slice(0, 10),
        insights: result.insights.slice(0, 10),
        evidence: result.evidence.slice(0, 10),
      };
    });
  }

  public async generateKbCandidates(input: KbCandidateUiInput) {
    const runId = input.runId.trim();
    if (runId === '') {
      throw new AiOperationsError('KB_CANDIDATE_RUN_ID_REQUIRED', 'run_id obrigatório.');
    }

    return this.withOperationLock(`kb_candidates:${sha256(runId)}`, async () => {
      const maxCandidates = normalizePositiveInteger(input.maxCandidates, 20, 50);
      const minConfidence = normalizePositiveInteger(input.minConfidence, 65, 100);
      await this.audit('KB_CANDIDATE_GENERATION_REQUESTED', 'pending', input.requestedBy ?? null, {
        run_id: runId,
        max_candidates: maxCandidates,
        min_confidence: minConfidence,
        dry_run: input.dryRun === true,
      });

      const generationInput = await loadKbCandidateGenerationInput(this.executor, runId);
      const candidates = generateKbCandidatesFromHistory(generationInput, {
        maxCandidates,
        minConfidence,
      });
      const inserted = input.dryRun === true
        ? 0
        : await persistKbCandidates(this.executor, candidates, input.requestedBy ?? null);

      await this.audit('KB_CANDIDATE_GENERATION_COMPLETED', 'success', input.requestedBy ?? null, {
        run_id: runId,
        candidates_generated: candidates.length,
        candidates_inserted: inserted,
        low_confidence: candidates.filter((candidate) => candidate.status === 'low_confidence').length,
        possible_duplicate: candidates.filter((candidate) => candidate.possibleDuplicate).length,
      });

      return {
        run_id: runId,
        dry_run: input.dryRun === true,
        candidates_generated: candidates.length,
        candidates_inserted: inserted,
        low_confidence: candidates.filter((candidate) => candidate.status === 'low_confidence').length,
        possible_duplicate: candidates.filter((candidate) => candidate.possibleDuplicate).length,
        candidates: candidates.slice(0, 10).map((candidate) => ({
          title: candidate.title,
          status: candidate.status,
          article_type: candidate.articleType,
          confidence_score: candidate.confidenceScore,
          possible_duplicate: candidate.possibleDuplicate,
        })),
      };
    });
  }

  private miningLockKey(input: HistoricalMiningUiInput): string {
    return `historical_mining:${sha256([
      input.filename,
      input.jsonlContent,
      String(input.maxRows),
      input.windowStart ?? '',
      input.windowEnd ?? '',
    ].join('|'))}`;
  }

  private async withOperationLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    let entered = false;
    try {
      return await this.lock.withLock(`ai_operations:${key}`, async () => {
        entered = true;
        return work();
      });
    } catch (error: unknown) {
      if (error instanceof AiOperationsError) {
        throw error;
      }
      if (entered) {
        throw error;
      }
      throw new AiOperationsError(
        'AI_OPERATIONS_LOCK_UNAVAILABLE',
        'Operação já em execução ou lock Redis indisponível. Tente novamente em instantes.',
        409,
      );
    }
  }

  private async analyzeUploadedJsonl(input: HistoricalMiningUiInput) {
    const filename = safeFilename(input.filename);
    if (!filename.toLowerCase().endsWith('.jsonl')) {
      throw new AiOperationsError('HISTORICAL_MINING_JSONL_REQUIRED', 'Envie um arquivo JSONL sanitizado.');
    }
    if (Buffer.byteLength(input.jsonlContent, 'utf8') > MAX_UPLOAD_BYTES) {
      throw new AiOperationsError('HISTORICAL_MINING_UPLOAD_TOO_LARGE', 'Arquivo acima do limite seguro de 5 MB.');
    }
    if (input.jsonlContent.trim() === '') {
      throw new AiOperationsError('HISTORICAL_MINING_INPUT_REQUIRED', 'Conteúdo JSONL obrigatório.');
    }

    const windowStart = parseOptionalDate(input.windowStart);
    const windowEnd = parseOptionalDate(input.windowEnd);
    validateHistoricalWindow(windowStart, windowEnd);
    const maxRows = validateMaxRows(normalizePositiveInteger(input.maxRows, 1000, MAX_UI_ROWS));
    const options = { windowStart, windowEnd, maxRows };

    const tempDir = await mkdtemp(join(tmpdir(), 'integaglpi-hist-ui-'));
    const tempFile = join(tempDir, filename);
    try {
      await writeFile(tempFile, input.jsonlContent, 'utf8');
      let dataset;
      try {
        dataset = await loadHistoricalMiningDataset(tempFile, options);
      } catch {
        throw new AiOperationsError(
          'HISTORICAL_MINING_INVALID_JSONL',
          'JSONL inválido ou fora do contrato sanitizado.',
          400,
        );
      }
      const result = analyzeHistoricalMiningDataset(dataset, {
        windowStart,
        windowEnd,
      });

      return { result, options, dataset };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private dryRunToken(inputHash: string, options: MiningRunOptions): string {
    return sha256([
      'integaglpi_history_ui_dry_run_v1',
      inputHash,
      options.windowStart?.toISOString() ?? '',
      options.windowEnd?.toISOString() ?? '',
      String(options.maxRows),
    ].join('|'));
  }

  private summaryFor(result: HistoricalMiningResult, dryRun: boolean) {
    return {
      run_id: result.run.runId,
      input_hash: result.run.inputHash,
      dry_run: dryRun,
      rows_seen: result.run.rowsSeen,
      rows_processed: result.run.rowsProcessed,
      rows_rejected: result.run.rowsRejected,
      patterns: result.patterns.length,
      insights: result.insights.length,
      evidence: result.evidence.length,
    };
  }

  private rejectionReasonsFor(dataset: HistoricalMiningDataset) {
    return Object.entries(dataset.rejectionReasonCounts ?? {})
      .filter(([, count]) => Number(count) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .map(([reason, count]) => ({
        reason,
        count: Number(count),
      }));
  }

  private rejectionExamplesFor(dataset: HistoricalMiningDataset) {
    return (dataset.rejectionExamples ?? []).slice(0, 5).map((item: HistoricalMiningRejection) => ({
      line: item.line,
      reason: item.reason,
      field: item.field ?? null,
      ticket_id_hash: item.ticketIdHash ?? null,
      excerpt: item.excerpt ? sanitizeHistoricalText(item.excerpt, 180) : null,
    }));
  }

  private nextActionFor(
    result: HistoricalMiningResult,
    dataset: HistoricalMiningDataset,
    dryRun: boolean,
  ): string {
    if (result.run.rowsProcessed <= 0) {
      const reasons = this.rejectionReasonsFor(dataset).slice(0, 2).map((item) => item.reason).join(', ');
      return reasons
        ? `Revise o JSONL antes de executar: principais rejeições: ${reasons}.`
        : 'Revise o JSONL antes de executar: nenhuma linha processável foi encontrada.';
    }
    if (dryRun) {
      return 'Dry-run válido. Revise patterns/insights e só então execute a mineração real.';
    }

    return 'Mineração persistida. Use o run_id para gerar candidatos de KB revisáveis.';
  }

  private async tableExists(tableName: string): Promise<boolean> {
    const result = await this.executor.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = $1
        ) AS exists
      `,
      [tableName],
    );

    return result.rows[0]?.exists === true;
  }

  private async audit(
    eventType: string,
    status: 'blocked' | 'pending' | 'success',
    userId: number | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!(await this.tableExists('glpi_plugin_integaglpi_audit_events'))) {
      return;
    }

    await this.executor.query(
      `
        INSERT INTO public.glpi_plugin_integaglpi_audit_events (
          correlation_id,
          ticket_id,
          conversation_id,
          message_id,
          direction,
          event_type,
          status,
          severity,
          source,
          payload_json,
          created_at
        )
        VALUES (
          $1,
          NULL,
          NULL,
          NULL,
          NULL,
          $2,
          $3,
          $4,
          'AiOperationsService',
          $5::jsonb,
          NOW()
        )
      `,
      [
        `ai_operations:${randomUUID()}`,
        eventType,
        status,
        status === 'blocked' ? 'warning' : 'info',
        JSON.stringify({
          glpi_user_id: userId,
          ...payload,
        }),
      ],
    );
  }
}
