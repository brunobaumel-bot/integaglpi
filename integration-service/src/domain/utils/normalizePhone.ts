export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  if (!digits) {
    throw new Error('Phone number is empty after normalization.');
  }

  return `+${digits}`;
}

