import { describe, expect, it, vi } from 'vitest';

import { HttpKbSearchPort } from '../src/infra/http/HttpKbSearchPort.js';

const cfg = { endpointUrl: 'https://glpi.host/plugins/integaglpi/front/kb.search.php', apiKey: 'k', timeoutMs: 100 };

describe('HttpKbSearchPort (Node → PHP native KB search)', () => {
  it('POSTs the query with a bearer token and maps PHP article rows to hits', async () => {
    let sentBody = '';
    let sentAuth = '';
    const fetchMock = vi.fn(async (_url: unknown, opts: unknown) => {
      const o = opts as { body: string; headers: Record<string, string> };
      sentBody = o.body;
      sentAuth = o.headers.Authorization;
      return {
        ok: true,
        json: async () => ({
          articles: [
            { id: 42, title: 'Ativar Office', category: 'Office', snippet: 'passos...', url: '/front/knowbaseitem.form.php?id=42', score: 0.9 },
            { id: 0, title: 'inválido' }, // dropped (id<=0)
            { id: 7, title: '' },         // dropped (empty title)
          ],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const port = new HttpKbSearchPort(cfg);
    const hits = await port.searchNativeKb('office nao ativa', 5);

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ glpiKnowbaseitemId: 42, title: 'Ativar Office', category: 'Office', score: 0.9 });
    expect(hits[0].kbCandidateId).toBeNull();
    expect(sentAuth).toBe('Bearer k');
    expect(JSON.parse(sentBody)).toMatchObject({ query: 'office nao ativa', limit: 5 });

    vi.unstubAllGlobals();
  });

  it('defaults a missing relevance score to 0.5 (neutral)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ articles: [{ id: 1, title: 'X' }] }) })));
    const hits = await new HttpKbSearchPort(cfg).searchNativeKb('q', 3);
    expect(hits[0].score).toBe(0.5);
    vi.unstubAllGlobals();
  });

  it('returns [] on non-OK response (graceful degradation)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const hits = await new HttpKbSearchPort(cfg).searchNativeKb('q', 3);
    expect(hits).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('returns [] on fetch throw/timeout (never breaks SmartHelp)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    const hits = await new HttpKbSearchPort(cfg).searchNativeKb('q', 3);
    expect(hits).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('returns [] without calling fetch on empty query', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const hits = await new HttpKbSearchPort(cfg).searchNativeKb('   ', 3);
    expect(hits).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
