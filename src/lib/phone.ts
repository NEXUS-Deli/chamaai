// Utilitários de validação e formatação de telefone (BR/internacional).
export function normalizePhone(input: string): string {
  return input.replace(/[^\d+]/g, "");
}

export function isValidPhone(input: string): boolean {
  const n = normalizePhone(input);
  // +5511912345678 ou 11912345678 (10-15 dígitos)
  if (n.startsWith("+")) return /^\+\d{10,15}$/.test(n);
  return /^\d{10,15}$/.test(n);
}

export function formatPhoneBR(input: string): string {
  const n = normalizePhone(input).replace(/^\+?55/, "");
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return input;
}

export function toE164BR(input: string): string {
  const n = normalizePhone(input);
  if (n.startsWith("+")) return n;
  if (n.length === 10 || n.length === 11) return `+55${n}`;
  return `+${n}`;
}