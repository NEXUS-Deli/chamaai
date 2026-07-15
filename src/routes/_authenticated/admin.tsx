import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Send, Zap, BarChart3, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

interface Profile { id: string; nome: string | null; email: string | null }
interface Campanha {
  id: string; nome: string; status: string;
  total_contatos: number | null; enviadas: number | null; erros: number | null;
  criada_em: string; usuario_id: string;
}
interface Instancia { id: string; nome: string; usuario_id: string }
interface Plan { id: string; name: string; max_connections: number }
interface UserPlan { user_id: string; plan_id: string }

const STATUS_LABEL: Record<string, { label: string; class: string }> = {
  em_andamento: { label: "Ativo",     class: "bg-green-100 text-green-700" },
  pausada:      { label: "Pausada",   class: "bg-yellow-100 text-yellow-700" },
  concluida:    { label: "Concluída", class: "bg-blue-100 text-blue-700" },
  agendada:     { label: "Agendada",  class: "bg-purple-100 text-purple-700" },
  cancelada:    { label: "Cancelada", class: "bg-red-100 text-red-700" },
  rascunho:     { label: "Rascunho",  class: "bg-muted text-muted-foreground" },
};

function AdminPage() {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin]         = useState<boolean | null>(null);
  const [profiles, setProfiles]       = useState<Profile[]>([]);
  const [campanhas, setCampanhas]     = useState<Campanha[]>([]);
  const [instancias, setInstancias]   = useState<Instancia[]>([]);
  const [totalLeads, setTotalLeads]   = useState(0);
  const [loading, setLoading]         = useState(true);
  const [filtroUser, setFiltroUser]   = useState<string>("all");
  const [filtroStatus, setFiltroStatus] = useState<string>("all");
  const [plans, setPlans]             = useState<Plan[]>([]);
  const [userPlans, setUserPlans]     = useState<Record<string, string>>({}); // user_id -> plan_id
  const [changingPlanId, setChangingPlanId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    // Verifica se é admin
    const { data: adminRow } = await (supabase as any)
      .from("admins")
      .select("user_id")
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (!adminRow) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setIsAdmin(true);

    const [
      { data: profs },
      { data: camps },
      { data: insts },
      { count: leads },
      { data: plansData },
      { data: userPlansData },
    ] = await Promise.all([
      (supabase as any).from("profiles").select("id,nome,email"),
      (supabase as any)
        .from("campanhas")
        .select("id,nome,status,total_contatos,enviadas,erros,criada_em,usuario_id")
        .order("criada_em", { ascending: false })
        .limit(200),
      (supabase as any).from("instancias").select("id,nome,usuario_id"),
      (supabase as any).from("leads").select("id", { count: "exact", head: true }),
      (supabase as any).from("plans").select("id,name,max_connections").order("max_connections", { ascending: true }),
      (supabase as any).from("user_plans").select("user_id,plan_id"),
    ]);

    setProfiles(profs ?? []);
    setCampanhas(camps ?? []);
    setInstancias(insts ?? []);
    setTotalLeads(leads ?? 0);
    setPlans(plansData ?? []);
    setUserPlans(
      Object.fromEntries(((userPlansData ?? []) as UserPlan[]).map((up) => [up.user_id, up.plan_id]))
    );
    setLoading(false);
  };

  const changePlano = async (userId: string, planId: string) => {
    const anterior = userPlans[userId];
    setChangingPlanId(userId);
    setUserPlans((prev) => ({ ...prev, [userId]: planId })); // otimista
    try {
      const { error } = await (supabase as any)
        .from("user_plans")
        .upsert(
          { user_id: userId, plan_id: planId, active: true, started_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
      if (error) throw new Error(error.message);
      const nomePlano = plans.find((pl) => pl.id === planId)?.name ?? planId;
      toast.success(`Plano alterado para ${nomePlano}`);
    } catch (e) {
      setUserPlans((prev) => ({ ...prev, [userId]: anterior })); // desfaz em caso de erro
      toast.error(e instanceof Error ? e.message : "Erro ao alterar plano");
    } finally {
      setChangingPlanId(null);
    }
  };

  useEffect(() => { load(); }, []);

  if (isAdmin === null || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-lg font-semibold">Acesso restrito</p>
        <p className="text-sm text-muted-foreground">Esta área é exclusiva para administradores.</p>
        <Button onClick={() => navigate({ to: "/dashboard" })}>Voltar ao Dashboard</Button>
      </div>
    );
  }

  const profileMap = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const instanciasPorUser = instancias.reduce<Record<string, number>>((acc, i) => {
    acc[i.usuario_id] = (acc[i.usuario_id] ?? 0) + 1;
    return acc;
  }, {});

  const campanhasFiltradas = campanhas.filter((c) => {
    if (filtroUser !== "all" && c.usuario_id !== filtroUser) return false;
    if (filtroStatus !== "all" && c.status !== filtroStatus) return false;
    return true;
  });

  const ativas       = campanhas.filter((c) => c.status === "em_andamento");
  const totalEnviadas = campanhas.reduce((s, c) => s + (c.enviadas ?? 0), 0);
  const usuariosAtivos = new Set(campanhas.map((c) => c.usuario_id)).size;

  return (
    <div className="p-4 sm:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Painel Admin</h1>
          <p className="text-sm text-muted-foreground">Visão geral de todos os usuários da plataforma</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-2">Atualizar</span>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Users,    label: "Usuários com campanhas", value: usuariosAtivos },
          { icon: Zap,      label: "Campanhas ativas agora",  value: ativas.length },
          { icon: Send,     label: "Total de disparos",       value: totalEnviadas.toLocaleString("pt-BR") },
          { icon: BarChart3,label: "Total de leads",          value: totalLeads.toLocaleString("pt-BR") },
        ].map((s) => (
          <Card key={s.label} className="p-4 flex gap-3 items-center">
            <div className="p-2 rounded-lg bg-primary/10">
              <s.icon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold">{s.value}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Campanhas ativas */}
      {ativas.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Disparando agora</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ativas.map((c) => {
              const prof = profileMap[c.usuario_id];
              const pct  = c.total_contatos ? Math.round(((c.enviadas ?? 0) / c.total_contatos) * 100) : 0;
              return (
                <Card key={c.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold truncate text-sm">{c.nome}</p>
                      <p className="text-xs text-muted-foreground truncate">{prof?.email ?? prof?.nome ?? c.usuario_id.slice(0, 8)}</p>
                    </div>
                    <span className="shrink-0 flex items-center gap-1 text-xs font-medium text-green-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      Ativo
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{c.enviadas ?? 0} enviadas</span>
                      <span>{c.total_contatos ?? 0} total · {pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <Link to="/campanhas/$id" params={{ id: c.id }} className="text-xs text-primary hover:underline">
                    Ver detalhes →
                  </Link>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Usuários */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Usuários</h2>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[650px]">
              <thead className="border-b text-left text-muted-foreground text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3">Usuário</th>
                  <th className="px-3 py-3">Plano</th>
                  <th className="px-3 py-3">E-mail</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">Conexões WA</th>
                  <th className="px-3 py-3 text-right">Campanhas</th>
                  <th className="px-4 py-3 text-right">Disparos</th>
                </tr>
              </thead>
              <tbody>
                {profiles.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Nenhum usuário encontrado</td></tr>
                )}
                {profiles.map((p) => {
                  const userCamps  = campanhas.filter((c) => c.usuario_id === p.id);
                  const userSent   = userCamps.reduce((s, c) => s + (c.enviadas ?? 0), 0);
                  const userConns  = instanciasPorUser[p.id] ?? 0;
                  const planoAtual = userPlans[p.id] ?? "";
                  return (
                    <tr
                      key={p.id}
                      className="border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
                      onClick={() => setFiltroUser(filtroUser === p.id ? "all" : p.id)}
                    >
                      <td className="px-4 py-3 font-medium truncate max-w-[140px]">{p.nome || "—"}</td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={planoAtual}
                          onValueChange={(v) => changePlano(p.id, v)}
                          disabled={changingPlanId === p.id}
                        >
                          <SelectTrigger className="h-8 w-[130px] text-xs">
                            {changingPlanId === p.id ? (
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                <Loader2 className="w-3 h-3 animate-spin" /> Salvando…
                              </span>
                            ) : (
                              <SelectValue placeholder="Sem plano" />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            {plans.map((pl) => (
                              <SelectItem key={pl.id} value={pl.id}>
                                {pl.name} ({pl.max_connections} conexão{pl.max_connections !== 1 ? "ões" : ""})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground text-xs truncate max-w-[180px]">{p.email || "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{userConns}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{userCamps.length}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{userSent.toLocaleString("pt-BR")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Todas as campanhas */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Campanhas {filtroUser !== "all" && `— ${profileMap[filtroUser]?.email ?? filtroUser.slice(0, 8)}`}
          </h2>
          <div className="flex gap-2 flex-wrap">
            {filtroUser !== "all" && (
              <Button variant="outline" size="sm" onClick={() => setFiltroUser("all")}>Limpar filtro</Button>
            )}
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="text-xs border rounded-md px-2 py-1 bg-background"
            >
              <option value="all">Todos os status</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="border-b text-left text-muted-foreground text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3">Campanha</th>
                  <th className="px-3 py-3">Usuário</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Progresso</th>
                  <th className="px-3 py-3 whitespace-nowrap">Criada em</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {campanhasFiltradas.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Nenhuma campanha encontrada</td></tr>
                )}
                {campanhasFiltradas.map((c) => {
                  const prof = profileMap[c.usuario_id];
                  const st   = STATUS_LABEL[c.status] ?? { label: c.status, class: "bg-muted text-muted-foreground" };
                  const env  = c.enviadas ?? 0;
                  const tot  = c.total_contatos ?? 0;
                  const pct  = tot > 0 ? Math.round((env / tot) * 100) : 0;
                  return (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 font-medium max-w-[200px] truncate">{c.nome}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground max-w-[160px] truncate">
                        {prof?.email ?? prof?.nome ?? c.usuario_id.slice(0, 8)}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${st.class}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <span className="font-medium tabular-nums">{env.toLocaleString("pt-BR")}</span>
                        <span className="text-muted-foreground"> / {tot.toLocaleString("pt-BR")}</span>
                        {tot > 0 && (
                          <span className="ml-1.5 text-xs text-muted-foreground">({pct}%)</span>
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(c.criada_em).toLocaleString("pt-BR", {
                          day: "2-digit", month: "2-digit", year: "2-digit",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to="/campanhas/$id"
                          params={{ id: c.id }}
                          className="text-primary hover:underline text-xs font-medium"
                        >
                          Ver
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
