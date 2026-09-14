// Utilitários de validação e formatação de telefone (BR/internacional).
export function normalizePhone(input: string): string {
  if (!input) return "";
  // Remove espaços, traços, parênteses, pontos e caracteres não numéricos (exceto +)
  let cleaned = input.trim().replace(/[\s\-\(\)\.]/g, "").replace(/[^\d+]/g, "");

  // Se começar com 0 seguido de DDD (ex: 011988887777 ou 021988887777), remove o zero inicial
  if (!cleaned.startsWith("+") && cleaned.startsWith("0") && (cleaned.length === 11 || cleaned.length === 12)) {
    cleaned = cleaned.slice(1);
  }

  return cleaned;
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
  if (!input) return "";
  const n = normalizePhone(input).replace(/^\+?55/, "");
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return input;
}

export function toE164BR(input: string): string {
  const n = normalizePhone(input);
  if (!n) return "";
  if (n.startsWith("+")) return n;
  if (n.length === 10 || n.length === 11) return `+55${n}`;
  if (n.startsWith("55") && (n.length === 12 || n.length === 13)) return `+${n}`;
  return `+${n}`;
}