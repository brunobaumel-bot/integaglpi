/**
 * Testes estáticos e de unidade — integaglpi_asset_context_summary_001
 *
 * Auditam as invariantes de segurança e design sem bater em GLPI real ou Ollama real:
 *  1. Feature flag off  → retorna 'disabled' imediatamente (sem rede)
 *  2. Ativo não encontrado → retorna 'no_computer_found' (sem nota criada)
 *  3. Falha do GLPI → degradação graciosa, sem lançar exceção
 *  4. Sem ticketId → gera resumo mas não injeta nota (generated_not_injected)
 *  5. Caminho feliz → resumo determinístico + nota interna injetada
 *  6. PII guard: serial ausente do contexto
 *  7. PII guard: MAC ausente do contexto (interface GlpiComputerContext)
 *  8. AI local: fallback determinístico quando IA retorna string vazia
 *  9. AI local: fallback determinístico quando IA retorna texto > 600 chars
 * 10. Wiring: AssetContextSummaryService importável sem erro
 * 11. InboundWebhookService aceita assetContextSummaryService como param opcional
 * 12. GlpiComputerContext não expõe campos proibidos (serial, mac, ip, users)
 *
 * PHASE: integaglpi_asset_context_summary_001
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ── helpers de mock ───────────────────────────────────────────────────────────

/** Mock mínimo de GlpiClient para testes de unidade */
function makeGlpiClient(overrides: Record<string, unknown> = {}) {
  return {
    findComputersByOtherserial: vi.fn().mockResolvedValue([]),
    fetchComputerContext: vi.fn().mockResolvedValue({
      computerId: 42,
      hostname: 'PC-TESTE',
      entityId: 7,
      entityName: 'Unidade Teste',
      manufacturer: 'Dell',
      model: 'OptiPlex 3080',
    }),
    addInternalNote: vi.fn().mockResolvedValue(999),
    ...overrides,
  } as unknown as import('../src/adapters/glpi/GlpiClient.js').GlpiClient;
}

/** Mock de LocalAiSummarizer */
function makeLocalAi(text: string | null): import('../src/domain/services/AssetContextSummaryService.js').LocalAiSummarizer {
  return { summarize: vi.fn().mockResolvedValue(text) };
}

// ── utilidade: forçar env ─────────────────────────────────────────────────────
// O env é singleton; manipulamos a property para each teste sem re-importar módulo.
async function withFlag(flag: boolean, fn: () => Promise<void>): Promise<void> {
  const { env } = await import('../src/config/env.js');
  const original = (env as Record<string, unknown>)['ASSET_CONTEXT_SUMMARY_ENABLED'];
  (env as Record<string, unknown>)['ASSET_CONTEXT_SUMMARY_ENABLED'] = flag;
  try {
    await fn();
  } finally {
    (env as Record<string, unknown>)['ASSET_CONTEXT_SUMMARY_ENABLED'] = original;
  }
}

// ── testes ────────────────────────────────────────────────────────────────────

