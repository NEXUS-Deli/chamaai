import { supabase } from "@/integrations/supabase/client";

export interface ConnectionLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  planName: string;
}

/**
 * Verifica se o usuário pode adicionar mais uma conexão WhatsApp.
 *
 * 1. Busca o plano ativo em user_plans com o max_connections do plano referenciado.
 * 2. Conta quantas instâncias o usuário já tem na tabela instancias.
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

  // Conta conexões existentes do usuário
  const { count, error: countError } = await supabase
    .from("instancias")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", userId);

  if (countError) throw new Error("Erro ao verificar conexões: " + countError.message);

  const current = count ?? 0;

  return {
    allowed: current < plan.max_connections,
    current,
    limit: plan.max_connections,
    planName: plan.name,
  };
}
