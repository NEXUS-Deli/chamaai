import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Bot, Smartphone, Copy, Trash2, Plus, Loader2, Eye, EyeOff,
  Info, Users, ChevronDown, ChevronUp, CalendarDays,
  MessageSquare, Clock, Moon, CheckCircle2, Timer, Mic, Image as ImageIcon,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/atendimento-ia")({
  component: AtendimentoIAPage,
});

type Periodo = "7d" | "15d" | "30d" | "custom";

interface AIConfig {
  provedor: string;
  api_key: string;
  modelo: string;
  system_prompt: string;
  buffer_segundos: number;
  responder_audio: boolean;
  responder_imagem: boolean;
  openai_key_transcricao: string;
}

interface Instancia {
  id: string;
  nome: string;
  token: string;
  status: string;
}

interface AIInstancia {
  instancia_id: string;
  ativo: boolean;
}

interface ContatoExcluido {
  id: string;
  telefone: string;
  nome: string | null;
}

interface ConversaRow {
  numero: string;
  instancia_id: string;
  role: "user" | "assistant";
  criado_em: string;
}

interface SettingsData {
  instancias: Instancia[];
  config: AIConfig | null;
  aiInstMap: Record<string, boolean>;
}

interface MetricsData {
  totalMensagens: number;
  conversasRespondidas: number;
  avgSecs: number | null;
  foraHorario: number;
}

const PROVIDERS = [
  { value: "openai",  label: "OpenAI (ChatGPT)" },
  { value: "claude",  label: "Anthropic (Claude)" },
  { value: "gemini",  label: "Google (Gemini)" },
  { value: "groq",    label: "Groq (Llama / Mistral)" },
] as const;

