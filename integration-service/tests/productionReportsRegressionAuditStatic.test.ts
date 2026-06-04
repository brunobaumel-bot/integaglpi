import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('production reports regression audit documentation', () => {
  it('documents the complete T01-T23 matrix with safety gates', () => {
    const doc = read('docs/production_reports_regression_audit.md');

    for (let i = 1; i <= 23; i += 1) {
      const id = `T${String(i).padStart(2, '0')}`;
      expect(doc).toContain(`test_id: ${id}`);
    }

    for (const required of [
      'PASS/FAIL/INCONCLUSIVE/NOT_APPLICABLE',
      'Stop Conditions Globais',
      'Produção',
      'HOMOLOGAÇÃO',
      'Não corrigir durante a auditoria',
      'Não executar `DELETE`, `TRUNCATE`, `DROP`',
      'Não enviar mensagem para cliente real',
      'Não alterar ticket real',
      'T20 — Locks Redis / dead-letter / filas presas',
      'T21 — Sessão expirada / CSRF após aba aberta por tempo prolongado',
      'T22 — SmartHelp guiado: resumo, busca local, cloud-safe, PII Guard',
      'T23 — Menus/drilldowns: Monitoramento, Supervisão, Auditoria/Eventos, SLA/Inatividade',
    ]) {
      expect(doc).toContain(required);
    }
  });

  it('adds a summarized smoke section and roadmap note', () => {
    const smoke = read('docs/smoke_tests.md');
    const roadmap = read('docs/roadmap_v7_status.md');

    expect(smoke).toContain('V8 — Auditoria regressiva dos relatos de produção');
    expect(smoke).toContain('Referência detalhada: `docs/production_reports_regression_audit.md`');
    for (let i = 1; i <= 23; i += 1) {
      const id = `T${String(i).padStart(2, '0')}`;
      expect(smoke).toContain(`| ${id} |`);
    }

    expect(roadmap).toContain('Auditoria regressiva dos relatos de produção');
    expect(roadmap).toContain('sem correção nesta fase');
  });
});
