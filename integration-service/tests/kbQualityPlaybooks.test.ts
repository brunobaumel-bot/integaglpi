import { describe, expect, it } from 'vitest';

import { enrichAgentCandidate } from '../src/domain/services/AgentKbEnricher.js';
import { detectKbScenario } from '../src/domain/services/KbQualityPlaybooks.js';

describe('KbQualityPlaybooks — conteúdo acionável', () => {
  it('VPN detecta cenário e gera passos numerados reais', () => {
    const raw = {
      id: 125,
      title: 'Procedimento sugerido: Servidor > Windows > VPN',
      category: 'Servidor > Windows > VPN',
      evidence: 'nao estou conseguindo conectar minha vpn | Estou sem VPN, caiu e nao volta',
      symptoms: ['Categoria associada: VPN'],
      probable_cause: 'revisar evidencias anonimizadas antes de publicar',
      procedure: ['Confirmar o cenario com o usuario'],
      checklist: [],
      tags: ['vpn'],
    };
    expect(detectKbScenario(raw)).toBe('vpn_connect_fail');
    const patch = enrichAgentCandidate(raw);
    expect(patch.resolution_steps?.[0]).toMatch(/^1\./);
    expect(patch.resolution_steps?.join(' ')).toMatch(/VPN|credencial|perfil/i);
    expect(patch.likely_causes?.join(' ')).not.toMatch(/revisar evidencias/i);
    expect(patch.triage_questions?.length).toBeGreaterThan(2);
  });

  it('Office ativação inclui reparo online e conta M365', () => {
    const patch = enrichAgentCandidate({
      id: 5,
      title: 'Procedimento sugerido: Office',
      category: 'Office',
      evidence: 'Office nao ativa | reparo online e ativacao concluida',
      symptoms: [],
      probable_cause: 'Nao identificado',
      procedure: [],
      checklist: [],
      tags: ['office'],
    });
    expect(patch.resolution_steps?.join(' ')).toMatch(/Reparo|Conta|M365|licen/i);
    expect(patch.commands_or_checks?.join(' ')).toMatch(/Arquivo > Conta/i);
  });

  it('senha VPN usa playbook de reset', () => {
    expect(
      detectKbScenario({
        id: 1,
        title: 'VPN senha',
        evidence: 'esqueci minha senha vpn',
        category: 'VPN',
      }),
    ).toBe('vpn_password');
  });
});
