export function formatarTelefone(phone: string): string {
  phone = phone.replace(/\D/g, '');

  if (phone.startsWith('55') && phone.length > 11) {
    phone = phone.slice(2);
  }

  const ddd = phone.slice(0, 2);
  let numero = phone.slice(2);

  if (numero.length === 8 && ['6', '7', '8', '9'].includes(numero[0])) {
    numero = '9' + numero;
  }

  if (numero.length > 9) {
    numero = numero.slice(-9);
  }

  return ddd + numero;
}

export function estaNoHorario(inicio: string, fim: string): boolean {
  const agora = new Date();
  // BRT = UTC-3
  const horaBRT = (agora.getUTCHours() - 3 + 24) % 24;
  const minBRT = agora.getUTCMinutes();
  const totalMinutos = horaBRT * 60 + minBRT;

  const [hI, mI] = inicio.split(':').map(Number);
  const [hF, mF] = fim.split(':').map(Number);
  const inicioMin = hI * 60 + mI;
  // "00:00" como fim significa meia-noite = fim do dia
  const fimMin = (hF === 0 && mF === 0) ? 24 * 60 : hF * 60 + mF;

  return totalMinutos >= inicioMin && totalMinutos <= fimMin;
}

export function randomEntre(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function escolherAleatorio<T>(arr: T[]): T | null {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}
