import type { GlpiClient } from './GlpiClient.js';
import type { GlpiForm, GlpiItilCategory } from './glpiTypes.js';
import type { GlpiTriageCacheRepository } from '../../cache/GlpiTriageCacheRepository.js';
import type { GlpiFormCatalogAdapter } from './GlpiFormCatalogAdapter.js';
import type { ActiveRoutingOption } from '../../repositories/contracts/RoutingRepository.js';
import { logger } from '../../infra/logger/logger.js';

/**
 * Normaliza categorias ITIL nativas do GLPI (e opcionalmente Forms nativos)
 * em opções de menu WhatsApp.
 *
 * Limitações do Meta:
 *   - Máximo de 10 opções (botões numéricos); 3 para reply-buttons interativos.
 *   - Máximo de 20 caracteres por label de opção (truncado com "…").
 *   - optionKey deve ser não-vazio:
 *       "glpic_<id>" para categorias ITIL
 *       "glpif_<id>" para Forms nativos
 *
 * Estratégia de cache (Redis):
 *   - Hit primário (TTL 900 s) → retorna sem chamar GLPI.
 *   - Miss + fonte disponível → busca, normaliza, grava no cache, retorna fresh.
 *   - Miss + fonte falha + stale disponível (TTL 3600 s) → retorna stale + warning.
 *   - Miss + fonte falha + sem stale → retorna lista vazia (fallback controlado).
 *
 * Fontes de triagem (NATIVE_GLPI_TRIAGE_SOURCES):
 *   - "itilcategory" (default) — apenas ITILCategory via GLPI REST API.
 *   - "form"                   — apenas Forms nativos via GlpiFormCatalogAdapter.
 *   - "both"                   — mescla categorias + forms, ordena A-Z, limita a 10.
 *
 * PHASE: integaglpi_v8_native_catalog_dynamic_triage_001
 * PHASE: integaglpi_v8_forms_native_triage_integration_001
 */

const MAX_LABEL_CHARS = 20;
const MAX_OPTIONS = 10;
const ITIL_OPTION_KEY_PREFIX = 'glpic_';
const FORM_OPTION_KEY_PREFIX = 'glpif_';

export type TriageSources = 'itilcategory' | 'form' | 'both';

