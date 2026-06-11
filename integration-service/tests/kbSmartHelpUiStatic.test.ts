/**
 * Smart Help UI — Static rendering tests (V9)
 *
 * Phase: integaglpi_v9_kb_ui_rendering_and_ranking_wiring_001
 *
 * Garante que os campos V9 gerados pelo backend são RENDERIZADOS na UI do
 * técnico (gap apontado pela auditoria: backend completo, UI ausente):
 *   - ticket_ai_panel.js: customResponse, problemProfiles, kbCoverage, ragPerProblem
 *   - kb_smart_help_widget.php: customResponse no fluxo KB RAG
 *
 * Invariantes verificadas estaticamente:
 *   - KB original/KBs usadas permanecem visíveis (a sugestão complementa, nunca substitui).
 *   - Badge "Revise antes de aplicar" presente no bloco customResponse.
 *   - Todo conteúdo passa pelo escaper (esc/escH) — sem innerHTML de texto cru do backend.
 *   - Nenhum envio automático: sem fetch para endpoint de WhatsApp/ticket nos blocos novos.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string): Promise<string> => readFile(resolve(repoRoot, p), 'utf8');

describe('ticket_ai_panel.js — renderização dos campos V9', () => {
  it('renderV9Insights existe e é chamado em renderResult', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    expect(js).toContain('function renderV9Insights(panel, result)');
    expect(js).toContain('renderV9Insights(panel, result);');
  });

  it('customResponse: bloco "Sugestão IA contextualizada" + badge "Revise antes de aplicar"', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    expect(js).toContain('js-smart-help-custom-response');
    expect(js).toContain('Sugestão IA contextualizada');
    expect(js).toContain('Revise antes de aplicar');
    expect(js).toContain('cr.gate_message');
  });

  it('customResponse: kb_sources sempre visíveis — complementa, nunca substitui', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    expect(js).toContain('cr.kb_sources');
    expect(js).toContain('KBs fonte (sempre visíveis — a sugestão complementa, nunca substitui)');
  });

  it('problemProfiles: seção por problema com sistema/sintomas/evidências/dados faltantes/busca', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    expect(js).toContain('js-smart-help-problem-profiles');
    expect(js).toContain('p.sistema_afetado');
    expect(js).toContain('p.sintomas');
    expect(js).toContain('p.evidencias');
    expect(js).toContain('p.dados_faltantes');
    expect(js).toContain('p.query_para_busca');
  });

  it('kbCoverage: badges KB_FOUND (success) e KB_INSUFFICIENT (warning) por problema', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    expect(js).toContain('js-smart-help-kb-coverage');
    expect(js).toContain('KB_FOUND');
    expect(js).toContain('KB_INSUFFICIENT');
    expect(js).toMatch(/badge bg-success">KB_FOUND/);
    expect(js).toMatch(/badge bg-warning text-dark">KB_INSUFFICIENT/);
  });

  it('ragPerProblem: seção renderizada com 2+ problemas', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    expect(js).toContain('js-smart-help-rag-per-problem');
    expect(js).toContain('Resultado RAG por problema');
    expect(js).toContain('r.localResolved');
  });

  it('R4: ragPerProblem com 1 entrada renderiza bloco compacto "Detalhe RAG do problema"', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    expect(js).toContain('ragPer.length === 1');
    expect(js).toContain('js-smart-help-rag-single');
    expect(js).toContain('Detalhe RAG do problema');
  });

  it('view model persiste os campos V9 com cap/sanitize (restauração do painel)', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    expect(js).toContain('safeCustomResponseForStorage');
    expect(js).toContain('safeProblemProfilesForStorage');
    expect(js).toContain('safeKbCoverageForStorage');
    expect(js).toContain('safeRagPerProblemForStorage');
  });

  it('KB original continua visível: render legado de artigos e KBs usadas intacto', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    // Seções legadas preservadas (o V9 é aditivo).
    expect(js).toContain('js-smart-help-articles');
    expect(js).toContain("esc('KBs usadas')");
    expect(js).toContain('renderLocalPlaybook(panel, result)');
  });

  it('conteúdo dos blocos V9 passa por esc() — nunca innerHTML cru do backend', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    const v9Block = js.slice(js.indexOf('function renderV9Insights'), js.indexOf('function addPrivateNote'));
    expect(v9Block.length).toBeGreaterThan(100);
    // Campos de texto do backend sempre dentro de esc(...)
    expect(v9Block).toContain('esc(');
    // Nenhuma interpolação direta de campo do backend fora de esc(): heurística —
    // os campos de texto conhecidos aparecem apenas precedidos por esc()/viewText.
    expect(v9Block).not.toMatch(/innerHTML\s*=\s*result\./);
    expect(v9Block).not.toMatch(/\+\s*cr\.gate_message\s*\+/);
  });

  it('blocos V9 não disparam envio automático (sem fetch/WhatsApp/ticket)', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    const v9Block = js.slice(js.indexOf('function renderV9Insights'), js.indexOf('function addPrivateNote'));
    expect(v9Block).not.toContain('fetch(');
    expect(v9Block).not.toMatch(/whatsapp/i);
    expect(v9Block).not.toMatch(/createTicket|create_ticket/);
  });
});

describe('kb_smart_help_widget.php — customResponse no fluxo KB RAG', () => {
  it('renderiza data.customResponse com badge e aviso de complementaridade', async () => {
    const widget = await read('integaglpi/templates/kb_smart_help_widget.php');
    expect(widget).toContain('data.customResponse');
    expect(widget).toContain('js-rag-custom-response');
    expect(widget).toContain('Sugestão IA contextualizada');
    expect(widget).toContain('Revise antes de aplicar');
    expect(widget).toContain('Complementa o KB original — nunca o substitui.');
  });

  it('kb_sources do customResponse sempre listadas', async () => {
    const widget = await read('integaglpi/templates/kb_smart_help_widget.php');
    expect(widget).toContain('cr.kb_sources');
    expect(widget).toContain('KBs fonte (sempre visíveis)');
  });

  it('KB original continua visível: render legado de playbook e KBs intacto', async () => {
    const widget = await read('integaglpi/templates/kb_smart_help_widget.php');
    expect(widget).toContain('data.kbsUsed');
    expect(widget).toContain('KBs Recuperadas — Ranking');
    expect(widget).toContain('KBs utilizadas:');
  });

  it('conteúdo do customResponse passa por escH() — sem HTML cru', async () => {
    const widget = await read('integaglpi/templates/kb_smart_help_widget.php');
    const start = widget.indexOf('js-rag-custom-response');
    const end = widget.indexOf('Build plain text for copy');
    const block = widget.slice(start, end);
    expect(block.length).toBeGreaterThan(100);
    expect(block).toContain('escH(');
    expect(block).not.toMatch(/\+\s*cr\.gate_message\s*\+/);
  });

  it('R3: customResponse é bloco IRMÃO do rag-card principal (não aninhado)', async () => {
    const widget = await read('integaglpi/templates/kb_smart_help_widget.php');
    const closeRagCard = widget.indexOf("// close rag-card");
    const customBlock = widget.indexOf('js-rag-custom-response');
    expect(closeRagCard).toBeGreaterThan(-1);
    expect(customBlock).toBeGreaterThan(-1);
    // O bloco customResponse só pode começar APÓS o fechamento do rag-card principal.
    expect(customBlock).toBeGreaterThan(closeRagCard);
  });
});
