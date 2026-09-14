// Utilitários de validação e formatação de telefone (BR/internacional).
export function normalizePhone(input: string): string {
  // Remove espaços, traços, parênteses, pontos e quaisquer caracteres não numéricos (exceto +)
  return input.trim().replace(/[\s\-().]/g, "").replace(/[^\d+]/g, "");
}

export function isValidPhone(input: string): boolean {
  if (!input) return false;
  const n = normalizePhone(input);
  if (!n) return false;
  // Com prefixo +: aceita entre 8 e 15 dígitos após o +
  if (n.startsWith("+")) return /^\+\d{8,15}$/.test(n);
  // Sem prefixo: aceita entre 8 e 15 dígitos
  return /^\d{8,15}$/.test(n);
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