function sanitizeLabel(raw: string): string {
  const cleaned = raw
    .replace(/[ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= MAX_LABEL_CHARS) {
    return cleaned;
  }

  return `${cleaned.slice(0, MAX_LABEL_CHARS - 1)}…`;
}

function toRoutingOption(cat: GlpiItilCategory, sortOrder: number): ActiveRoutingOption {
  return {
    id: cat.id,
    label: sanitizeLabel(cat.name !== '' ? cat.name : cat.completename),
    optionKey: `${ITIL_OPTION_KEY_PREFIX}${cat.id}`,
    queueId: null,
    glpiGroupId: null,
    glpiUserId: null,
    confirmationMessage: null,
    sortOrder,
    glpiItilCategoryId: cat.id,
  };
}

function toFormRoutingOption(form: GlpiForm, sortOrder: number): ActiveRoutingOption {
  return {
    id: form.id,
    label: sanitizeLabel(form.name),
    optionKey: `${FORM_OPTION_KEY_PREFIX}${form.id}`,
    queueId: null,
    glpiGroupId: null,
    glpiUserId: null,
    confirmationMessage: null,
    sortOrder,
    glpiFormId: form.id,
  };
}

export class GlpiItilCategoryNormalizer {
  public constructor(
    private readonly glpiClient: GlpiClient,
    private readonly cacheRepository: GlpiTriageCacheRepository,
    /** Adapter para Forms nativos — obrigatório somente quando triageSources inclui "form". */
    private readonly formCatalogAdapter: GlpiFormCatalogAdapter | null = null,
    /** Fontes de triagem ativas. Default: "itilcategory" (preserva comportamento anterior). */
    private readonly triageSources: TriageSources = 'itilcategory',
  ) {}

  /**
   * Retorna as opções de triagem normalizadas conforme a configuração de fontes.
   * Nunca lança exceção — falhas são absorvidas com fallback controlado.
   */
  public async getOptions(
    entityId: number | null = null,
    queueId: number | null = null,
    lang = 'pt',
  ): Promise<ActiveRoutingOption[]> {
    // Flow B strict: categories are always entity-scoped — never expose cross-entity catalog.
    // InboundWebhookService.resolveRoutingOptions() enforces this at the call site too,
    // but this guard is a defense-in-depth layer: any caller that bypasses the FSM guard
    // will still get an empty list instead of a leaking global result.
    if (entityId === null || entityId <= 0) {
      logger.warn(
        { entityId, sources: this.triageSources },
        '[integaglpi][native_triage] getOptions() chamado sem entityId válido (Flow B strict: entidade deve ser conhecida). Retornando lista vazia.',
      );
      return [];
    }

    // 1. Tentar cache primário
    let cached = await this.cacheRepository.get(entityId, queueId, lang).catch(() => null);

    if (cached !== null && !cached.isStale) {
      return cached.data;
    }

    // 2. Cache miss (ou só stale disponível) → buscar das fontes configuradas
    let fresh: ActiveRoutingOption[] | null = null;
    try {
      fresh = await this.fetchFromSources(entityId);
    } catch (error: unknown) {
      logger.warn(
        {
          stage: 'native_triage_fetch',
          entityId,
          sources: this.triageSources,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        '[integaglpi][native_triage] Falha ao buscar opções de triagem nativa; usando fallback.',
      );
    }

    if (fresh !== null) {
      // Gravar no cache (erro de gravação não bloqueia o fluxo)
      try {
        await this.cacheRepository.set(entityId, queueId, lang, fresh);
      } catch (err: unknown) {
        logger.warn(
          { errorMessage: err instanceof Error ? err.message : String(err) },
          '[integaglpi][native_triage] Falha ao gravar cache de triagem nativa.',
        );
      }
      return fresh;
    }

    // 3. Fonte falhou — tentar stale
    if (cached === null) {
      cached = await this.cacheRepository.get(entityId, queueId, lang).catch(() => null);
    }

    if (cached !== null && cached.isStale) {
      logger.warn(
        { stage: 'native_triage_fetch', entityId, sources: this.triageSources },
        '[integaglpi][native_triage] GLPI indisponível; usando stale cache de triagem.',
      );
      return cached.data;
    }

    // 4. Fallback controlado: lista vazia → FSM exibe error_fallback_message
    logger.warn(
      { stage: 'native_triage_fetch', entityId, sources: this.triageSources },
      '[integaglpi][native_triage] GLPI indisponível e sem stale cache; retornando lista vazia.',
    );
    return [];
  }

  // ── Source dispatch ──────────────────────────────────────────────────────────

  private async fetchFromSources(entityId: number | null): Promise<ActiveRoutingOption[]> {
    switch (this.triageSources) {
      case 'itilcategory':
        return this.fetchItilOptions(entityId);
      case 'form':
        return this.fetchFormOptions(entityId);
      case 'both':
        return this.fetchBothOptions(entityId);
    }
  }

  private async fetchItilOptions(entityId: number | null): Promise<ActiveRoutingOption[]> {
    const categories = await this.glpiClient.fetchItilCategories(entityId);
    return this.normalizeCategories(categories);
  }

  private async fetchFormOptions(entityId: number | null): Promise<ActiveRoutingOption[]> {
    if (!this.formCatalogAdapter) {
      logger.warn(
        { stage: 'native_triage_fetch', entityId },
        '[integaglpi][native_triage] Fonte "form" configurada mas GlpiFormCatalogAdapter não disponível; retornando lista vazia.',
      );
      return [];
    }
    const forms = await this.formCatalogAdapter.fetchForms(entityId);
    return this.normalizeForms(forms);
  }

  private async fetchBothOptions(entityId: number | null): Promise<ActiveRoutingOption[]> {
    const [itilResult, formResult] = await Promise.allSettled([
      this.fetchItilOptions(entityId),
      this.fetchFormOptions(entityId),
    ]);

    const itilOptions = itilResult.status === 'fulfilled' ? itilResult.value : [];
    const formOptions = formResult.status === 'fulfilled' ? formResult.value : [];

    return [...itilOptions, ...formOptions]
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
      .slice(0, MAX_OPTIONS)
      .map((opt, idx) => ({ ...opt, sortOrder: idx }));
  }

  // ── Normalization ────────────────────────────────────────────────────────────

  private normalizeCategories(categories: GlpiItilCategory[]): ActiveRoutingOption[] {
    return categories
      .filter((cat) => cat.is_helpdeskvisible)
      .sort((a, b) => a.completename.localeCompare(b.completename, 'pt-BR'))
      .slice(0, MAX_OPTIONS)
      .map((cat, index) => toRoutingOption(cat, index));
  }

  private normalizeForms(forms: GlpiForm[]): ActiveRoutingOption[] {
    return forms
      .slice(0, MAX_OPTIONS)
      .map((form, index) => toFormRoutingOption(form, index));
  }
}
