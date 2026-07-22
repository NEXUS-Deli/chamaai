import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Bot, Plus, Loader2, CalendarDays,
  MessageSquare, Clock, Moon, Smartphone, ChevronRight,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/atendimento-ia/")({
  component: AtendimentoIAPage,
});

type Periodo = "7d" | "15d" | "30d" | "custom";

interface ConversaRow {
  numero: string;
  instancia_id: string;
  role: "user" | "assistant";
  criado_em: string;
}

interface MetricsData {
  totalMensagens: number;
  conversasRespondidas: number;
  avgSecs: number | null;
  foraHorario: number;
}

interface AgentRow {
  instancia_id: string;
  ativo: boolean;
  provedor: string;
  instancia_nome: string;
  instancia_status: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI (ChatGPT)",
  claude: "Anthropic (Claude)",
  gemini: "Google (Gemini)",
  groq: "Groq (Llama / Mistral)",
};

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

/** Verifica se um timestamp (UTC string) está fora do horário comercial (9h–18h, seg–sex, horário BRT UTC-3) */
function isOutsideBusinessHours(criado_em: string): boolean {
  const utcMs = new Date(criado_em).getTime();
  const brtMs = utcMs - 3 * 60 * 60 * 1000;
  const brt   = new Date(brtMs);
  const day   = brt.getUTCDay();  // 0=Dom, 6=Sab
  const hour  = brt.getUTCHours();
  if (day === 0 || day === 6) return true;
  if (hour < 9 || hour >= 18)  return true;
  return false;
}

