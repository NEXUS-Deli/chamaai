const BASE_URL = process.env.UAZAPI_BASE_URL ?? 'https://nexus-360.uazapi.com';

export interface VerificacaoWpp {
  isInWhatsapp: boolean;
  jid?: string;
}

export async function verificarWhatsApp(telefone: string, token: string): Promise<VerificacaoWpp> {
  try {
    const res = await fetch(`${BASE_URL}/chat/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', token },
      body: JSON.stringify({ numbers: [telefone] }),
    });
    if (!res.ok) return { isInWhatsapp: false };
    const data = await res.json() as Array<{ query: string; isInWhatsapp: boolean; jid: string }>;
    return data[0] ?? { isInWhatsapp: false };
  } catch {
    return { isInWhatsapp: false };
  }
}

export async function enviarTexto(jid: string, texto: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', token },
      body: JSON.stringify({ number: jid, text: texto }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Unified media endpoint: /send/media with type = "image" | "video" | "document"
export async function enviarMidia(
  jid: string,
  url: string,
  tipo: string,
  nomeArquivo: string,
  legenda: string,
  token: string,
): Promise<boolean> {
  try {
    let type: string;
    if (tipo.startsWith('image/')) type = 'image';
    else if (tipo.startsWith('video/')) type = 'video';
    else type = 'document';

    const body: Record<string, unknown> = { number: jid, type, file: url, text: legenda };
    if (type === 'document') body.docName = nomeArquivo;

    const res = await fetch(`${BASE_URL}/send/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', token },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}
