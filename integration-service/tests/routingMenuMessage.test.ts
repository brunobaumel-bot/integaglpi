import { describe, expect, it } from 'vitest';

import type { ActiveRoutingOption } from '../src/repositories/contracts/RoutingRepository.js';
import { buildMenuMessage, parseMenuDigitChoice } from '../src/domain/services/routingMenuMessage.js';

const opts: ActiveRoutingOption[] = [
  {
    id: 1,
    label: 'Suporte',
    optionKey: 'a',
    queueId: 1,
    glpiGroupId: null,
    glpiUserId: null,
    confirmationMessage: null,
    sortOrder: 0,
  },
  {
    id: 2,
    label: 'Financeiro',
    optionKey: 'b',
    queueId: 2,
    glpiGroupId: null,
    glpiUserId: null,
    confirmationMessage: null,
    sortOrder: 1,
  },
];

describe('routingMenuMessage', () => {
  it('buildMenuMessage formats numbered labels', () => {
    expect(buildMenuMessage(opts)).toBe('Escolha uma opção tocando no botão ou digitando o número:\n\n1 - Suporte\n2 - Financeiro');
    expect(buildMenuMessage(opts, 'Escolha uma opção:')).toBe('Escolha uma opção tocando no botão ou digitando o número:\n\n1 - Suporte\n2 - Financeiro');
    expect(buildMenuMessage(opts, 'Atendimento')).toBe('Atendimento\n\n1 - Suporte\n2 - Financeiro');
  });

  it('buildMenuMessage makes the production queue numeric choices explicit', () => {
    const queueOptions = [
      { ...opts[0], label: 'Suporte Técnico' },
      { ...opts[1], label: 'Administrativo' },
      { ...opts[1], id: 3, optionKey: 'c', label: 'Comercial', sortOrder: 2 },
    ];

    expect(buildMenuMessage(queueOptions)).toBe([
      'Escolha uma opção tocando no botão ou digitando o número:',
      '',
      '1 - Suporte Técnico',
      '2 - Administrativo',
      '3 - Comercial',
    ].join('\n'));
  });

  it('parseMenuDigitChoice accepts valid indices', () => {
    expect(parseMenuDigitChoice('1', 2)).toBe(1);
    expect(parseMenuDigitChoice(' 2 ', 2)).toBe(2);
    expect(parseMenuDigitChoice('1.', 2)).toBe(1);
    expect(parseMenuDigitChoice('2 - Financeiro', 2)).toBe(2);
    expect(parseMenuDigitChoice('1 sim', 2)).toBe(1);
  });

  it('parseMenuDigitChoice rejects out of range and non-digits', () => {
    expect(parseMenuDigitChoice('0', 2)).toBeNull();
    expect(parseMenuDigitChoice('3', 2)).toBeNull();
    expect(parseMenuDigitChoice('12', 2)).toBeNull();
    expect(parseMenuDigitChoice('1texto', 2)).toBeNull();
    expect(parseMenuDigitChoice('x', 2)).toBeNull();
    expect(parseMenuDigitChoice('', 2)).toBeNull();
    expect(parseMenuDigitChoice(null, 2)).toBeNull();
    expect(parseMenuDigitChoice(undefined, 2)).toBeNull();
  });
});
