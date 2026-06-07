/**
 * AssetContextSummaryService
 *
 * Consulta dados seguros do ativo GLPI resolvido (Computer) e gera um resumo
 * técnico curto para o atendente. O resumo é injetado como nota interna
 * (is_private=1) no chamado GLPI — nunca enviado ao cliente WhatsApp.
 *
 * Fontes de dados:
 *   - GLPI REST API: hostname, entidade, fabricante, modelo (via expand_dropdowns).
 *   - IA local (Ollama) opcional: apenas para melhorar legibilidade do texto.
 *     Se falhar ou exceder timeout: resumo determinístico é usado como fallback.
 *
 * Dados excluídos por design:
 *   - IP local, MAC, serial, usuários locais, perfis Windows, tokens/chaves.
 *   - Qualquer dado não obtido da fonte — sem invenção de valores.
 *
 * Feature flag: ASSET_CONTEXT_SUMMARY_ENABLED (default false).
 *   - false: o serviço retorna imediatamente sem consultar GLPI.
 *   - true: fluxo completo; falha nunca bloqueia abertura de chamado.
 *
 * PHASE: integaglpi_asset_context_summary_001
 */

import type { GlpiClient } from '../../adapters/glpi/GlpiClient.js';
import type { GlpiComputerContext } from '../../adapters/glpi/glpiTypes.js';
import { env } from '../../config/env.js';
import { logger } from '../../infra/logger/logger.js';
import type { LogmeinHostContext, LogmeinReadonlyCacheRepository } from './LogmeinReadonlyContextService.js';

// ── Interfaces públicas ───────────────────────────────────────────────────────

export interface AssetContextSummaryInput {
  /** Tag/etiqueta de patrimônio informada pelo usuário. */
  equipmentTag: string;
  /** Entidade GLPI já resolvida. */
  entityId: number;
  /** ID da conversa (para auditoria). */
  conversationId: string | null;
  /**
   * ID do chamado GLPI onde a nota interna será injetada.
   * Se null, o resumo é gerado mas não persistido no GLPI.
   */
  ticketId: number | null;
}

export type AssetContextSummaryStatus =
  | 'generated_and_injected'  // resumo gerado + nota interna criada no chamado
  | 'generated_not_injected'  // resumo gerado mas ticketId não disponível
  | 'no_computer_found'       // ativo não localizado via otherserial
  | 'disabled'                // flag off
  | 'error';                  // falha inesperada (nunca propaga exceção)

export interface AssetContextSummaryResult {
  status: AssetContextSummaryStatus;
  computerId: number | null;
  summaryText: string | null;
  source: 'glpi_only' | 'glpi_logmein_cache' | 'none';
  aiUsed: boolean;
  noteId: number | null;
}

// ── Opcional: IA local para melhorar legibilidade ────────────────────────────

export interface LocalAiSummarizer {
  /**
   * Recebe payload já sanitizado e retorna texto melhorado.
   * Nunca lança exceção — retorna null em caso de falha.
   */
  summarize(sanitizedPayload: string, timeoutMs: number): Promise<string | null>;
}

// ── Classe principal ──────────────────────────────────────────────────────────

export class AssetContextSummaryService {
  private readonly logmeinRepository: Pick<LogmeinReadonlyCacheRepository, 'findHostByEquipmentTag'> | null;
  private readonly localAi: LocalAiSummarizer | null;

  public constructor(
    private readonly glpiClient: GlpiClient,
    logmeinRepositoryOrLocalAi: Pick<LogmeinReadonlyCacheRepository, 'findHostByEquipmentTag'> | LocalAiSummarizer | null = null,
    /**
     * IA local opcional para melhorar a legibilidade do resumo.
     * Se null ou se a geração falhar, o template determinístico é usado.
     * IA cloud não é aceita — verificada em runtime.
     */
    localAi: LocalAiSummarizer | null = null,
  ) {
    if (logmeinRepositoryOrLocalAi && 'summarize' in logmeinRepositoryOrLocalAi) {
      this.logmeinRepository = null;
      this.localAi = logmeinRepositoryOrLocalAi;
    } else {
      this.logmeinRepository = logmeinRepositoryOrLocalAi;
      this.localAi = localAi;
    }
  }

