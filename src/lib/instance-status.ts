import { supabase } from "@/integrations/supabase/client";

/** Consulta a UAZAPI e retorna true se a instância estiver conectada (mesma regra do Dashboard). */
export async function isInstanciaConectada(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { data: sd } = await supabase.functions.invoke("uazapi-proxy", {
      body: { action: "instance_status", payload: { token } },
    });
    const d = sd as Record<string, unknown> | null;
    let raw = "disconnected";
    if (d?.status && typeof d.status === "object") {
      const s = d.status as Record<string, unknown>;
      if (s.connected === true || s.loggedIn === true) raw = "connected";
    } else if (d?.status && typeof d.status === "string") {
      raw = d.status;
    } else if (typeof (d?.instance as Record<string, unknown> | undefined)?.status === "string") {
      raw = (d!.instance as Record<string, unknown>).status as string;
    }
    return raw === "open" || raw === "connected";
  } catch {
    return false;
  }
}

/** Quantas das instâncias informadas estão conectadas agora. */
export async function contarConectadas(instancias: { token: string | null }[]): Promise<number> {
  const results = await Promise.all(instancias.map((i) => isInstanciaConectada(i.token)));
  return results.filter(Boolean).length;
}
