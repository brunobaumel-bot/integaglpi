import type { GlpiForm } from './glpiTypes.js';
import { env } from '../../config/env.js';
import { logger } from '../../infra/logger/logger.js';

const FETCH_TIMEOUT_MS = 5_000;
const PLUGIN_ENDPOINT_PATH = '/plugins/integaglpi/front/form.catalog.php';

/**
 * Adapter read-only para o catálogo nativo de Forms do GLPI (glpi_forms_forms).
 *
 * Chama o endpoint PHP integaglpi/front/form.catalog.php via HTTP — nunca
 * acessa o MariaDB do GLPI diretamente.
 *
 * Autenticação: bearer token igual ao integration_auth_key configurado no
 * plugin GLPI (mesmo padrão do kb.search.php).
 *
 * NÃO integrado na FSM — use apenas em jobs/diagnósticos/futuras integrações.
 *
 * PHASE: integaglpi_v8_service_catalog_gap_fix_and_bridge_001
 */
export class GlpiFormCatalogAdapter {
  private readonly glpiWebBaseUrl: string;
  private readonly bearerToken: string;

  /**
   * @param glpiWebBaseUrl - Base URL do servidor GLPI (ex.: "http://glpi.example.com").
   *   Se omitido, deriva de GLPI_API_BASE_URL removendo "/apirest.php".
   * @param bearerToken - Token compartilhado com o plugin GLPI (integration_auth_key).
   *   Se omitido, usa INTEGRATION_SERVICE_API_KEY como fallback de dev/teste.
   */
  public constructor(glpiWebBaseUrl?: string, bearerToken?: string) {
    this.glpiWebBaseUrl = glpiWebBaseUrl ?? GlpiFormCatalogAdapter.deriveWebBase(env.GLPI_API_BASE_URL);
    this.bearerToken = bearerToken ?? env.INTEGRATION_SERVICE_API_KEY;
  }

  /**
   * Busca formulários ativos do GLPI via endpoint PHP.
   * Nunca lança exceção — retorna [] em caso de falha de rede ou parse.
   *
   * @param entityId - Entidade a filtrar; null ou 0 retorna todas as entidades.
   */
  public async fetchForms(entityId: number | null = null): Promise<GlpiForm[]> {
    const url = new URL(PLUGIN_ENDPOINT_PATH, this.glpiWebBaseUrl);
    if (entityId !== null && entityId > 0) {
      url.searchParams.set('entities_id', String(entityId));
    }

    let raw: unknown;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.bearerToken}`,
          },
          signal: controller.signal,
        });
        raw = await response.json() as unknown;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error: unknown) {
      logger.warn(
        {
          stage: 'glpi_form_catalog_fetch',
          entityId,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        '[integaglpi][form_catalog] Falha ao buscar formulários GLPI; retornando lista vazia.',
      );
      return [];
    }

    return this.normalizeResponse(raw);
  }

  private normalizeResponse(raw: unknown): GlpiForm[] {
    if (typeof raw !== 'object' || raw === null) {
      return [];
    }
    const payload = raw as Record<string, unknown>;
    if (payload['ok'] !== true || !Array.isArray(payload['forms'])) {
      return [];
    }
    const forms: GlpiForm[] = [];
    for (const item of payload['forms'] as unknown[]) {
      if (typeof item !== 'object' || item === null) {
        continue;
      }
      const row = item as Record<string, unknown>;
      const id = typeof row['id'] === 'number' ? row['id'] : 0;
      const name = typeof row['name'] === 'string' ? row['name'] : '';
      const entitiesId = typeof row['entities_id'] === 'number' ? row['entities_id'] : 0;
      if (id > 0 && name !== '') {
        forms.push({ id, name, entitiesId });
      }
    }
    return forms;
  }

  private static deriveWebBase(apiBaseUrl: string): string {
    return apiBaseUrl.replace(/\/apirest\.php\/?$/, '');
  }
}
