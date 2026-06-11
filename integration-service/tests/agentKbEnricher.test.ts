import { describe, expect, it } from 'vitest';

import { enrichAgentCandidate } from '../src/domain/services/AgentKbEnricher.js';
import { INFO_UNAVAILABLE } from '../src/domain/services/KbEnrichmentService.js';

describe('AgentKbEnricher', () => {
  it('expande candidato genérico com evidências sanitizadas', () => {
    const patch = enrichAgentCandidate({
      id: 5,
      title: 'Procedimento sugerido: Office',
      category: 'Office',
      problem_pattern: 'Categoria recorrente em 2 chamados.',
      symptoms: ['Ocorrencia recorrente em 2 registro(s) historicos sanitizados.'],
      probable_cause: 'Licenciamento ou cache de ativação.',
      procedure: ['Confirmar o cenario com o usuario e registrar sintomas objetivos.'],
      checklist: ['Validar categoria, fila e impacto.'],
      tags: ['office', 'faq-interno'],
      evidence: 'Office nao ativa | Cliente informa que o Office nao esta ativando | Feito reparo online',
    });

    expect(patch.product_or_system).toContain('Office');
    expect(patch.resolution_steps?.some((s) => /Reparo|licen|M365/i.test(s))).toBe(true);
    expect(patch.triage_questions?.length).toBeGreaterThan(2);
    expect(patch.confidence_notes).toContain('#5');
  });

  it('playbook recebe incident_tree e rollback', () => {
    const patch = enrichAgentCandidate({
      id: 236,
      title: 'Playbook N50 - Diagnostico e resolucao de incidentes criticos',
      category: 'Infraestrutura',
      problem_pattern: 'Playbook para indisponibilidade de serviços.',
      symptoms: ['Serviço completamente indisponível'],
      probable_cause: 'Configuração incorreta; Sobrecarga',
      procedure: ['Verificar logs', 'Reiniciar serviço'],
      checklist: ['Serviço restaurado'],
      tags: ['playbook'],
      evidence: '',
    });

    expect(patch.incident_tree?.length).toBeGreaterThan(1);
    expect(patch.rollback_or_safe_exit?.length).toBeGreaterThan(1);
    expect(patch.escalation_when?.length).toBeGreaterThan(0);
  });

  it('não retorna arrays vazios nos campos obrigatórios', () => {
    const patch = enrichAgentCandidate({
      id: 1,
      title: 'Teste',
      category: '',
      symptoms: [],
      procedure: [],
      checklist: [],
      tags: [],
      evidence: '',
    });
    expect(patch.symptoms?.[0]).not.toBe('');
    expect(patch.likely_causes?.[0]).not.toBe('');
  });
});
