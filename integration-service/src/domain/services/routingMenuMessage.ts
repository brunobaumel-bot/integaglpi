import type { ActiveRoutingOption } from '../../repositories/contracts/RoutingRepository.js';

/**
 * Monta o texto do menu de roteamento (1-based, ordem de `options`).
 */
const NUMERIC_MENU_HEADING = 'Escolha uma opção tocando no botão ou digitando o número:';

export function normalizeMenuHeading(heading = NUMERIC_MENU_HEADING): string {
  const trimmedHeading = heading.trim();
  return trimmedHeading === 'Escolha uma opção:' ? NUMERIC_MENU_HEADING : trimmedHeading;
}

export function buildMenuMessage(options: ActiveRoutingOption[], heading = NUMERIC_MENU_HEADING): string {
  const lines = options.map((opt, index) => `${index + 1} - ${opt.label}`);
  const normalizedHeading = normalizeMenuHeading(heading);
  return [normalizedHeading, '', ...lines].join('\n');
}

export function parseMenuDigitChoice(messageText: string | null | undefined, optionCount: number): number | null {
  if (optionCount <= 0) {
    return null;
  }

  const raw = messageText?.trim();
  if (!raw) {
    return null;
  }

  const match = /^([1-9])(?:\s*[.)-])?(?:\s+.*)?$/.exec(raw);
  if (!match) {
    return null;
  }

  const n = Number.parseInt(match[1], 10);
  if (!Number.isFinite(n) || n < 1 || n > optionCount) {
    return null;
  }

  return n;
}