/** Calcula tempo médio de resposta (segundos) entre pares consecutivos user→assistant */
function calcAvgResponseSecs(rows: ConversaRow[]): number | null {
  // Agrupa por conversa
  const grouped: Record<string, ConversaRow[]> = {};
  for (const r of rows) {
    const key = `${r.instancia_id}|${r.numero}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }

  const times: number[] = [];
  for (const msgs of Object.values(grouped)) {
    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].role === "user" && msgs[i + 1].role === "assistant") {
        const diff = (new Date(msgs[i + 1].criado_em).getTime() - new Date(msgs[i].criado_em).getTime()) / 1000;
        if (diff >= 0 && diff < 300) times.push(diff); // ignora diffs absurdos > 5min
      }
    }
  }
  return times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null;
}

function formatResponseTime(secs: number | null): string {
  if (secs === null) return "—";
  if (secs < 60)  return `${Math.round(secs)}s`;
  return `${Math.round(secs / 60)}min`;
}

function AtendimentoIAPage() {
  const navigate = useNavigate();

  // Feature em desenvolvimento — acesso restrito a admins, mesmo por URL direta
  // (o item de menu já só aparece para admin em app-shell.tsx, isso é a segunda trava).
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: u }) => {
      if (!u.user) { setIsAdmin(false); return; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("admins")
        .select("user_id")
        .eq("user_id", u.user.id)
        .maybeSingle();
      setIsAdmin(!!data);
    });
  }, []);

  const [periodo, setPeriodo]         = useState<Periodo>("30d");
  const [customInicio, setCustomInicio] = useState(toDateStr(new Date(Date.now() - 30 * 86400000)));
  const [customFim, setCustomFim]     = useState(toDateStr(new Date()));

  // ── Período ────────────────────────────────────────────────────────────────
  const { startDate, endDate } = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(23, 59, 59, 999);
    if (periodo === "7d")  return { startDate: new Date(Date.now() - 6  * 86400000), endDate: hoje };
    if (periodo === "15d") return { startDate: new Date(Date.now() - 14 * 86400000), endDate: hoje };
    if (periodo === "30d") return { startDate: new Date(Date.now() - 29 * 86400000), endDate: hoje };
    return {
      startDate: new Date(customInicio + "T00:00:00"),
      endDate:   new Date(customFim    + "T23:59:59"),
    };
  }, [periodo, customInicio, customFim]);

  const periodoLabel = useMemo(() => {
    if (periodo === "7d")  return "últimos 7 dias";
    if (periodo === "15d") return "últimos 15 dias";
    if (periodo === "30d") return "últimos 30 dias";
    return `${new Date(customInicio + "T00:00:00").toLocaleDateString("pt-BR")} – ${new Date(customFim + "T00:00:00").toLocaleDateString("pt-BR")}`;
  }, [periodo, customInicio, customFim]);

  // ── Query: métricas por período ────────────────────────────────────────────
  const metricsQuery = useQuery<MetricsData>({
    queryKey: ["ai-metrics", startDate.toISOString(), endDate.toISOString()],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Não autenticado");

      const start = startDate.toISOString();
      const end   = endDate.toISOString();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rows } = await (supabase as any)
        .from("ai_conversas")
        .select("numero, instancia_id, role, criado_em")
        .eq("usuario_id", uid)
        .gte("criado_em", start)
        .lte("criado_em", end)
        .order("criado_em", { ascending: true });

      const conversas = (rows ?? []) as ConversaRow[];

      const assistantMsgs = conversas.filter(c => c.role === "assistant");
      const userMsgs      = conversas.filter(c => c.role === "user");

      const totalMensagens = assistantMsgs.length;

      // Conversas únicas respondidas (número que recebeu ao menos uma resposta)
      const conversasRespondidas = new Set(assistantMsgs.map(c => `${c.instancia_id}|${c.numero}`)).size;

      // Tempo médio de resposta
      const avgSecs = calcAvgResponseSecs(conversas);

      // Conversas fora do horário comercial (contatos que enviaram mensagem fora de 9h-18h BRT)
      const foraHorarioSet = new Set<string>();
      for (const m of userMsgs) {
        if (isOutsideBusinessHours(m.criado_em)) {
          foraHorarioSet.add(`${m.instancia_id}|${m.numero}`);
        }
      }

      return {
        totalMensagens,
        conversasRespondidas,
        avgSecs,
        foraHorario: foraHorarioSet.size,
      } satisfies MetricsData;
    },
  });

  // ── Query: agentes configurados ──────────────────────────────────────────
  const agentsQuery = useQuery<AgentRow[]>({
    queryKey: ["ai-agents"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Não autenticado");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("ai_configuracoes")
        .select("instancia_id, ativo, provedor, instancias(nome, status)")
        .eq("usuario_id", uid)
        .order("criado_em", { ascending: false });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((r) => ({
        instancia_id: r.instancia_id,
        ativo: r.ativo,
        provedor: r.provedor,
        instancia_nome: r.instancias?.nome ?? "Instância removida",
        instancia_status: r.instancias?.status ?? "desconhecido",
      }));
    },
  });

  // ── Dados derivados ────────────────────────────────────────────────────────
  const md = metricsQuery.data;
  const agents = agentsQuery.data ?? [];
  const activeCount = agents.filter(a => a.ativo).length;

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isAdmin === null) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
        <p className="text-lg font-semibold">Acesso restrito</p>
        <p className="text-sm text-muted-foreground">Esta área ainda está em desenvolvimento e não está disponível.</p>
        <Button onClick={() => navigate({ to: "/dashboard" })}>Voltar ao Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-6 sm:space-y-8">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Atendimento com IA</h1>
          <p className="text-sm text-muted-foreground">
            Agente de IA ativo em {activeCount} instância{activeCount !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filtro de período */}
          <div className="flex items-center rounded-lg border bg-card p-0.5 gap-0.5">
            {(["7d", "15d", "30d"] as Periodo[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriodo(p)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  periodo === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p === "7d" ? "7 dias" : p === "15d" ? "15 dias" : "30 dias"}
              </button>
            ))}
            <button
              onClick={() => setPeriodo("custom")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                periodo === "custom" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" /> Personalizado
            </button>
          </div>
          {periodo === "custom" && (
            <div className="flex items-center gap-2">
              <Input type="date" value={customInicio} max={customFim} onChange={e => setCustomInicio(e.target.value)} className="h-8 w-36 text-sm" />
              <span className="text-sm text-muted-foreground">até</span>
              <Input type="date" value={customFim} min={customInicio} max={toDateStr(new Date())} onChange={e => setCustomFim(e.target.value)} className="h-8 w-36 text-sm" />
            </div>
          )}

          <Link to="/atendimento-ia/nova">
            <Button className="gap-2 shrink-0">
              <Plus className="w-4 h-4" />
              Criar Agente de IA
            </Button>
          </Link>
        </div>
      </div>

      {/* Métricas */}
      {metricsQuery.isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border rounded-xl overflow-hidden border">
          <MetricCard
            label="Conversas respondidas"
            value={md?.conversasRespondidas ?? 0}
            icon={MessageSquare}
            note={periodoLabel}
            active={(md?.conversasRespondidas ?? 0) > 0}
          />
          <MetricCard
            label="Mensagens do agente"
            value={md?.totalMensagens ?? 0}
            icon={Bot}
            note="respostas enviadas"
          />
          <MetricCard
            label="Tempo médio de resposta"
            value={formatResponseTime(md?.avgSecs ?? null)}
            icon={Clock}
            note="do recebimento ao envio"
            active={(md?.avgSecs ?? Infinity) < 30}
          />
          <MetricCard
            label="Fora do horário comercial"
            value={md?.foraHorario ?? 0}
            icon={Moon}
            note="conv. após 18h ou fim de semana"
          />
        </div>
      )}

      {/* Agentes configurados */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Agentes configurados
        </h2>

        {agentsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando agentes...
          </div>
        ) : agents.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8 bg-muted rounded-lg space-y-3">
            <p>Nenhum agente criado ainda.</p>
            <Link to="/atendimento-ia/nova">
              <Button size="sm" className="gap-2">
                <Plus className="w-3.5 h-3.5" />
                Criar Agente de IA
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {agents.map((a) => (
              <Link
                key={a.instancia_id}
                to="/atendimento-ia/$id"
                params={{ id: a.instancia_id }}
                className="flex items-center justify-between gap-3 border rounded-xl bg-card p-4 hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Smartphone className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{a.instancia_nome}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {PROVIDER_LABELS[a.provedor] ?? a.provedor}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${a.ativo ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
                    {a.ativo ? "Ativo" : "Inativo"}
                  </span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({
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