const MODELS_BY_PROVIDER: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: "gpt-4o-mini",    label: "GPT-4o Mini (rápido e econômico)" },
    { value: "gpt-4o",         label: "GPT-4o (mais inteligente)" },
    { value: "gpt-4-turbo",    label: "GPT-4 Turbo" },
    { value: "gpt-3.5-turbo",  label: "GPT-3.5 Turbo (mais barato)" },
  ],
  claude: [
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku (rápido e econômico)" },
    { value: "claude-sonnet-5",           label: "Claude Sonnet (balanceado)" },
    { value: "claude-opus-4-8",           label: "Claude Opus (mais inteligente)" },
  ],
  gemini: [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash (rápido)" },
    { value: "gemini-1.5-pro",   label: "Gemini 1.5 Pro (mais inteligente)" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash (econômico)" },
  ],
  groq: [
    { value: "llama-3.1-8b-instant",      label: "Llama 3.1 8B (ultra rápido)" },
    { value: "llama-3.3-70b-versatile",   label: "Llama 3.3 70B (mais inteligente)" },
    { value: "mixtral-8x7b-32768",        label: "Mixtral 8x7B" },
    { value: "gemma2-9b-it",              label: "Gemma 2 9B" },
  ],
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
  const qc = useQueryClient();
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

  // Configurações de IA (formulário local)
  const [aiConfig, setAIConfig] = useState<AIConfig>({
    provedor: "openai",
    api_key: "",
    modelo: "gpt-4o-mini",
    system_prompt: "Você é um assistente útil do WhatsApp. Responda de forma breve, natural e em português.",
    buffer_segundos: 8,
    responder_audio: true,
    responder_imagem: true,
    openai_key_transcricao: "",
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [showApiKey, setShowApiKey]     = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [togglingId, setTogglingId]     = useState<string | null>(null);

  // Modal de exclusão
  const [excludeModal, setExcludeModal] = useState<{ open: boolean; instancia: Instancia | null }>({ open: false, instancia: null });
  const [excluidos, setExcluidos]       = useState<ContatoExcluido[]>([]);
  const [loadingExcl, setLoadingExcl]   = useState(false);
  const [novoTel, setNovoTel]           = useState("");
  const [novoNome, setNovoNome]         = useState("");
  const [addingExcl, setAddingExcl]     = useState(false);

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

  // ── Query: configurações + instâncias (independente do período) ─────────────
  const settingsQuery = useQuery<SettingsData>({
    queryKey: ["ai-settings"],
    queryFn: async (): Promise<SettingsData> => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Não autenticado");

      const [instRes, configRes, aiInstRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("instancias")
          .select("id, nome, token, status")
          .eq("usuario_id", uid)
          .neq("instancia", "r1b5f62949ba437")
          .order("criada_em", { ascending: false }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("ai_configuracoes")
          .select("provedor, api_key, modelo, system_prompt, buffer_segundos, responder_audio, responder_imagem, openai_key_transcricao")
          .eq("usuario_id", uid)
          .maybeSingle(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("ai_instancias")
          .select("instancia_id, ativo")
          .eq("usuario_id", uid),
      ]);

      const config = (configRes.data ?? null) as AIConfig | null;
      const aiInstMap: Record<string, boolean> = {};
      for (const ai of ((aiInstRes.data ?? []) as AIInstancia[])) {
        aiInstMap[ai.instancia_id] = ai.ativo;
      }

      return {
        instancias: (instRes.data ?? []) as Instancia[],
        config,
        aiInstMap,
      };
    },
  });

  // Sincroniza o formulário quando os dados chegam
  useEffect(() => {
    const cfg = settingsQuery.data?.config;
    if (cfg) {
      setAIConfig({
        provedor:               cfg.provedor               ?? "openai",
        api_key:                cfg.api_key                ?? "",
        modelo:                 cfg.modelo                 ?? "gpt-4o-mini",
        system_prompt:          cfg.system_prompt          ?? "",
        buffer_segundos:        cfg.buffer_segundos        ?? 8,
        responder_audio:        cfg.responder_audio        ?? true,
        responder_imagem:       cfg.responder_imagem       ?? true,
        openai_key_transcricao: cfg.openai_key_transcricao ?? "",
      });
      setSettingsOpen(false);
    } else if (settingsQuery.isSuccess) {
      setSettingsOpen(true);
    }
  }, [settingsQuery.data, settingsQuery.isSuccess]);

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

  // ── Ações ──────────────────────────────────────────────────────────────────
  const saveConfig = async () => {
    if (!aiConfig.api_key.trim()) return toast.error("Informe a chave de API");
    setSavingConfig(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("ai_configuracoes")
        .upsert({
          usuario_id:             u.user.id,
          provedor:               aiConfig.provedor,
          api_key:                aiConfig.api_key.trim(),
          modelo:                 aiConfig.modelo,
          system_prompt:          aiConfig.system_prompt,
          buffer_segundos:        Math.max(0, Math.min(45, Math.round(aiConfig.buffer_segundos))),
          responder_audio:        aiConfig.responder_audio,
          responder_imagem:       aiConfig.responder_imagem,
          openai_key_transcricao: aiConfig.openai_key_transcricao.trim() || null,
          atualizado_em:          new Date().toISOString(),
        }, { onConflict: "usuario_id" });

      if (error) throw new Error(error.message);
      toast.success("Configurações salvas com sucesso!");
      setSettingsOpen(false);
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar configurações");
    } finally {
      setSavingConfig(false);
    }
  };

  const toggleInstancia = async (inst: Instancia, novoValor: boolean) => {
    setTogglingId(inst.id);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("ai_instancias")
        .upsert({ usuario_id: u.user.id, instancia_id: inst.id, ativo: novoValor }, { onConflict: "instancia_id" });

      if (error) throw new Error(error.message);
      qc.setQueryData<SettingsData>(["ai-settings"], (old) =>
        old ? { ...old, aiInstMap: { ...old.aiInstMap, [inst.id]: novoValor } } : old
      );
      toast.success(novoValor ? `Agente ativado em ${inst.nome}` : `Agente desativado em ${inst.nome}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar agente");
    } finally {
      setTogglingId(null);
    }
  };

  const openExcludeModal = async (inst: Instancia) => {
    setExcludeModal({ open: true, instancia: inst });
    setNovoTel(""); setNovoNome("");
    await fetchExcluidos(inst.id);
  };

  const fetchExcluidos = async (instanciaId: string) => {
    setLoadingExcl(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("ai_contatos_excluidos")
      .select("id, telefone, nome")
      .eq("instancia_id", instanciaId)
      .order("criado_em", { ascending: false });
    setExcluidos((data ?? []) as ContatoExcluido[]);
    setLoadingExcl(false);
  };

  const addExcluido = async () => {
    if (!novoTel.trim()) return toast.error("Informe o telefone");
    if (!excludeModal.instancia) return;
    setAddingExcl(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const telefone = novoTel.replace(/\D/g, "");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("ai_contatos_excluidos")
        .insert({ usuario_id: u.user.id, instancia_id: excludeModal.instancia.id, telefone, nome: novoNome.trim() || null });
      if (error) {
        if (error.code === "23505") throw new Error("Este contato já está na lista de exclusão");
        throw new Error(error.message);
      }
      setNovoTel(""); setNovoNome("");
      await fetchExcluidos(excludeModal.instancia.id);
      toast.success("Contato adicionado à exclusão");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao adicionar contato");
    } finally {
      setAddingExcl(false);
    }
  };

  const removeExcluido = async (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("ai_contatos_excluidos").delete().eq("id", id);
    if (error) return toast.error("Erro ao remover contato");
    setExcluidos(prev => prev.filter(c => c.id !== id));
    toast.success("Contato removido da exclusão");
  };

  const copyWebhookUrl = (token: string) => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-agent-webhook?token=${token}`;
    navigator.clipboard.writeText(url);
    toast.success("URL do webhook de IA copiada!");
  };

  // ── Dados derivados ────────────────────────────────────────────────────────
  const sd = settingsQuery.data;
  const md = metricsQuery.data;
  const hasConfig  = Boolean(sd?.config?.api_key);
  const activeCount = sd ? Object.values(sd.aiInstMap).filter(Boolean).length : 0;
  const currentModels = MODELS_BY_PROVIDER[aiConfig.provedor] ?? MODELS_BY_PROVIDER.openai;

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
          <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Bot className="w-7 h-7 text-primary" />
            Atendimento com IA
          </h1>
          <p className="text-base text-muted-foreground mt-1">
            Agente de IA ativo em {activeCount} instância{activeCount !== 1 ? "s" : ""}
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

      {/* Configurações do agente */}
      <div className="border rounded-xl overflow-hidden bg-card">
        <button
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-muted/40 transition-colors"
          onClick={() => setSettingsOpen(o => !o)}
        >
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${hasConfig ? "bg-green-100 dark:bg-green-900/30" : "bg-muted"}`}>
              {hasConfig
                ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                : <Bot className="w-4 h-4 text-muted-foreground" />
              }
            </div>
            <div>
              <p className="font-semibold text-sm">Configurações do Agente de IA</p>
              <p className="text-xs text-muted-foreground">
                {hasConfig
                  ? `Provedor: ${PROVIDERS.find(p => p.value === sd?.config?.provedor)?.label ?? sd?.config?.provedor}`
                  : "Clique para configurar o provedor e a chave de API"}
              </p>
            </div>
          </div>
          {settingsOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {settingsOpen && (
          <div className="px-6 pb-6 space-y-4 border-t pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Provedor de IA</label>
                <Select
                  value={aiConfig.provedor}
                  onValueChange={(v) => {
                    const defaultModel = MODELS_BY_PROVIDER[v]?.[0]?.value ?? "";
                    setAIConfig(c => ({ ...c, provedor: v, modelo: defaultModel }));
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Modelo</label>
                <Select value={aiConfig.modelo} onValueChange={(v) => setAIConfig(c => ({ ...c, modelo: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {currentModels.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Chave de API</label>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  placeholder="sk-... / AIza... / gsk_..."
                  value={aiConfig.api_key}
                  onChange={e => setAIConfig(c => ({ ...c, api_key: e.target.value }))}
                  className="pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowApiKey(v => !v)}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">A chave fica armazenada no Supabase e nunca é exposta no navegador.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Prompt do sistema</label>
              <Textarea
                rows={4}
                placeholder="Você é um assistente útil do WhatsApp..."
                value={aiConfig.system_prompt}
                onChange={e => setAIConfig(c => ({ ...c, system_prompt: e.target.value }))}
                className="resize-none text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Define a personalidade e o comportamento do agente. Descreva o tom, os temas que deve responder e o que deve evitar.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Timer className="w-3.5 h-3.5 text-muted-foreground" />
                Tempo de agrupamento de mensagens (segundos)
              </label>
              <Input
                type="number"
                min={0}
                max={45}
                value={aiConfig.buffer_segundos}
                onChange={e => {
                  const v = Number(e.target.value);
                  setAIConfig(c => ({ ...c, buffer_segundos: Number.isFinite(v) ? Math.max(0, Math.min(45, v)) : 0 }));
                }}
                className="w-28 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Quando o contato manda várias mensagens picadas, o agente espera esse tempo de silêncio antes de responder, juntando tudo em uma única resposta. Use <strong className="text-foreground">0</strong> para responder imediatamente a cada mensagem. Recomendado: 5–15s.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Mic className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Transcrever áudios</p>
                    <p className="text-xs text-muted-foreground">Converte mensagens de voz em texto antes de responder</p>
                  </div>
                </div>
                <Switch
                  checked={aiConfig.responder_audio}
                  onCheckedChange={(v) => setAIConfig(c => ({ ...c, responder_audio: v }))}
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="flex items-center gap-2 min-w-0">
                  <ImageIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Analisar imagens</p>
                    <p className="text-xs text-muted-foreground">Permite ao agente "ver" e comentar imagens recebidas</p>
                  </div>
                </div>
                <Switch
                  checked={aiConfig.responder_imagem}
                  onCheckedChange={(v) => setAIConfig(c => ({ ...c, responder_imagem: v }))}
                />
              </div>
            </div>

            {aiConfig.responder_audio && aiConfig.provedor !== "openai" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Chave de API OpenAI (para transcrição de áudio)</label>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={aiConfig.openai_key_transcricao}
                  onChange={e => setAIConfig(c => ({ ...c, openai_key_transcricao: e.target.value }))}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  A transcrição de áudio usa o Whisper da OpenAI independente do provedor de chat escolhido acima. Informe uma chave OpenAI aqui para transcrever áudios com {PROVIDERS.find(p => p.value === aiConfig.provedor)?.label ?? aiConfig.provedor}.
                </p>
              </div>
            )}

            <Button onClick={saveConfig} disabled={savingConfig}>
              {savingConfig && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Salvar Configurações
            </Button>
          </div>
        )}
      </div>

      {!hasConfig && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-700 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Configure o provedor de IA e a chave de API acima antes de ativar o agente em uma instância.</span>
        </div>
      )}

      {/* Instâncias */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-muted-foreground" />
          Instâncias WhatsApp
        </h2>

        {settingsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando instâncias...
          </div>
        ) : (sd?.instancias ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8 bg-muted rounded-lg">
            Nenhuma instância encontrada. Crie uma em <strong>Conexões</strong> primeiro.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {(sd?.instancias ?? []).map((inst) => {
              const ativo = sd?.aiInstMap[inst.id] ?? false;
              const isToggling = togglingId === inst.id;
              return (
                <div key={inst.id} className="border rounded-xl bg-card p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm flex items-center gap-2 truncate">
                        <Smartphone className="w-4 h-4 text-primary shrink-0" />
                        <span className="truncate">{inst.nome}</span>
                      </h3>
                      <div className="mt-1 flex items-center gap-1.5 text-xs">
                        <span className={`w-1.5 h-1.5 rounded-full ${inst.status === "connected" ? "bg-green-500" : "bg-gray-400"}`} />
                        <span className={inst.status === "connected" ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
                          {inst.status === "connected" ? "Conectado" : "Desconectado"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{ativo ? "Ativo" : "Inativo"}</span>
                      <Switch
                        checked={ativo}
                        onCheckedChange={(v) => toggleInstancia(inst, v)}
                        disabled={isToggling || !hasConfig}
                      />
                    </div>
                  </div>

                  {ativo && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/50 border text-xs">
                        <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
                          <Info className="w-3 h-3 shrink-0" />
                          <span className="truncate font-mono">.../ai-agent-webhook?token=…</span>
                        </div>
                        <button
                          title="Copiar URL do webhook de IA"
                          onClick={() => copyWebhookUrl(inst.token)}
                          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <Button variant="outline" size="sm" className="w-full text-xs h-8" onClick={() => openExcludeModal(inst)}>
                        <Users className="w-3.5 h-3.5 mr-1.5" />
                        Contatos Excluídos
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Instruções */}
      {hasConfig && (sd?.instancias ?? []).length > 0 && (
        <div className="border rounded-xl bg-muted/30 p-5 space-y-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Info className="w-4 h-4 text-primary" />
            Como configurar na UAZAPI
          </h3>
          <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
            <li>Ative o agente na instância desejada usando o toggle acima.</li>
            <li>Copie a URL do webhook clicando no ícone de cópia.</li>
            <li>No painel da UAZAPI, abra a configuração da instância.</li>
            <li>Adicione a URL como webhook para o evento <strong className="text-foreground">messages</strong>.</li>
            <li>O agente passará a responder automaticamente mensagens de texto recebidas.</li>
          </ol>
          <p className="text-xs text-muted-foreground border-t pt-3">
            Mantenha o <strong className="text-foreground">disparo-webhook</strong> configurado separadamente (evento <strong className="text-foreground">messages_update</strong>) para rastreamento de entrega de campanhas.
          </p>
        </div>
      )}

      {/* Modal: Contatos Excluídos */}
      <Dialog open={excludeModal.open} onOpenChange={(open) => !open && setExcludeModal({ open: false, instancia: null })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Contatos Excluídos
            </DialogTitle>
            <DialogDescription>
              {excludeModal.instancia?.nome} — O agente de IA não responderá a estes contatos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
              <p className="text-xs font-medium text-muted-foreground">Adicionar contato</p>
              <div className="flex gap-2">
                <Input placeholder="Telefone (ex: 11999990000)" value={novoTel} onChange={e => setNovoTel(e.target.value)} className="text-sm" onKeyDown={e => e.key === "Enter" && addExcluido()} />
                <Input placeholder="Nome (opcional)" value={novoNome} onChange={e => setNovoNome(e.target.value)} className="text-sm" />
              </div>
              <Button size="sm" onClick={addExcluido} disabled={addingExcl || !novoTel.trim()} className="w-full">
                {addingExcl ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
                Adicionar
              </Button>
            </div>

            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {loadingExcl ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando...
                </div>
              ) : excluidos.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum contato excluído.</p>
              ) : (
                excluidos.map(c => (
                  <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-background">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{c.nome || c.telefone}</p>
                      {c.nome && <p className="text-xs text-muted-foreground font-mono">{c.telefone}</p>}
                    </div>
                    <button
                      onClick={() => removeExcluido(c.id)}
                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
