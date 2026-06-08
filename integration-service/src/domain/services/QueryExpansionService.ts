/**
 * QueryExpansionService — Deterministic + optional local-AI query expansion.
 *
 * Expands a technician's free-text query into a richer set of search terms
 * before the KB FTS lookup, improving recall for synonym/abbreviation variants.
 *
 * Flow:
 *   1. PII guard is applied by the caller BEFORE passing the query here.
 *   2. Deterministic expansion: template variants (7 patterns per QUERY_EXPANSION spec).
 *   3. Extract key tokens (non-stopword, ≥3 chars, de-accented).
 *   4. Optional AI enrichment (Ollama, fail-safe): suggest synonyms — PII filtered.
 *   5. Return unique term list + combined FTS query string.
 *
 * Invariants:
 *   - AI enrichment is optional and fail-safe (never blocks the search).
 *   - AI enrichment NEVER uses cloud (only local Ollama port).
 *   - Only de-accented word-char tokens from AI response are accepted.
 *   - No PII reaches the AI prompt (caller's PII guard + output filter).
 *
 * Phase: integaglpi_local_kb_rag_model_query_expansion_adendum_001
 */

// Minimal interface for local Ollama text generation.
// Structural: satisfied by OllamaClient and any test double.
export interface OllamaTextPort {
  generateText(prompt: string, options?: { temperature?: number }): Promise<string>;
}

// ── Expansion templates (QUERY_EXPANSION spec) ────────────────────────────────

const EXPANSION_TEMPLATES: ReadonlyArray<(q: string) => string> = [
  (q) => q,
  (q) => `erro sistema ${q}`,
  (q) => `problema ${q}`,
  (q) => `falha acesso ${q}`,
  (q) => `${q} não abre`,
  (q) => `timeout conexão ${q}`,
  (q) => `bloqueio proxy firewall ${q}`,
];

// ── Portuguese stopwords ──────────────────────────────────────────────────────

const PT_STOPWORDS = new Set([
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'e', 'ou', 'mas', 'que',
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'por',
  'para', 'com', 'ao', 'aos', 'pelo', 'pela', 'pelos', 'pelas', 'se', 'não',
  'é', 'são', 'está', 'estão', 'foi', 'foram', 'ser', 'ter', 'ir', 'fazer',
  'quando', 'como', 'mais', 'muito', 'meu', 'seu', 'nosso', 'esse', 'este',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract non-stopword tokens from a string.
 * Returns lowercase, de-accented tokens of at least 3 chars.
 */
function extractKeyTerms(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')      // strip diacritics
    .replace(/[^\w\s]/g, ' ')   // strip punctuation
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !PT_STOPWORDS.has(t));
}

/**
 * Validate that a term from AI output is safe (no PII, only word chars).
 * Conservative: reject anything with digits that look like phone/CPF/IP.
 */
function isSafeAiTerm(term: string): boolean {
  if (term.length < 3 || term.length > 40) return false;
  // Only word chars + hyphens + spaces (Portuguese letters allowed)
  if (!/^[a-záéíóúâêîôûàèìòùãõçñ\w\s-]+$/i.test(term)) return false;
  // Reject if contains 4+ consecutive digits (phone/IP/CPF)
  if (/\d{4,}/.test(term)) return false;
  return true;
}

// ── Domain types ──────────────────────────────────────────────────────────────

export interface QueryExpansionResult {
  /** All unique expanded terms (for UI display). */
  terms: string[];
  /** Combined query string optimised for PostgreSQL plainto_tsquery. */
  ftsQuery: string;
  /** True if local AI enriched the terms (never cloud). */
  aiEnriched: boolean;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class QueryExpansionService {
  /**
   * @param ollamaPort  Optional local Ollama text port.
   *                    Pass null to use deterministic expansion only.
   *                    Cloud AI is structurally absent — only OllamaTextPort accepted.
   */
  public constructor(private readonly ollamaPort: OllamaTextPort | null = null) {}

  /**
   * Expand a pre-PII-guarded query into search terms.
   *
   * @param query  Already PII-guarded query string (caller must apply piiGuard first).
   */
  public async expand(query: string): Promise<QueryExpansionResult> {
    const clean = String(query ?? '').trim().slice(0, 400);
    if (clean === '') {
      return { terms: [], ftsQuery: '', aiEnriched: false };
    }

    // 1. Deterministic expansion
    const deterministicTerms = new Set<string>(extractKeyTerms(clean));
    for (const template of EXPANSION_TEMPLATES) {
      for (const t of extractKeyTerms(template(clean))) {
        deterministicTerms.add(t);
      }
    }

    let allTerms = [...deterministicTerms];
    let aiEnriched = false;

    // 2. Optional AI enrichment (fail-safe, no cloud)
    if (this.ollamaPort !== null && allTerms.length > 0) {
      try {
        const aiTerms = await this.aiEnrichTerms(allTerms.slice(0, 6));
        const before = allTerms.length;
        for (const t of aiTerms) {
          if (!allTerms.includes(t)) {
            allTerms.push(t);
          }
        }
        aiEnriched = allTerms.length > before;
      } catch {
        // AI enrichment failed — deterministic only (expected behavior)
      }
    }

    // Limit terms and build FTS string
    allTerms = [...new Set(allTerms)].slice(0, 15);

    // FTS query: original query + unique key terms not already in query
    const queryLower = clean.toLowerCase();
    const extraTerms = allTerms.filter((t) => !queryLower.includes(t));
    const ftsQuery = [clean, ...extraTerms].join(' ').trim().slice(0, 500);

    return { terms: allTerms, ftsQuery, aiEnriched };
  }

  private async aiEnrichTerms(keyTerms: string[]): Promise<string[]> {
    // keyTerms are already de-accented lowercase word-char tokens (no PII)
    const prompt = [
      `Problema técnico: "${keyTerms.join(', ')}"`,
      'Sugira até 5 termos técnicos alternativos ou sinônimos para busca em base de conhecimento de suporte de TI.',
      'Responda APENAS com JSON: {"termos": ["termo1", "termo2"]}',
      'Não inclua: nomes próprios, IPs, telefones, e-mails, usuários, senhas ou credenciais.',
    ].join('\n');

    // Low temperature for focused synonyms
    const raw = await this.ollamaPort!.generateText(prompt, { temperature: 0.3 });
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) {
      return [];
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return [];
    }

    const termos = parsed['termos'];
    if (!Array.isArray(termos)) {
      return [];
    }

    return termos
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.toLowerCase().trim())
      .filter(isSafeAiTerm)
      .flatMap(extractKeyTerms)         // tokenise each AI term
      .filter((t) => t.length >= 3)
      .slice(0, 8);
  }
}
