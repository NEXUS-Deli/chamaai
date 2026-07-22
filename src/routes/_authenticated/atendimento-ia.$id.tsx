import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Loader2, Eye, EyeOff, Timer, Mic, Image as ImageIcon, Copy, Info, Users, Plus, Trash2, Clock, UserCog,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/atendimento-ia/$id")({
  component: AgenteIADetalhe,
});

interface ContatoExcluido {
  id: string;
  telefone: string;
  nome: string | null;
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

const DIAS_SEMANA = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

interface AgentData {
  instancia_id: string;
  instancia_nome: string;
  instancia_token: string;
  ativo: boolean;
  provedor: string;
  api_key: string;
  modelo: string;
  system_prompt: string;
  buffer_segundos: number;
  responder_audio: boolean;
  responder_imagem: boolean;
  openai_key_transcricao: string | null;
  restringir_horario: boolean;
  dias_semana: number[];
  horario_inicio: string;
  horario_fim: string;
  mensagem_fora_horario: string | null;
  transferencia_ativa: boolean;
  transferencia_telefone: string | null;
  transferencia_email: string | null;
}

function AgenteIADetalhe() {
  const { id: instanciaId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const agentQuery = useQuery<AgentData | null>({
    queryKey: ["ai-agent", instanciaId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("ai_configuracoes")
        .select("instancia_id, ativo, provedor, api_key, modelo, system_prompt, buffer_segundos, responder_audio, responder_imagem, openai_key_transcricao, restringir_horario, dias_semana, horario_inicio, horario_fim, mensagem_fora_horario, transferencia_ativa, transferencia_telefone, transferencia_email, instancias(nome, token)")
        .eq("instancia_id", instanciaId)
        .maybeSingle();

      if (!data) return null;
      return {
        instancia_id:           data.instancia_id,
        instancia_nome:         data.instancias?.nome ?? "Instância",
        instancia_token:        data.instancias?.token ?? "",
        ativo:                  data.ativo,
        provedor:               data.provedor,
        api_key:                data.api_key ?? "",
        modelo:                 data.modelo,
        system_prompt:          data.system_prompt ?? "",
        buffer_segundos:        data.buffer_segundos ?? 8,
        responder_audio:        data.responder_audio ?? true,
        responder_imagem:       data.responder_imagem ?? true,
        openai_key_transcricao: data.openai_key_transcricao,
        restringir_horario:     data.restringir_horario ?? false,
        dias_semana:            data.dias_semana ?? [1, 2, 3, 4, 5],
        horario_inicio:         data.horario_inicio ?? "09:00",
        horario_fim:            data.horario_fim ?? "18:00",
        mensagem_fora_horario:  data.mensagem_fora_horario,
        transferencia_ativa:    data.transferencia_ativa ?? false,
        transferencia_telefone: data.transferencia_telefone,
        transferencia_email:    data.transferencia_email,
      } satisfies AgentData;
    },
  });

  const [ativo, setAtivo]                   = useState(true);
  const [provedor, setProvedor]             = useState("openai");
  const [modelo, setModelo]                 = useState("gpt-4o-mini");
  const [apiKey, setApiKey]                 = useState("");
  const [showApiKey, setShowApiKey]         = useState(false);
  const [systemPrompt, setSystemPrompt]     = useState("");
  const [bufferSegundos, setBufferSegundos] = useState(8);
  const [responderAudio, setResponderAudio]     = useState(true);
  const [responderImagem, setResponderImagem]   = useState(true);
  const [openaiKeyTranscricao, setOpenaiKeyTranscricao] = useState("");

  const [restringirHorario, setRestringirHorario]       = useState(false);
  const [diasSemana, setDiasSemana]                     = useState<number[]>([1, 2, 3, 4, 5]);
  const [horarioInicio, setHorarioInicio]               = useState("09:00");
  const [horarioFim, setHorarioFim]                     = useState("18:00");
  const [mensagemForaHorario, setMensagemForaHorario]   = useState("");

  const [transferenciaAtiva, setTransferenciaAtiva]         = useState(false);
  const [transferenciaTelefone, setTransferenciaTelefone]   = useState("");
  const [transferenciaEmail, setTransferenciaEmail]         = useState("");

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const a = agentQuery.data;
    if (!a) return;
    setAtivo(a.ativo);
    setProvedor(a.provedor);
    setModelo(a.modelo);
    setApiKey(a.api_key);
    setSystemPrompt(a.system_prompt);
    setBufferSegundos(a.buffer_segundos);
    setResponderAudio(a.responder_audio);
    setResponderImagem(a.responder_imagem);
    setOpenaiKeyTranscricao(a.openai_key_transcricao ?? "");
    setRestringirHorario(a.restringir_horario);
    setDiasSemana(a.dias_semana);
    setHorarioInicio(a.horario_inicio);
    setHorarioFim(a.horario_fim);
    setMensagemForaHorario(a.mensagem_fora_horario ?? "");
    setTransferenciaAtiva(a.transferencia_ativa);
    setTransferenciaTelefone(a.transferencia_telefone ?? "");
    setTransferenciaEmail(a.transferencia_email ?? "");
  }, [agentQuery.data]);

