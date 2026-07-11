import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Send, Users, Smartphone, CheckCircle2,
  Clock, Clapperboard, ArrowRight, Loader2, MessageSquare, CalendarDays,
} from "lucide-react";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

type Periodo = "7d" | "15d" | "30d" | "custom";

interface StoryItem {
  id: string;
  titulo: string;
  tipo: string;
  status: string;
  agendado_para: string;
}

interface CampanhaItem {
  id: string;
  nome: string;
  status: string;
  total_contatos: number | null;
  enviadas: number | null;
  entregues: number | null;
  lidos: number | null;
  erros: number | null;
  criada_em: string;
}

interface ChartPoint {
  dia: string;
  enviadas: number;
  falhas: number;
}

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

function buildChartData(campanhas: CampanhaItem[], startDate: Date, endDate: Date): ChartPoint[] {
  const mapa: Record<string, ChartPoint> = {};
  const cur = new Date(startDate);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  while (cur <= end) {
    const key = cur.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    mapa[key] = { dia: key, enviadas: 0, falhas: 0 };
    cur.setDate(cur.getDate() + 1);
  }

  for (const c of campanhas) {
    const key = new Date(c.criada_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    if (mapa[key]) {
      mapa[key].enviadas += c.enviadas ?? 0;
      mapa[key].falhas  += c.erros    ?? 0;
    }
  }

  return Object.values(mapa);
}

function getXAxisInterval(days: number): number {
  if (days <= 7)  return 0;
  if (days <= 15) return 1;
  if (days <= 30) return 3;
  return Math.floor(days / 10);
}

function Dashboard() {
  const [periodo, setPeriodo]         = useState<Periodo>("30d");
  const [customInicio, setCustomInicio] = useState(toDateStr(new Date(Date.now() - 30 * 86400000)));
  const [customFim, setCustomFim]     = useState(toDateStr(new Date()));

  const { startDate, endDate, dias } = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(23, 59, 59, 999);
    let start: Date;

    if (periodo === "7d") {
      start = new Date(Date.now() - 6  * 86400000);
    } else if (periodo === "15d") {
      start = new Date(Date.now() - 14 * 86400000);
    } else if (periodo === "30d") {
      start = new Date(Date.now() - 29 * 86400000);
    } else {
      start = new Date(customInicio + "T00:00:00");
      const fim = new Date(customFim + "T23:59:59");
      const d = Math.round((fim.getTime() - start.getTime()) / 86400000) + 1;
      return { startDate: start, endDate: fim, dias: d };
    }
    start.setHours(0, 0, 0, 0);
    const d = Math.round((hoje.getTime() - start.getTime()) / 86400000) + 1;
    return { startDate: start, endDate: hoje, dias: d };
  }, [periodo, customInicio, customFim]);

  const periodoLabel = useMemo(() => {
    if (periodo === "7d")  return "últimos 7 dias";
    if (periodo === "15d") return "últimos 15 dias";
    if (periodo === "30d") return "últimos 30 dias";
    return `${new Date(customInicio + "T00:00:00").toLocaleDateString("pt-BR")} – ${new Date(customFim + "T00:00:00").toLocaleDateString("pt-BR")}`;
  }, [periodo, customInicio, customFim]);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-overview", startDate.toISOString(), endDate.toISOString()],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Não autenticado");

      const start = startDate.toISOString();
      const end   = endDate.toISOString();

      const [
        { data: instancias },
        { count: leadsCount },
        { data: campanhasRecentes },
        { data: campanhasGrafico },
        { data: storiesRaw },
        { data: planRaw },
        { count: storiesCount },
      ] = await Promise.all([
        // Instâncias: busca token para verificar status em tempo real
        supabase.from("instancias").select("id,token").eq("usuario_id", uid),

        // Leads importados no período (count sem buscar linhas, sem limite de 1000)
        supabase.from("leads")
          .select("*", { count: "exact", head: true })
          .eq("usuario_id", uid)
          .gte("importado_em", start)
          .lte("importado_em", end),

        // Campanhas do período (top 5 recentes para a lista)
        supabase.from("campanhas")
          .select("id,nome,status,total_contatos,enviadas,entregues,erros,criada_em")
          .eq("usuario_id", uid)
          .gte("criada_em", start)
          .lte("criada_em", end)
          .order("criada_em", { ascending: false })
          .limit(5),

        // Todas campanhas do período para o gráfico e métricas
        supabase.from("campanhas")
          .select("enviadas,entregues,lidos,erros,criada_em")
          .eq("usuario_id", uid)
          .gte("criada_em", start)
          .lte("criada_em", end),

        // Stories pendentes (próximos, sem filtro de período) — lista para exibição
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("stories_agendamentos")
          .select("id,titulo,tipo,status,agendado_para")
          .eq("usuario_id", uid)
          .eq("status", "pendente")
          .order("agendado_para", { ascending: true })
          .limit(4),

        // Contagem total de stories pendentes (sem limite)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("stories_agendamentos")
          .select("*", { count: "exact", head: true })
          .eq("usuario_id", uid)
          .eq("status", "pendente"),

        // Plano ativo do usuário para exibir o limite de conexões
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("user_plans")
          .select("plans(max_connections)")
          .eq("user_id", uid)
          .eq("active", true)
          .maybeSingle(),
      ]);

      const campList    = (campanhasRecentes ?? []) as CampanhaItem[];
      const campGrafico = (campanhasGrafico  ?? []) as CampanhaItem[];
      const storyList   = (storiesRaw        ?? []) as StoryItem[];
      const planLimit   = (planRaw?.plans as { max_connections: number } | null)?.max_connections ?? null;

      const totalEnviadas  = campGrafico.reduce((a, c) => a + (c.enviadas  ?? 0), 0);
      const totalEntregues = campGrafico.reduce((a, c) => a + (c.entregues ?? 0), 0);
      const totalLidos     = campGrafico.reduce((a, c) => a + (c.lidos     ?? 0), 0);
      const totalErros     = campGrafico.reduce((a, c) => a + (c.erros     ?? 0), 0);

      // Verifica status real das instâncias via UAZAPI (igual à página Conexões)
      const instList = (instancias ?? []) as { id: string; token: string | null }[];
      const statusResults = await Promise.allSettled(
        instList.map(async (inst) => {
          if (!inst.token) return false;
          try {
            const { data: sd } = await supabase.functions.invoke("uazapi-proxy", {
              body: { action: "instance_status", payload: { token: inst.token } },
            });
            const d = sd as Record<string, unknown> | null;
            let raw = "disconnected";
            if (d?.status && typeof d.status === "object") {
              const s = d.status as Record<string, unknown>;
              if (s.connected === true || s.loggedIn === true) raw = "connected";
            } else if (d?.status && typeof d.status === "string") {
              raw = d.status;
            } else if (typeof (d?.instance as Record<string, unknown> | undefined)?.status === "string") {
              raw = ((d!.instance as Record<string, unknown>).status as string);
            }
            return raw === "open" || raw === "connected";
          } catch {
            return false;
          }
        })
      );
      const instConectadas = statusResults.filter(
        (r) => r.status === "fulfilled" && r.value === true
      ).length;

      return {
        totalInst: (instancias ?? []).length,
        instConectadas,
        planLimit,
        totalLeads: leadsCount ?? 0,
        totalCamps: campGrafico.length,
        totalEnviadas,
        totalEntregues,
        totalErros,
        taxaEntrega: totalEnviadas > 0 ? Math.min(100, Math.round((totalEntregues / totalEnviadas) * 100)) : null,
        totalLidos,
        taxaLeitura: totalEntregues > 0 ? Math.min(100, Math.round((totalLidos / totalEntregues) * 100)) : null,
        recentesCamps: campList,
        totalStories: storiesCount ?? storyList.length,
        proximosStories: storyList,
        chartData: buildChartData(campGrafico, startDate, endDate),
      };
    },
    refetchInterval: 60_000,
  });

  const temDados = data?.chartData.some((p) => p.enviadas > 0 || p.falhas > 0) ?? false;

  return (
    <div className="p-4 sm:p-8 space-y-6 sm:space-y-8">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-base text-muted-foreground mt-1 capitalize">
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>

        {/* Filtro de período */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border bg-card p-0.5 gap-0.5">
            {(["7d", "15d", "30d"] as Periodo[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriodo(p)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  periodo === p
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p === "7d" ? "7 dias" : p === "15d" ? "15 dias" : "30 dias"}
              </button>
            ))}
            <button
              onClick={() => setPeriodo("custom")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                periodo === "custom"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" /> Personalizado
            </button>
          </div>

          {/* Seletor de datas customizado */}
          {periodo === "custom" && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={customInicio}
                max={customFim}
                onChange={(e) => setCustomInicio(e.target.value)}
                className="h-8 w-36 text-sm"
              />
              <span className="text-sm text-muted-foreground">até</span>
              <Input
                type="date"
                value={customFim}
                min={customInicio}
                max={toDateStr(new Date())}
                onChange={(e) => setCustomFim(e.target.value)}
                className="h-8 w-36 text-sm"
              />
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Métricas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-xl overflow-hidden border">
            <Metric label="Contatos importados"   value={data!.totalLeads.toLocaleString("pt-BR")}           icon={Users}          note={periodoLabel} />
            <Metric label="Campanhas"             value={data!.totalCamps}                                    icon={Send}           note={periodoLabel} />
            <Metric label="Mensagens enviadas"    value={data!.totalEnviadas.toLocaleString("pt-BR")}        icon={MessageSquare}  note={periodoLabel} />
            <Metric label="Taxa de entrega"       value={data!.taxaEntrega !== null ? `${data!.taxaEntrega}%` : "—"} icon={CheckCircle2} active={data!.taxaEntrega !== null && data!.taxaEntrega >= 70} note={`${data!.totalEntregues} entregues`} />
            <Metric label="Taxa de leitura"       value={data!.taxaLeitura !== null ? `${data!.taxaLeitura}%` : "—"} icon={CheckCircle2} active={data!.taxaLeitura !== null && data!.taxaLeitura >= 30} note={`${data!.totalLidos} lidas`} />
            <Metric label="Stories agendados"     value={data!.totalStories}                                  icon={Clapperboard}   note="próximos" />
          </div>

          {/* Gráfico */}
          <div className="border rounded-xl bg-card p-6 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-base font-semibold">Mensagens enviadas vs. falhas</h2>
                <p className="text-xs text-muted-foreground mt-0.5 capitalize">{periodoLabel}</p>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: "var(--primary)" }} /> Enviadas
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: "#ef4444" }} /> Falhas
                </span>
              </div>
            </div>

            {!temDados ? (
              <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">
                Nenhuma mensagem enviada no período selecionado.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data!.chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradEnviadas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--primary)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradFalhas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="dia"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    interval={getXAxisInterval(dias)}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      fontSize: "12px",
                      color: "var(--foreground)",
                    }}
                    labelStyle={{ fontWeight: 600, marginBottom: 4 }}
                    formatter={(value: number, name: string) => [
                      value,
                      name === "enviadas" ? "Enviadas" : "Falhas",
                    ]}
                  />
                  <Area type="monotone" dataKey="enviadas" stroke="var(--primary)" strokeWidth={2} fill="url(#gradEnviadas)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                  <Area type="monotone" dataKey="falhas"   stroke="#ef4444"        strokeWidth={2} fill="url(#gradFalhas)"   dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Conteúdo principal */}
          <div className="grid lg:grid-cols-2 gap-8">

            {/* Campanhas recentes */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Campanhas recentes</h2>
                <Link to="/campanhas" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors">
                  Ver todas <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
              {data!.recentesCamps.length === 0 ? (
                <EmptyState label="Nenhuma campanha no período" action={{ label: "Criar campanha", to: "/campanhas/nova" }} />
              ) : (
                <div className="space-y-1">
                  {data!.recentesCamps.map((c) => (
                    <Link
                      key={c.id}
                      to="/campanhas/$id"
                      params={{ id: c.id }}
                      className="flex items-center justify-between py-4 px-4 rounded-lg hover:bg-muted/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{c.nome}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {c.total_contatos ?? 0} contatos · {new Date(c.criada_em).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <StatusPill status={c.status} />
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Próximos stories + ações rápidas */}
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold">Próximos stories</h2>
                  <Link to="/stories" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors">
                    Ver todos <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
                {data!.proximosStories.length === 0 ? (
                  <EmptyState label="Nenhum story agendado" action={{ label: "Agendar story", to: "/stories" }} />
                ) : (
                  <div className="space-y-1">
                    {data!.proximosStories.map((s) => (
                      <div key={s.id} className="flex items-center gap-3 py-4 px-4 rounded-lg">
                        <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{s.titulo}</p>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {new Date(s.agendado_para).toLocaleString("pt-BR", {
                              day: "2-digit", month: "2-digit",
                              hour: "2-digit", minute: "2-digit",
                            })}
                          </p>
                        </div>
                        <span className="text-sm text-muted-foreground capitalize shrink-0">{s.tipo}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({
  label, value, icon: Icon, active, note,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  active?: boolean;
  note?: string;
}) {
  return (
    <div className="bg-card px-5 py-4 flex items-start justify-between gap-3">
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">{label}</p>
        <p className={`text-xl font-bold tracking-tight ${active ? "text-primary" : ""}`}>{value}</p>
        {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
      </div>
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
    </div>
  );
}

function WhatsAppMetric({ conectadas, limite }: { conectadas: number; limite: number | null }) {
  const hasPlan = limite !== null && limite > 0;
  const pct     = hasPlan ? Math.min(100, Math.round((conectadas / limite!) * 100)) : 0;
  const atLimit = hasPlan && conectadas >= limite!;

  return (
    <div className="bg-card px-5 py-4 flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground mb-1.5">WhatsApp conectados</p>
        <p className={`text-xl font-bold tracking-tight ${conectadas > 0 ? "text-primary" : ""}`}>
          {conectadas}{hasPlan ? `/${limite}` : ""}
        </p>
        {hasPlan ? (
          <div className="mt-2 space-y-1">
            <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  atLimit ? "bg-destructive" : conectadas > 0 ? "bg-primary" : "bg-muted-foreground/30"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {atLimit ? "Limite atingido" : `${pct}% utilizado`} · estado atual
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mt-1">estado atual</p>
        )}
      </div>
      <Smartphone className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
    </div>
  );
}

function EmptyState({ label, action }: { label: string; action: { label: string; to: string } }) {
  return (
    <div className="flex items-center justify-between py-4 px-4 rounded-lg border border-dashed">
      <p className="text-sm text-muted-foreground">{label}</p>
      <Link to={action.to} className="text-xs text-primary hover:underline flex items-center gap-1">
        {action.label} <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  );
}

const STATUS_MAP: Record<string, { label: string; class: string }> = {
  rascunho:     { label: "Rascunho",     class: "text-muted-foreground" },
  agendada:     { label: "Agendada",     class: "text-blue-500" },
  em_andamento: { label: "Em andamento", class: "text-yellow-500" },
  pausada:      { label: "Pausada",      class: "text-orange-500" },
  concluida:    { label: "Concluída",    class: "text-green-500" },
  cancelada:    { label: "Cancelada",    class: "text-destructive" },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] ?? { label: status, class: "text-muted-foreground" };
  return <span className={`text-xs font-medium shrink-0 ml-4 ${cfg.class}`}>{cfg.label}</span>;
}