  /**
   * Gera o resumo de contexto do ativo e o injeta como nota interna no chamado.
   * Fire-and-forget seguro: nunca lança exceção.
   */
  public async generate(input: AssetContextSummaryInput): Promise<AssetContextSummaryResult> {
    if (!env.ASSET_CONTEXT_SUMMARY_ENABLED) {
      return this.result('disabled', null, null, false, null);
    }

    try {
      return await this.generateUnsafe(input);
    } catch (error: unknown) {
      logger.warn(
        {
          stage: 'asset_context_summary',
          conversation_id: input.conversationId,
          equipment_tag: input.equipmentTag,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        '[integaglpi][asset_context] Falha inesperada na geração de contexto; chamado não afetado.',
      );
      return this.result('error', null, null, false, null);
    }
  }

  // ── Implementação interna ─────────────────────────────────────────────────

  private async generateUnsafe(input: AssetContextSummaryInput): Promise<AssetContextSummaryResult> {
    // 1. Localizar Computer pelo patrimônio
    const assets = await this.glpiClient.findComputersByOtherserial(input.equipmentTag, 1).catch(() => []);
    if (assets.length === 0) {
      logger.info(
        {
          stage: 'asset_context_summary',
          conversation_id: input.conversationId,
          equipment_tag: input.equipmentTag,
        },
        '[integaglpi][asset_context] Ativo não localizado; contexto omitido.',
      );
      return this.result('no_computer_found', null, null, false, null);
    }

    const computerId = assets[0]!.id;

    // 2. Buscar contexto seguro do Computer (sem serial/MAC/IP/usuários)
    const computerContext = await this.glpiClient.fetchComputerContext(computerId).catch(() => ({
      computerId,
      hostname: null,
      entityId: null,
      entityName: null,
      manufacturer: null,
      model: null,
    } satisfies GlpiComputerContext));

    // 3. Sanitizar (garantia dupla: nenhum campo proibido entra no resumo)
    const logmeinContext = await this.logmeinRepository?.findHostByEquipmentTag?.(input.equipmentTag)
      .catch(() => null) ?? null;
    const safePayload = this.buildSafePayload(input.equipmentTag, computerContext, logmeinContext);
    const source: AssetContextSummaryResult['source'] = logmeinContext ? 'glpi_logmein_cache' : 'glpi_only';

    // 4. Gerar resumo (IA local com fallback determinístico)
    const { summaryText, aiUsed } = await this.buildSummary(safePayload);

    // 5. Injetar como nota interna no chamado, se ticketId disponível
    let noteId: number | null = null;
    let status: AssetContextSummaryStatus = 'generated_not_injected';

    if (input.ticketId !== null && input.ticketId > 0) {
      noteId = await this.glpiClient.addInternalNote(input.ticketId, summaryText).catch(() => null);
      status = noteId === null ? 'generated_not_injected' : 'generated_and_injected';
    }

    // 6. Auditoria (sem dados sensíveis)
    logger.info(
      {
        stage: 'asset_context_summary',
        event_type: 'ASSET_CONTEXT_SUMMARY_GENERATED',
        conversation_id: input.conversationId,
        ticket_id: input.ticketId,
        computer_id: computerId,
        entity_id: input.entityId,
        source,
        ai_used: aiUsed,
        logmein_status_used: logmeinContext !== null,
        summary_generated: true,
        note_id: noteId,
        status,
      },
      '[integaglpi][asset_context] Contexto do ativo gerado.',
    );

    return {
      status,
      computerId,
      summaryText,
      source,
      aiUsed,
      noteId,
    };
  }

  // ── Payload sanitizado ────────────────────────────────────────────────────

  /**
   * Constrói o objeto sanitizado que irá para o template / IA local.
   * Somente campos explicitamente permitidos são incluídos.
   * Campos ausentes são omitidos — nunca preenchidos com placeholders.
   */
  private buildSafePayload(
    equipmentTag: string,
    ctx: GlpiComputerContext,
    logmein: LogmeinHostContext | null = null,
  ): Record<string, string> {
    const payload: Record<string, string> = {};

    // Etiqueta/patrimônio (pública — informada pelo próprio usuário)
    if (equipmentTag.trim() !== '') {
      payload['patrimônio'] = equipmentTag.trim();
    }

    // Hostname (sem IP, sem MAC)
    if (ctx.hostname) {
      payload['hostname'] = ctx.hostname;
    }

    // Entidade
    if (ctx.entityName) {
      payload['entidade'] = ctx.entityName;
    } else if (ctx.entityId !== null) {
      payload['entidade_id'] = String(ctx.entityId);
    }

    // Fabricante e modelo (sem serial)
    if (ctx.manufacturer) {
      payload['fabricante'] = ctx.manufacturer;
    }
    if (ctx.model) {
      payload['modelo'] = ctx.model;
    }

    if (logmein) {
      if (logmein.status && logmein.status !== 'unknown') {
        payload['logmein_status'] = logmein.status === 'online' ? 'online' : 'offline';
      }
      if (logmein.lastSeenAt) {
        payload['logmein_ultimo_status'] = logmein.lastSeenAt;
      }
      if (logmein.groupName) {
        payload['logmein_grupo'] = logmein.groupName;
      }
      if (logmein.hostName) {
        payload['logmein_hostname_sanitizado'] = logmein.hostName;
      }
    }

    // NOTA: nenhum dos seguintes campos é incluído neste payload:
    //   serial, MAC, IP local, usuários locais, windowsProfiles,
    //   lastLogonUserName, tokens, chaves, dados de rede interna.

    return payload;
  }

  // ── Geração do resumo ─────────────────────────────────────────────────────

  private async buildSummary(
    payload: Record<string, string>,
  ): Promise<{ summaryText: string; aiUsed: boolean }> {
    const deterministic = this.buildDeterministicSummary(payload);

    if (this.localAi === null) {
      return { summaryText: deterministic, aiUsed: false };
    }

    // IA local com timeout de 6s; se falhar ou retornar vazio, usa determinístico
    const payloadJson = JSON.stringify(payload, null, 2);
    const prompt = [
      'Você é um assistente técnico interno. Gere um resumo CURTO (máximo 3 linhas) do equipamento abaixo para o técnico que vai atender o chamado.',
      'Use somente os dados fornecidos — não invente informações.',
      'Não inclua IP, MAC, serial, usuários ou dados de rede.',
      '',
      'Dados do equipamento:',
      payloadJson,
      '',
      'Resumo:',
    ].join('\n');

    const aiText = await this.localAi.summarize(prompt, 6_000).catch(() => null);
    const cleaned = typeof aiText === 'string' ? aiText.trim() : '';

    if (cleaned === '' || cleaned.length > 600) {
      return { summaryText: deterministic, aiUsed: false };
    }

    return { summaryText: `[Contexto IA local]\n${cleaned}`, aiUsed: true };
  }

  /**
   * Gera resumo determinístico sem IA.
   * Usa somente campos presentes em `payload` — sem invenção de dados.
   */
  private buildDeterministicSummary(payload: Record<string, string>): string {
    const lines: string[] = ['[Contexto do equipamento — gerado automaticamente]'];

    if (payload['patrimônio']) {
      lines.push(`Patrimônio: ${payload['patrimônio']}`);
    }
    if (payload['hostname']) {
      lines.push(`Hostname: ${payload['hostname']}`);
    }
    if (payload['entidade']) {
      lines.push(`Entidade: ${payload['entidade']}`);
    } else if (payload['entidade_id']) {
      lines.push(`Entidade ID: ${payload['entidade_id']}`);
    }
    if (payload['fabricante'] || payload['modelo']) {
      const hw = [payload['fabricante'], payload['modelo']].filter(Boolean).join(' ');
      lines.push(`Hardware: ${hw}`);
    }
    if (payload['logmein_status']) {
      lines.push(`LogMeIn: status ${payload['logmein_status']}.`);
    }
    if (payload['logmein_ultimo_status']) {
      lines.push(`LogMeIn ultimo status: ${payload['logmein_ultimo_status']}.`);
    }
    if (payload['logmein_grupo']) {
      lines.push(`Grupo LogMeIn: ${payload['logmein_grupo']}.`);
    }

    if (lines.length === 1) {
      // Nenhum dado útil disponível além do cabeçalho
      lines.push('Dados do equipamento não disponíveis via GLPI no momento.');
    }

    return lines.join('\n');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private result(
    status: AssetContextSummaryStatus,
    computerId: number | null,
    summaryText: string | null,
    aiUsed: boolean,
    noteId: number | null,
  ): AssetContextSummaryResult {
    return { status, computerId, summaryText, source: 'none', aiUsed, noteId };
  }
}
