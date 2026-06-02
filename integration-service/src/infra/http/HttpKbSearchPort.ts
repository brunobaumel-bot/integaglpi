import type { KbSearchHit, KbSearchPort } from '../../domain/services/SmartHelpService.js';

/**
 * HttpKbSearchPort — Node-side adapter that queries the NATIVE GLPI KB through a
 * bearer-gated PHP endpoint (front/kb.search.php). The Node service never touches
 * GLPI's MariaDB directly; PHP owns that access and returns sanitized article rows.
 *
 * Safe by construction: read-only search, bounded timeout, returns [] on any error
 * so SmartHelp degrades gracefully (still serves checklist + questions + cloud offer).
 */
export interface HttpKbSearchConfig {
  /** Absolute URL of the PHP kb.search endpoint, e.g. https://glpi.host/plugins/integaglpi/front/kb.search.php */
  endpointUrl: string;
  /** Bearer token shared with the PHP endpoint (same internal key pattern). */
  apiKey: string;
  timeoutMs?: number;
}

interface PhpKbArticleRow {
  id?: number | string;
  title?: string;
  category?: string;
  snippet?: string;
  excerpt?: string;
  url?: string;
  score?: number;
}

const DEFAULT_TIMEOUT_MS = 4_000;

function clamp01(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0.5; // neutral default when PHP did not provide a relevance score
  }
  return Math.max(0, Math.min(1, n));
}

export class HttpKbSearchPort implements KbSearchPort {
  public constructor(private readonly config: HttpKbSearchConfig) {}

  public async searchNativeKb(query: string, limit: number): Promise<KbSearchHit[]> {
    const cleanQuery = String(query ?? '').trim();
    if (cleanQuery === '' || this.config.endpointUrl === '') {
      return [];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(this.config.endpointUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ query: cleanQuery, limit: Math.max(1, Math.min(limit, 20)) }),
      });
      if (!response.ok) {
        return [];
      }
      const body = (await response.json()) as { articles?: PhpKbArticleRow[] } | PhpKbArticleRow[] | null;
      const rows = Array.isArray(body) ? body : Array.isArray(body?.articles) ? body!.articles : [];
      return rows
        .filter((r): r is PhpKbArticleRow => r !== null && typeof r === 'object')
        .map((r) => this.toHit(r))
        .filter((h): h is KbSearchHit => h !== null);
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private toHit(row: PhpKbArticleRow): KbSearchHit | null {
    const id = Number(row.id);
    const title = String(row.title ?? '').trim();
    if (!Number.isInteger(id) || id <= 0 || title === '') {
      return null;
    }
    return {
      // Native GLPI KB articles carry a knowbaseitem id; not internal candidates.
      kbCandidateId: null,
      glpiKnowbaseitemId: id,
      title: title.slice(0, 200),
      category: String(row.category ?? '').slice(0, 120),
      excerpt: String(row.snippet ?? row.excerpt ?? '').slice(0, 500),
      score: clamp01(row.score),
    };
  }
}
