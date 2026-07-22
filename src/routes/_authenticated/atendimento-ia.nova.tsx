import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff, Timer, Mic, Image as ImageIcon, Smartphone, Clock, UserCog } from "lucide-react";

export const Route = createFileRoute("/_authenticated/atendimento-ia/nova")({
  component: NovoAgenteIA,
});

interface Instancia {
  id: string;
  nome: string;
  status: string;
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

function NovoAgenteIA() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const disponiveisQuery = useQuery<Instancia[]>({
    queryKey: ["ai-instancias-disponiveis"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Não autenticado");

      const [instRes, configRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("instancias")
          .select("id, nome, status")
          .eq("usuario_id", uid)
          .neq("instancia", "r1b5f62949ba437")
          .order("criada_em", { ascending: false }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("ai_configuracoes")
          .select("instancia_id")
          .eq("usuario_id", uid),
      ]);

      const jaConfiguradas = new Set(((configRes.data ?? []) as { instancia_id: string }[]).map(r => r.instancia_id));
      return ((instRes.data ?? []) as Instancia[]).filter(i => !jaConfiguradas.has(i.id));
    },
  });

  const [instanciaId, setInstanciaId] = useState<string>("");
  useEffect(() => {
    if (!instanciaId && disponiveisQuery.data && disponiveisQuery.data.length > 0) {
      setInstanciaId(disponiveisQuery.data[0].id);
    }
  }, [disponiveisQuery.data, instanciaId]);

  const [provedor, setProvedor]             = useState("openai");
  const [modelo, setModelo]                 = useState("gpt-4o-mini");
  const [apiKey, setApiKey]                 = useState("");
  const [showApiKey, setShowApiKey]         = useState(false);
  const [systemPrompt, setSystemPrompt]     = useState("Você é um assistente útil do WhatsApp. Responda de forma breve, natural e em português.");
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

  const currentModels = MODELS_BY_PROVIDER[provedor] ?? MODELS_BY_PROVIDER.openai;

  const toggleDia = (v: number) => {
    setDiasSemana(prev => prev.includes(v) ? prev.filter(d => d !== v) : [...prev, v].sort());
  };

  const salvar = async () => {
    if (!instanciaId) return toast.error("Selecione uma instância");
    if (!apiKey.trim()) return toast.error("Informe a chave de API");
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("ai_configuracoes")
        .insert({
          usuario_id:             u.user.id,
          instancia_id:           instanciaId,
          ativo:                  true,
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
        });

      if (error) throw new Error(error.message);
      toast.success("Agente de IA criado com sucesso!");
      qc.invalidateQueries({ queryKey: ["ai-agents"] });
      navigate({ to: "/atendimento-ia/$id", params: { id: instanciaId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar agente");
    } finally {
      setSaving(false);
    }
  };

  const instancias = disponiveisQuery.data ?? [];

  return (
    <div className="p-4 sm:p-8 w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Criar Agente de IA</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure um agente de atendimento automático para uma instância WhatsApp.</p>
      </div>

      {disponiveisQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando instâncias...
        </div>
      ) : instancias.length === 0 ? (
        <Card className="p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Todas as suas instâncias já têm um agente configurado.</p>
          <Link to="/atendimento-ia" className="text-sm font-medium text-primary hover:underline">
            Voltar para Atendimento com IA
          </Link>
        </Card>
      ) : (
        <Card className="p-6 space-y-4">
          <div className="space-y-1.5">
            <Label>Instância WhatsApp</Label>
            <Select value={instanciaId} onValueChange={setInstanciaId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {instancias.map(i => (
                  <SelectItem key={i.id} value={i.id}>
                    <span className="flex items-center gap-2">
                      <Smartphone className="w-3.5 h-3.5" />
                      {i.nome}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
              placeholder="Você é um assistente útil do WhatsApp..."
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

          <Button onClick={salvar} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Criar Agente
          </Button>
        </Card>
      )}
    </div>
  );
}
