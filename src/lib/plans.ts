import { supabase } from "@/integrations/supabase/client";

export interface ConnectionLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  planName: string;
}

/**
 * Verifica se o usuário pode adicionar mais uma conexão (WhatsApp ou e-mail).
 *
 * 1. Busca o plano ativo em user_plans com o max_connections do plano referenciado.
 * 2. Conta instâncias de WhatsApp (instancias) + credenciais de e-mail (email_credentials).
 * 3. Retorna { allowed, current, limit, planName }.
 *
 * Lança erro claro se o usuário não tiver plano ativo.
 */
export async function canAddConnection(userId: string): Promise<ConnectionLimitResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: userPlan, error: planError } = await (supabase as any)
    .from("user_plans")
    .select("plans(name, max_connections)")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  if (planError) throw new Error("Erro ao buscar plano: " + planError.message);
  if (!userPlan) throw new Error("Usuário sem plano ativo");

  const plan = userPlan.plans as { name: string; max_connections: number } | null;
  if (!plan) throw new Error("Usuário sem plano ativo");

  // Conta conexões existentes do usuário: WhatsApp + e-mail
  const [whats, email] = await Promise.all([
    supabase.from("instancias").select("id", { count: "exact", head: true }).eq("usuario_id", userId),
    supabase.from("email_credentials").select("id", { count: "exact", head: true }).eq("usuario_id", userId),
  ]);

  const countError = whats.error ?? email.error;
  if (countError) throw new Error("Erro ao verificar conexões: " + countError.message);

  const current = (whats.count ?? 0) + (email.count ?? 0);

  return {
    allowed: current < plan.max_connections,
    current,
    limit: plan.max_connections,
    planName: plan.name,
  };
}
