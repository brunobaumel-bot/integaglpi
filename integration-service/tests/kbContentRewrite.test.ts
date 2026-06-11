import { describe, expect, it } from 'vitest';

import { assessKbEffectiveness } from '../src/domain/services/KbEffectivenessAuditor.js';
import { buildKbContentRewrite } from '../src/domain/services/KbContentRewriteService.js';

describe('KbContentRewriteService — F3 16 seções', () => {
  it('classifica KB genérico como INSUFICIENTE', () => {
    const a = assessKbEffectiveness({
      id: 99,
      title: 'Office',
      procedure: ['Confirmar o cenario com o usuario', 'Validar a solucao com supervisor'],
      probable_cause: 'revisar evidencias anonimizadas',
      symptoms: ['Categoria associada: Office'],
    });
    expect(a.status).toBe('INSUFICIENTE');
  });

  it('gera markdown com 16 seções para VPN', () => {
    const { markdown, draft, scenario } = buildKbContentRewrite({
      id: 125,
      title: 'VPN conectar',
      category: 'Servidor > Windows > VPN',
      evidence: 'nao consigo conectar minha vpn',
      procedure: [
        '1. Coletar print do erro',
        '2. Testar rede alternativa',
      ],
      probable_cause: 'Credencial expirada',
      symptoms: ['VPN nao conecta'],
      checklist: ['VPN conecta'],
      tags: ['vpn'],
    });
    expect(scenario).toBe('vpn_connect_fail');
    expect(markdown).toContain('## 1. Resumo executivo');
    expect(markdown).toContain('## 16. Metadados para IA e busca');
    expect(markdown).toContain('Quando NÃO usar');
    expect(markdown).not.toContain('seguir procedimento consultivo no ambiente do cliente');
    expect(draft.must_terms).toContain('vpn');
    expect(draft.human_review_required).toBe(true);
  });
});
