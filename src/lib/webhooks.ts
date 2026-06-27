// Chamadas HTTP aos webhooks n8n configurados pelo usuário.
import { toast } from "sonner";

export interface CampanhaPayload {
  campanha_id: string;
  nome: string;
  mensagem: string;
  midia_url: string | null;
  midia_nome?: string | null;
  midia_tipo?: string | null;
  midia_path?: string | null;
  midia_bucket?: string | null;
  delay_segundos: number; // mantido por retrocompatibilidade se precisar
  delay_minimo: number;
  delay_maximo: number;
  delay_mensagens: number;
  contatos: { telefone: string; nome: string; empresa: string }[];
  instancia: string;
  token: string;
  agendar_para: string | null;
}

export interface StatusResponse {
  status: "aguardando" | "em_andamento" | "concluida" | "erro";
  enviadas: number;
  entregues: number;
  erros: number;
  pendentes: number;
  contatos: { telefone: string; status: "enviado" | "entregue" | "erro" | "pendente" }[];
}

async function postJSON(url: string, body: unknown): Promise<Response> {
  if (!url) throw new Error("URL do webhook não configurada");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Webhook respondeu ${res.status}`);
  return res;
}

export async function dispararCampanha(url: string, payload: CampanhaPayload) {
  try {
    await postJSON(url, payload);
    return true;
  } catch (e) {
    toast.error("Não foi possível disparar a campanha. Verifique a URL em Configurações.");
    console.error(e);
    return false;
  }
}

export async function chamarAcaoCampanha(url: string, campanha_id: string, acao: string) {
  try {
    await postJSON(url, { campanha_id });
    return true;
  } catch (e) {
    toast.error(`Não foi possível ${acao} a campanha.`);
    console.error(e);
    return false;
  }
}

export async function buscarStatus(url: string, campanha_id: string): Promise<StatusResponse | null> {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.searchParams.set("campanha_id", campanha_id);
    const res = await fetch(u.toString());
    if (!res.ok) return null;
    return (await res.json()) as StatusResponse;
  } catch {
    return null;
  }
}