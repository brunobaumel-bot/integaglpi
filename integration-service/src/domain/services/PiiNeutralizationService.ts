const COMPANY_PHRASES: RegExp[] = [
  /\b(?:representante|cliente|solicitante|contato)\s+d[aeo]\s+empresa\s+[^,.;:]+/giu,
  /\bd[aeo]\s+empresa\s+[^,.;:]+/giu,
  /\bcliente\s+d[aeo]\s+[^,.;:]+/giu,
  /\bempresa\s+informada\s*[:\-]?\s*[^,.;:]+/giu,
  /\bempresa\s+[A-ZÀ-Ý][\p{L}\p{N}.&\- ]{1,60}/gu,
  /\b[A-ZÀ-Ý][\p{L}\p{N}]+\s+inform[aá]tica\b/giu,
];

const NAME_PLACEHOLDERS: RegExp[] = [
  /\[[^\[\]]*nome[^\[\]]*\]/giu,
  /\[[^\[\]]*(?:empresa|telefone|email|e-mail)[^\[\]]*\]/giu,
  /\[[^\[\]]*removid[ao][^\[\]]*\]/giu,
];

const IDENTIFIED_SUBJECTS: RegExp[] = [
  /^\s*[OA]\s+(?:\[[^\]]+\]|[A-ZÀ-Ý][\p{L}'-]+(?:\s+[A-ZÀ-Ý][\p{L}'-]+){0,3})\s*,?\s*/u,
  /^\s*(?:O\s+)?cliente\s+d[aeo]\s+[^,.;:]+\s*/iu,
  /^\s*(?:O\s+)?cliente\s+(?:\[[^\]]+\]|[A-ZÀ-Ý][\p{L}'-]+(?:\s+[A-ZÀ-Ý][\p{L}'-]+){0,3})\s*,?\s*/u,
];

function preserveTechnicalTerms(text: string): string {
  return text
    .replace(/\bsync\s+d[eo]\s+ad\b/giu, 'sync do AD')
    .replace(/\bactive\s+directory\b/giu, 'Active Directory');
}

function cleanup(text: string): string {
  return preserveTechnicalTerms(text)
    .replace(/\s{2,}/gu, ' ')
    .replace(/\s+([,.;:])/gu, '$1')
    .replace(/([,;:])\1+/gu, '$1')
    .replace(/^\s*[,;:.]+\s*/u, '')
    .replace(/\(\s*\)/gu, '')
    .trim();
}

/**
 * Rewrites person/company-labelled SmartHelp prose into neutral technical text.
 * This is intentionally deterministic: it removes identity-bearing subjects and
 * company phrases, while preserving problem signals such as "sync do AD".
 */
export function neutralizeSmartHelpPiiText(input: string): string {
  let text = String(input ?? '');
  if (text.trim() === '') {
    return '';
  }

  text = text.replace(/\bNome\s+informado\s*[:\-]?\s*[^,.;]+[.,;:]?/giu, ' ');
  text = text.replace(/\b(?:ticket|chamado)\s*#?\s*\d{3,}\b/giu, 'chamado informado');
  text = text.replace(/\b(?:patrim[oô]nio|etiqueta|tombamento|asset(?:\s*tag)?|tag)\s*[:#]?\s*[A-Z0-9][A-Z0-9\-\/]{1,}\b/giu, 'patrimonio informado');
  for (const re of NAME_PLACEHOLDERS) {
    text = text.replace(re, ' ');
  }
  text = text
    .replace(/\b(?:nome|contato|solicitante|t[eé]cnico|tecnico)\s*:\s*:?\s*[A-ZÀ-Ý][\p{L}'-]+(?:\s+[A-ZÀ-Ý][\p{L}'-]+){0,3}[.,;:]?/giu, ' ')
    .replace(/^\s*O\s+(?:cliente|contato|solicitante)\s*:\s*/iu, 'Foi relatado ')
    .replace(/\b(?:cliente|contato|solicitante)\s*:\s*/giu, ' ');
  for (const re of COMPANY_PHRASES) {
    text = text.replace(re, 'em ambiente corporativo');
  }
  text = text.replace(
    /\b(?:resumo|relato|descri[cç][aã]o)\s*:\s*[A-ZÀ-Ý][\p{L}'-]+(?:\s+[A-ZÀ-Ý][\p{L}'-]+){1,3}\s+(?=em ambiente corporativo\b)/giu,
    'Resumo: ',
  );
  for (const re of IDENTIFIED_SUBJECTS) {
    text = text.replace(re, 'Foi relatado ');
  }

  text = text
    .replace(/\b(?:nome|cliente|contato|solicitante|t[eé]cnico|tecnico)\s*:\s*(?=[,.;:"'“”]|$)/giu, ' ')
    .replace(/\brealizou\s+um\s+teste\s+d[eo]\s+sistema\s+via\s+WhatsApp,?\s*/giu, '')
    .replace(/\brelatando\s+que\s+/giu, 'foi relatado que ')
    .replace(/\brelata\s+(?:um\s+)?/giu, 'foi relatado ')
    .replace(/\best[áa]\s+recebendo\s+(?:a\s+)?mensagem\s+d[eo]\s+erro/giu, 'foi informada mensagem de erro')
    .replace(/\bcom\s+mensagem\s+informada\s+como\s+/giu, 'com mensagem informada como ')
    .replace(/\bFoi relatado\s+foi relatado\b/giu, 'Foi relatado');

  if (!/^\s*(?:Foi relatado|Foi informado|O solicitante relatou)\b/iu.test(text)) {
    text = `Foi relatado ${text}`;
  }

  return cleanup(text);
}