describe('AssetContextSummaryService — invariantes de segurança e design', () => {

  it('1. feature flag off → status=disabled sem consultar GLPI', async () => {
    const { AssetContextSummaryService } = await import('../src/domain/services/AssetContextSummaryService.js');
    const client = makeGlpiClient();
    const svc = new AssetContextSummaryService(client);

    await withFlag(false, async () => {
      const result = await svc.generate({
        equipmentTag: 'ABC123',
        entityId: 1,
        conversationId: 'conv-001',
        ticketId: 100,
      });

      expect(result.status).toBe('disabled');
      expect(result.summaryText).toBeNull();
      expect(result.noteId).toBeNull();
      expect(client.findComputersByOtherserial).not.toHaveBeenCalled();
      expect(client.fetchComputerContext).not.toHaveBeenCalled();
      expect(client.addInternalNote).not.toHaveBeenCalled();
    });
  });

  it('2. ativo não encontrado → status=no_computer_found, sem nota', async () => {
    const { AssetContextSummaryService } = await import('../src/domain/services/AssetContextSummaryService.js');
    const client = makeGlpiClient({
      findComputersByOtherserial: vi.fn().mockResolvedValue([]),
    });
    const svc = new AssetContextSummaryService(client);

    await withFlag(true, async () => {
      const result = await svc.generate({
        equipmentTag: 'TAG-NAO-EXISTE',
        entityId: 1,
        conversationId: 'conv-002',
        ticketId: 100,
      });

      expect(result.status).toBe('no_computer_found');
      expect(result.computerId).toBeNull();
      expect(result.noteId).toBeNull();
      expect(result.summaryText).toBeNull();
      expect(client.addInternalNote).not.toHaveBeenCalled();
    });
  });

  it('3. falha do GLPI → degradação graciosa, nunca lança exceção', async () => {
    const { AssetContextSummaryService } = await import('../src/domain/services/AssetContextSummaryService.js');
    const client = makeGlpiClient({
      findComputersByOtherserial: vi.fn().mockRejectedValue(new Error('GLPI timeout')),
    });
    const svc = new AssetContextSummaryService(client);

    await withFlag(true, async () => {
      // Não deve lançar exceção
      await expect(svc.generate({
        equipmentTag: 'TAG001',
        entityId: 1,
        conversationId: 'conv-003',
        ticketId: 100,
      })).resolves.not.toThrow();

      const result = await svc.generate({
        equipmentTag: 'TAG001',
        entityId: 1,
        conversationId: 'conv-003',
        ticketId: 100,
      });
      // GLPI falhou → sem ativo encontrado ou erro capturado
      expect(['no_computer_found', 'error']).toContain(result.status);
    });
  });

  it('4. ticketId null → gera resumo mas NÃO injeta nota (generated_not_injected)', async () => {
    const { AssetContextSummaryService } = await import('../src/domain/services/AssetContextSummaryService.js');
    const client = makeGlpiClient({
      findComputersByOtherserial: vi.fn().mockResolvedValue([{ id: 42, name: 'PC-TEST', serial: null, otherserial: 'TAG123', entitiesId: 7 }]),
    });
    const svc = new AssetContextSummaryService(client);

    await withFlag(true, async () => {
      const result = await svc.generate({
        equipmentTag: 'TAG123',
        entityId: 7,
        conversationId: 'conv-004',
        ticketId: null, // sem ticketId
      });

      expect(result.status).toBe('generated_not_injected');
      expect(result.summaryText).not.toBeNull();
      expect(result.noteId).toBeNull();
      expect(client.addInternalNote).not.toHaveBeenCalled();
    });
  });

  it('5. caminho feliz → resumo gerado + nota interna injetada (generated_and_injected)', async () => {
    const { AssetContextSummaryService } = await import('../src/domain/services/AssetContextSummaryService.js');
    const client = makeGlpiClient({
      findComputersByOtherserial: vi.fn().mockResolvedValue([{ id: 42, name: 'PC-FULL', serial: null, otherserial: 'AB9999', entitiesId: 7 }]),
    });
    const svc = new AssetContextSummaryService(client);

    await withFlag(true, async () => {
      const result = await svc.generate({
        equipmentTag: 'AB9999',
        entityId: 7,
        conversationId: 'conv-005',
        ticketId: 55,
      });

      expect(result.status).toBe('generated_and_injected');
      expect(result.computerId).toBe(42);
      expect(result.summaryText).toContain('AB9999');          // patrimônio no resumo
      expect(result.summaryText).toContain('PC-TESTE');        // hostname
      expect(result.noteId).toBe(999);
      expect(result.aiUsed).toBe(false);                       // sem IA local neste teste
      expect(client.addInternalNote).toHaveBeenCalledWith(55, expect.any(String));
      // A nota deve ser is_private — garantido pelo GlpiClient; aqui verificamos chamada
    });
  });

  it('6. PII guard: GlpiComputerContext não tem campo serial', async () => {
    // Verifica no tipo TypeScript via inspecção do arquivo de tipos
    const typesPath = path.resolve(__dirname, '../src/adapters/glpi/glpiTypes.ts');
    const source = readFileSync(typesPath, 'utf-8');

    // Isola apenas o bloco GlpiComputerContext
    const match = /export interface GlpiComputerContext \{([^}]+)\}/.exec(source);
    expect(match).not.toBeNull();
    const fields = match![1];

    // serial NÃO deve aparecer no bloco GlpiComputerContext
    expect(fields).not.toMatch(/\bserial\b/);
  });

  it('7. PII guard: GlpiComputerContext não tem campos mac, ip ou users', async () => {
    const typesPath = path.resolve(__dirname, '../src/adapters/glpi/glpiTypes.ts');
    const source = readFileSync(typesPath, 'utf-8');

    const match = /export interface GlpiComputerContext \{([^}]+)\}/.exec(source);
    expect(match).not.toBeNull();
    const fields = match![1];

    expect(fields).not.toMatch(/\bmac\b/i);
    expect(fields).not.toMatch(/\bip\b/i);
    expect(fields).not.toMatch(/\busers?\b/i);
  });

  it('8. AI local: fallback determinístico quando IA retorna string vazia', async () => {
    const { AssetContextSummaryService } = await import('../src/domain/services/AssetContextSummaryService.js');
    const client = makeGlpiClient({
      findComputersByOtherserial: vi.fn().mockResolvedValue([{ id: 77, name: 'PC-AI', serial: null, otherserial: 'X1', entitiesId: 3 }]),
    });
    const ai = makeLocalAi(''); // IA retorna vazio
    const svc = new AssetContextSummaryService(client, ai);

    await withFlag(true, async () => {
      const result = await svc.generate({
        equipmentTag: 'X1',
        entityId: 3,
        conversationId: 'conv-008',
        ticketId: 200,
      });

      expect(result.aiUsed).toBe(false);                       // fallback determinístico
      expect(result.summaryText).toContain('[Contexto do equipamento');
    });
  });

  it('9. AI local: fallback determinístico quando IA retorna texto > 600 chars', async () => {
    const { AssetContextSummaryService } = await import('../src/domain/services/AssetContextSummaryService.js');
    const client = makeGlpiClient({
      findComputersByOtherserial: vi.fn().mockResolvedValue([{ id: 88, name: 'PC-LONG', serial: null, otherserial: 'Y2', entitiesId: 3 }]),
    });
    const ai = makeLocalAi('A'.repeat(601)); // texto muito longo
    const svc = new AssetContextSummaryService(client, ai);

    await withFlag(true, async () => {
      const result = await svc.generate({
        equipmentTag: 'Y2',
        entityId: 3,
        conversationId: 'conv-009',
        ticketId: 201,
      });

      expect(result.aiUsed).toBe(false);
      expect(result.summaryText).toContain('[Contexto do equipamento');
    });
  });

  it('10. wiring: AssetContextSummaryService é importável sem erro', async () => {
    const mod = await import('../src/domain/services/AssetContextSummaryService.js');
    expect(mod.AssetContextSummaryService).toBeDefined();
    expect(typeof mod.AssetContextSummaryService).toBe('function');
  });

  it('11. InboundWebhookService aceita assetContextSummaryService como parâmetro opcional', async () => {
    const iws = readFileSync(
      path.resolve(__dirname, '../src/domain/services/InboundWebhookService.ts'),
      'utf-8',
    );
    // Deve declarar o param como optional (null default)
    expect(iws).toMatch(/assetContextSummaryService.*AssetContextSummaryService.*null/);
    // Deve importar o tipo
    expect(iws).toMatch(/import.*AssetContextSummaryService/);
    // Deve conter a chamada triggerAssetContextSummary
    expect(iws).toMatch(/triggerAssetContextSummary/);
  });

  it('12. resumo determinístico inclui hostname, entidade e hardware — SEM serial/mac/ip', async () => {
    const { AssetContextSummaryService } = await import('../src/domain/services/AssetContextSummaryService.js');
    const client = makeGlpiClient({
      findComputersByOtherserial: vi.fn().mockResolvedValue([{ id: 99, name: 'PC-FULL', serial: null, otherserial: 'T99', entitiesId: 5 }]),
      fetchComputerContext: vi.fn().mockResolvedValue({
        computerId: 99,
        hostname: 'MAQUINA-XYZ',
        entityId: 5,
        entityName: 'Filial Norte',
        manufacturer: 'Lenovo',
        model: 'ThinkCentre M70q',
      }),
    });
    const svc = new AssetContextSummaryService(client);

    await withFlag(true, async () => {
      const result = await svc.generate({
        equipmentTag: 'T99',
        entityId: 5,
        conversationId: 'conv-012',
        ticketId: 300,
      });

      const text = result.summaryText ?? '';
      // Campos esperados
      expect(text).toContain('T99');               // patrimônio
      expect(text).toContain('MAQUINA-XYZ');       // hostname
      expect(text).toContain('Filial Norte');       // entidade
      expect(text).toContain('Lenovo');             // fabricante
      expect(text).toContain('ThinkCentre');        // modelo

      // Campos proibidos (PII)
      expect(text).not.toMatch(/\bserial\b/i);
      expect(text).not.toMatch(/\bmac\b/i);
      expect(text).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/); // IP
    });
  });

});
