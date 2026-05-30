export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  if (!digits) {
    throw new Error('Phone number is empty after normalization.');
  }

  const brazilianMobileWithoutNinthDigit = /^55(\d{2})([6-9]\d{7})$/.exec(digits);
  if (brazilianMobileWithoutNinthDigit) {
    return `+55${brazilianMobileWithoutNinthDigit[1]}9${brazilianMobileWithoutNinthDigit[2]}`;
  }

  return `+${digits}`;
}
