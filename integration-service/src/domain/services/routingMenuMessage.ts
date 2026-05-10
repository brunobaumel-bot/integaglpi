import type { ActiveRoutingOption } from '../../repositories/contracts/RoutingRepository.js';

/**
 * Monta o texto do menu de roteamento (1-based, ordem de `options`).
 */
export function buildMenuMessage(options: ActiveRoutingOption[], heading = 'Escolha uma opção:'): string {
  const lines = options.map((opt, index) => `${index + 1} - ${opt.label}`);
  return [heading.trim(), '', ...lines].join('\n');
}

export function parseMenuDigitChoice(messageText: string | null | undefined, optionCount: number): number | null {
  if (optionCount <= 0) {
    return null;
  }

  const raw = messageText?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    return null;
  }

  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > optionCount) {
    return null;
  }

  return n;
}