  const toggleDia = (v: number) => {
    setDiasSemana(prev => prev.includes(v) ? prev.filter(d => d !== v) : [...prev, v].sort());
  };

  // Modal de contatos excluídos
  const [excludeOpen, setExcludeOpen]   = useState(false);
  const [excluidos, setExcluidos]       = useState<ContatoExcluido[]>([]);
  const [loadingExcl, setLoadingExcl]   = useState(false);
  const [novoTel, setNovoTel]           = useState("");
  const [novoNome, setNovoNome]         = useState("");
  const [addingExcl, setAddingExcl]     = useState(false);

  const fetchExcluidos = async () => {
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

  const openExcludeModal = async () => {
    setExcludeOpen(true);
    setNovoTel(""); setNovoNome("");
    await fetchExcluidos();
  };

  const addExcluido = async () => {
    if (!novoTel.trim()) return toast.error("Informe o telefone");
    setAddingExcl(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const telefone = novoTel.replace(/\D/g, "");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("ai_contatos_excluidos")
        .insert({ usuario_id: u.user.id, instancia_id: instanciaId, telefone, nome: novoNome.trim() || null });
      if (error) {
        if (error.code === "23505") throw new Error("Este contato já está na lista de exclusão");
        throw new Error(error.message);
      }
      setNovoTel(""); setNovoNome("");
      await fetchExcluidos();
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

  const copyWebhookUrl = () => {
    const a = agentQuery.data;
    if (!a?.instancia_token) return;
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-agent-webhook?token=${a.instancia_token}`;
    navigator.clipboard.writeText(url);
    toast.success("URL do webhook de IA copiada!");
  };

  const salvar = async () => {
    if (!apiKey.trim()) return toast.error("Informe a chave de API");
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("ai_configuracoes")
        .update({
          ativo,
          provedor,
          api_key:                apiKey.trim(),
          modelo,
          system_prompt:          systemPrompt,
          buffer_segundos:        Math.max(0, Math.min(45, Math.round(bufferSegundos))),
          responder_audio:        responderAudio,
          responder_imagem:       responderImagem,
          openai_key_transcricao: openaiKeyTranscricao.trim() || null,
          restringir_horario:     restringirHorario,
          dias_semana:            diasSemana,
          horario_inicio:         horarioInicio,
          horario_fim:            horarioFim,
          mensagem_fora_horario:  mensagemForaHorario.trim() || null,
          transferencia_ativa:    transferenciaAtiva,
          transferencia_telefone: transferenciaTelefone.replace(/\D/g, "") || null,
          transferencia_email:    transferenciaEmail.trim() || null,
          atualizado_em:          new Date().toISOString(),
        })
        .eq("instancia_id", instanciaId);

      if (error) throw new Error(error.message);
      toast.success("Configurações salvas com sucesso!");
      qc.invalidateQueries({ queryKey: ["ai-agent", instanciaId] });
      qc.invalidateQueries({ queryKey: ["ai-agents"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar configurações");
    } finally {
      setSaving(false);
    }
  };

  const apagar = async () => {
    setDeleting(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("ai_configuracoes")
        .delete()
        .eq("instancia_id", instanciaId);
      if (error) throw new Error(error.message);
      toast.success("Agente apagado");
      qc.invalidateQueries({ queryKey: ["ai-agents"] });
      navigate({ to: "/atendimento-ia" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao apagar agente");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const currentModels = MODELS_BY_PROVIDER[provedor] ?? MODELS_BY_PROVIDER.openai;

  if (agentQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!agentQuery.data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
        <p className="text-lg font-semibold">Agente não encontrado</p>
        <Link to="/atendimento-ia"><Button>Voltar para Atendimento com IA</Button></Link>
      </div>
    );
  }

  const a = agentQuery.data;

  return (
    <div className="p-4 sm:p-8 w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{a.instancia_nome}</h1>
          <p className="text-sm text-muted-foreground mt-1">Configurações do agente de IA</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground">{ativo ? "Ativo" : "Inativo"}</span>
          <Switch checked={ativo} onCheckedChange={setAtivo} />
        </div>
      </div>

      <Card className="p-6 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Provedor de IA</Label>
            <Select
              value={provedor}
              onValueChange={(v) => {
                setProvedor(v);
                setModelo(MODELS_BY_PROVIDER[v]?.[0]?.value ?? "");
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Modelo</Label>
            <Select value={modelo} onValueChange={setModelo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {currentModels.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Chave de API</Label>
          <div className="relative">
            <Input
              type={showApiKey ? "text" : "password"}
              placeholder="sk-... / AIza... / gsk_..."
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
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
        </div>

        <div className="space-y-1.5">
          <Label>Prompt do sistema</Label>
          <Textarea
            rows={4}
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            className="resize-none text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Define a personalidade e o comportamento do agente. Descreva o tom, os temas que deve responder e o que deve evitar.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            <Timer className="w-3.5 h-3.5 text-muted-foreground" />
            Tempo de agrupamento de mensagens (segundos)
          </Label>
          <Input
            type="number"
            min={0}
            max={45}
            value={bufferSegundos}
            onChange={e => {
              const v = Number(e.target.value);
              setBufferSegundos(Number.isFinite(v) ? Math.max(0, Math.min(45, v)) : 0);
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
            <Switch checked={responderAudio} onCheckedChange={setResponderAudio} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex items-center gap-2 min-w-0">
              <ImageIcon className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Analisar imagens</p>
                <p className="text-xs text-muted-foreground">Permite ao agente "ver" e comentar imagens recebidas</p>
              </div>
            </div>
            <Switch checked={responderImagem} onCheckedChange={setResponderImagem} />
          </div>
        </div>

        {responderAudio && provedor !== "openai" && (
          <div className="space-y-1.5">
            <Label>Chave de API OpenAI (para transcrição de áudio)</Label>
            <Input
              type="password"
              placeholder="sk-..."
              value={openaiKeyTranscricao}
              onChange={e => setOpenaiKeyTranscricao(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              A transcrição de áudio usa o Whisper da OpenAI independente do provedor de chat escolhido acima. Informe uma chave OpenAI aqui para transcrever áudios com {PROVIDERS.find(p => p.value === provedor)?.label ?? provedor}.
            </p>
          </div>
        )}

        {/* Horário comercial */}
        <div className="rounded-lg border p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Restringir a horário comercial</p>
                <p className="text-xs text-muted-foreground">Fora do horário/dias configurados, a IA não responde — só a mensagem automática abaixo, se houver</p>
              </div>
            </div>
            <Switch checked={restringirHorario} onCheckedChange={setRestringirHorario} />
          </div>

          {restringirHorario && (
            <div className="space-y-3 pt-1">
              <div className="space-y-1.5">
                <Label className="text-xs">Dias de funcionamento</Label>
                <div className="flex flex-wrap gap-1.5">
                  {DIAS_SEMANA.map(d => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleDia(d.value)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                        diasSemana.includes(d.value) ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Início</Label>
                  <Input type="time" value={horarioInicio} onChange={e => setHorarioInicio(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Fim</Label>
                  <Input type="time" value={horarioFim} onChange={e => setHorarioFim(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Mensagem fora do horário (opcional)</Label>
                <Textarea
                  rows={2}
                  placeholder="Nosso atendimento funciona de seg a sex, das 9h às 18h. Retornaremos assim que possível!"
                  value={mensagemForaHorario}
                  onChange={e => setMensagemForaHorario(e.target.value)}
                  className="resize-none text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* Transferência para humano */}
        <div className="rounded-lg border p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <UserCog className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Permitir transferência para atendimento humano</p>
                <p className="text-xs text-muted-foreground">A própria IA decide quando o cliente precisa de um atendente e avisa o contato configurado</p>
              </div>
            </div>
            <Switch checked={transferenciaAtiva} onCheckedChange={setTransferenciaAtiva} />
          </div>

          {transferenciaAtiva && (
            <div className="space-y-3 pt-1">
              <div className="space-y-1.5">
                <Label className="text-xs">Telefone para aviso (WhatsApp)</Label>
                <Input placeholder="Ex: 11999990000" value={transferenciaTelefone} onChange={e => setTransferenciaTelefone(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">E-mail de contato (opcional)</Label>
                <Input type="email" placeholder="atendimento@empresa.com" value={transferenciaEmail} onChange={e => setTransferenciaEmail(e.target.value)} className="text-sm" />
                <p className="text-xs text-muted-foreground">Usado só como anotação — o aviso automático vai por WhatsApp e pela notificação do painel. E-mail ainda não é enviado automaticamente.</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={salvar} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Salvar Configurações
          </Button>
          <Button variant="outline" onClick={openExcludeModal} className="gap-2">
            <Users className="w-4 h-4" />
            Contatos Excluídos
          </Button>
        </div>
      </Card>

      {/* Webhook + instruções */}
      <Card className="p-6 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Info className="w-4 h-4 text-primary" />
          Como configurar na UAZAPI
        </h3>
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/50 border text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
            <span className="truncate font-mono">.../ai-agent-webhook?token=…</span>
          </div>
          <button
            title="Copiar URL do webhook de IA"
            onClick={copyWebhookUrl}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
        <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>Copie a URL do webhook acima.</li>
          <li>No painel da UAZAPI, abra a configuração desta instância.</li>
          <li>Adicione a URL como webhook para o evento <strong className="text-foreground">messages</strong>.</li>
          <li>Com o agente ativo, ele passará a responder automaticamente mensagens de texto recebidas.</li>
        </ol>
      </Card>

      <div className="flex justify-end">
        <Button variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="w-4 h-4 mr-2" />
          Apagar agente
        </Button>
      </div>

      {/* Modal: Contatos Excluídos */}
      <Dialog open={excludeOpen} onOpenChange={setExcludeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Contatos Excluídos
            </DialogTitle>
            <DialogDescription>
              {a.instancia_nome} — O agente de IA não responderá a estes contatos.
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

      {/* Confirmação de exclusão do agente */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar agente de IA</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza de que deseja apagar o agente de "{a.instancia_nome}"? A configuração será removida e o agente deixará de responder mensagens nesta instância.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={apagar}
              disabled={deleting}
            >
              {deleting ? "Apagando..." : "Apagar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
