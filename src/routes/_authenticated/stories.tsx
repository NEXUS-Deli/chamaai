import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Plus, Clapperboard, Clock, CheckCircle2, XCircle, Loader2,
  Trash2, Send, Image, Video, Type, CalendarClock, AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/stories")({
  component: StoriesPage,
});

interface Instancia { id: string; nome: string; token: string }
interface Agendamento {
  id: string;
  titulo: string;
  tipo: "text" | "image" | "video";
  texto: string | null;
  background_color: number | null;
  agendado_para: string;
  status: "pendente" | "enviando" | "enviado" | "erro" | "cancelado";
  instancias_ids: string[];
  resultado: Record<string, unknown> | null;
  criado_em: string;
}

const CORES: { index: number; label: string; hex: string }[] = [
  { index: 1,  label: "Amarelo esverdeado", hex: "#c8e6c9" },
  { index: 3,  label: "Amarelo vibrante",   hex: "#ffcc02" },
  { index: 4,  label: "Verde vibrante",     hex: "#00a859" },
  { index: 7,  label: "Azul piscina",       hex: "#00bcd4" },
  { index: 8,  label: "Azul intenso",       hex: "#1565c0" },
  { index: 11, label: "Lilás quente",       hex: "#ce93d8" },
  { index: 13, label: "Magenta",            hex: "#ad1457" },
  { index: 14, label: "Rosa suave",         hex: "#f48fb1" },
  { index: 16, label: "Marrom claro",       hex: "#a1887f" },
  { index: 19, label: "Cinza escuro",       hex: "#37474f" },
];

const STATUS_CONFIG = {
  pendente:  { label: "Agendado",  color: "bg-blue-100 text-blue-700",   icon: Clock },
  enviando:  { label: "Enviando",  color: "bg-yellow-100 text-yellow-700", icon: Loader2 },
  enviado:   { label: "Enviado",   color: "bg-green-100 text-green-700",  icon: CheckCircle2 },
  erro:      { label: "Erro",      color: "bg-red-100 text-red-700",      icon: XCircle },
  cancelado: { label: "Cancelado", color: "bg-gray-100 text-gray-600",    icon: XCircle },
};

function StoriesPage() {
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const [{ data: ags }, { data: insts }] = await Promise.all([
      (supabase as any)
        .from("stories_agendamentos")
        .select("id,titulo,tipo,texto,background_color,agendado_para,status,instancias_ids,resultado,criado_em")
        .eq("usuario_id", u.user.id)
        .order("agendado_para", { ascending: false })
        .limit(50),
      supabase.from("instancias").select("id,nome,token").eq("usuario_id", u.user.id),
    ]);
    setAgendamentos(((ags ?? []) as Agendamento[]));
    setInstancias(insts ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const cancelar = async (id: string) => {
    if (!confirm("Cancelar este agendamento?")) return;
    const { error } = await (supabase as any)
      .from("stories_agendamentos")
      .update({ status: "cancelado" })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Agendamento cancelado");
    load();
  };

  const excluir = async (id: string) => {
    if (!confirm("Excluir permanentemente?")) return;
    await (supabase as any).from("stories_agendamentos").delete().eq("id", id);
    toast.success("Excluído");
    load();
  };

  const pendentes = agendamentos.filter((a) => ["pendente","enviando"].includes(a.status));
  const historico = agendamentos.filter((a) => ["enviado","erro","cancelado"].includes(a.status));

  return (
    <div className="p-4 sm:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Agendamento de Stories</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Programe a postagem automática de stories nos seus WhatsApps conectados.
          </p>
        </div>
        <Button onClick={() => setModalAberto(true)} className="gap-2 shrink-0">
          <Plus className="w-4 h-4" /> Novo agendamento
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Agendados",  value: agendamentos.filter((a) => a.status === "pendente").length,  color: "text-blue-600" },
          { label: "Enviados",   value: agendamentos.filter((a) => a.status === "enviado").length,   color: "text-green-600" },
          { label: "Com erro",   value: agendamentos.filter((a) => a.status === "erro").length,      color: "text-destructive" },
          { label: "Instâncias", value: instancias.length,                                            color: "text-primary" },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </Card>
        ))}
      </div>

      {/* Aviso sem instâncias */}
      {instancias.length === 0 && !loading && (
        <div className="flex gap-3 bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          Nenhuma instância conectada. Configure em <span className="font-medium ml-1">Conexões</span>.
        </div>
      )}

      {/* Agendamentos pendentes */}
      {pendentes.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Próximos agendamentos
          </h2>
          {pendentes.map((a) => (
            <AgendamentoCard
              key={a.id}
              ag={a}
              instancias={instancias}
              onCancelar={cancelar}
              onExcluir={excluir}
            />
          ))}
        </div>
      )}

      {/* Histórico */}
      {historico.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Histórico
          </h2>
          {historico.map((a) => (
            <AgendamentoCard
              key={a.id}
              ag={a}
              instancias={instancias}
              onCancelar={cancelar}
              onExcluir={excluir}
            />
          ))}
        </div>
      )}

      {!loading && agendamentos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground space-y-3">
          <Clapperboard className="w-12 h-12 opacity-20" />
          <p className="text-sm">Nenhum story agendado ainda.<br />Clique em "Novo agendamento" para começar.</p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      <NovoAgendamentoModal
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        instancias={instancias}
        onSalvo={() => { setModalAberto(false); load(); }}
      />
    </div>
  );
}

function AgendamentoCard({
  ag, instancias, onCancelar, onExcluir,
}: {
  ag: Agendamento;
  instancias: Instancia[];
  onCancelar: (id: string) => void;
  onExcluir: (id: string) => void;
}) {
  const cfg = STATUS_CONFIG[ag.status];
  const StatusIcon = cfg.icon;
  const nomesInst = ag.instancias_ids
    .map((id) => instancias.find((i) => i.id === id)?.nome ?? id.slice(0, 8))
    .join(", ");

  const tipoIcon = ag.tipo === "image" ? Image : ag.tipo === "video" ? Video : Type;
  const TipoIcon = tipoIcon;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <TipoIcon className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{ag.titulo}</span>
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.color}`}>
                <StatusIcon className={`w-3 h-3 ${ag.status === "enviando" ? "animate-spin" : ""}`} />
                {cfg.label}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <CalendarClock className="w-3 h-3" />
                {new Date(ag.agendado_para).toLocaleString("pt-BR", {
                  day: "2-digit", month: "2-digit", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </span>
              {nomesInst && (
                <span className="text-xs text-muted-foreground">
                  📱 {nomesInst}
                </span>
              )}
            </div>
            {ag.tipo === "text" && ag.texto && (
              <p className="text-xs text-muted-foreground mt-1 truncate max-w-md italic">"{ag.texto}"</p>
            )}
            {ag.resultado && ag.status === "erro" && (
              <p className="text-xs text-destructive mt-1">
                {JSON.stringify(ag.resultado).slice(0, 120)}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {ag.status === "pendente" && (
            <Button variant="ghost" size="sm" onClick={() => onCancelar(ag.id)} className="text-muted-foreground hover:text-yellow-600">
              <XCircle className="w-4 h-4" />
            </Button>
          )}
          {["enviado","erro","cancelado"].includes(ag.status) && (
            <Button variant="ghost" size="sm" onClick={() => onExcluir(ag.id)} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function NovoAgendamentoModal({
  open, onClose, instancias, onSalvo,
}: {
  open: boolean;
  onClose: () => void;
  instancias: Instancia[];
  onSalvo: () => void;
}) {
  const [tipo, setTipo] = useState<"text" | "image" | "video">("text");
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [bgColor, setBgColor] = useState(19);
  const [font, setFont] = useState(0);
  const [fileUrl, setFileUrl] = useState("");
  const [fileBase64, setFileBase64] = useState("");
  const [mimetype, setMimetype] = useState("");
  const [legenda, setLegenda] = useState("");
  const [maxRecipients, setMaxRecipients] = useState(100);
  const [instSelecionadas, setInstSelecionadas] = useState<Set<string>>(new Set());
  const [dataHora, setDataHora] = useState("");
  const [recorrente, setRecorrente] = useState(false);
  const [recorrencia, setRecorrencia] = useState<"diario" | "semanal" | "mensal">("semanal");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setTipo("text"); setTitulo(""); setTexto(""); setBgColor(19); setFont(0);
      setFileUrl(""); setFileBase64(""); setMimetype(""); setLegenda("");
      setMaxRecipients(100); setInstSelecionadas(new Set()); setDataHora("");
      setRecorrente(false); setRecorrencia("semanal");
    }
  }, [open]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx 15 MB). Use uma URL para vídeos maiores.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result as string;
      setFileBase64(b64);
      setMimetype(file.type);
      setFileUrl("");
      toast.success(`Arquivo carregado: ${file.name}`);
    };
    reader.readAsDataURL(file);
  };

  const toggleInst = (id: string) =>
    setInstSelecionadas((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const validar = () => {
    if (!titulo.trim()) { toast.error("Digite um título"); return false; }
    if (tipo === "text" && !texto.trim()) { toast.error("Digite o texto do story"); return false; }
    if (tipo !== "text" && !fileBase64 && !fileUrl.trim()) { toast.error("Envie um arquivo ou informe uma URL"); return false; }
    if (!instSelecionadas.size) { toast.error("Selecione ao menos uma instância"); return false; }
    if (!dataHora) { toast.error("Selecione data e hora"); return false; }
    if (new Date(dataHora) <= new Date()) { toast.error("A data/hora deve ser no futuro"); return false; }
    return true;
  };

  const salvar = async () => {
    if (!validar()) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    setSalvando(true);
    try {
      const row = {
        usuario_id: u.user.id,
        titulo: titulo.trim(),
        tipo,
        texto: tipo === "text" ? texto.trim() : (legenda.trim() || null),
        background_color: tipo === "text" ? bgColor : null,
        font: tipo === "text" ? font : null,
        file_url: fileUrl.trim() || null,
        file_base64: fileBase64 || null,
        mimetype: mimetype || null,
        legenda: legenda.trim() || null,
        max_recipients: maxRecipients || 100,
        instancias_ids: [...instSelecionadas],
        agendado_para: new Date(dataHora).toISOString(),
        status: "pendente",
        recorrente,
        recorrencia: recorrente ? recorrencia : null,
      };
      const { error } = await (supabase as any).from("stories_agendamentos").insert(row);
      if (error) throw new Error(error.message);
      toast.success("Story agendado com sucesso!");
      onSalvo();
    } catch (e) {
      toast.error("Erro ao salvar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSalvando(false);
    }
  };

  const testarAgora = async () => {
    if (!validar()) return;
    const inst = instancias.find((i) => instSelecionadas.has(i.id));
    if (!inst) return;

    setTestando(true);
    try {
      const payload: Record<string, unknown> = {
        token: inst.token,
        type: tipo,
        max_recipients: maxRecipients,
      };
      if (tipo === "text") {
        payload.text = texto;
        payload.background_color = bgColor;
        payload.font = font;
      } else {
        payload.file = fileBase64 || fileUrl;
        payload.mimetype = mimetype;
        if (legenda) payload.legenda = legenda;
      }

      const { data, error } = await supabase.functions.invoke("uazapi-proxy", {
        body: { action: "send_status", payload },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(`Story enviado agora para "${inst.nome}" como teste!`);
    } catch (e) {
      toast.error("Erro no teste: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setTestando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clapperboard className="w-5 h-5 text-primary" /> Novo Agendamento de Story
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Título */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Título (interno)</label>
            <Input placeholder="Ex: Promoção Julho — Loja A" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>

          {/* Tipo */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Tipo de conteúdo</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: "text",  label: "Texto",  icon: Type },
                { value: "image", label: "Imagem", icon: Image },
                { value: "video", label: "Vídeo",  icon: Video },
              ] as const).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setTipo(value)}
                  className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${
                    tipo === value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:bg-muted/30 text-muted-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>
          </div>

          {/* Conteúdo baseado no tipo */}
          {tipo === "text" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Texto do story</label>
                <Textarea
                  placeholder="Digite o texto que aparecerá no story…"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={4}
                  maxLength={656}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground text-right">{texto.length}/656</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Cor de fundo</label>
                <div className="flex flex-wrap gap-2">
                  {CORES.map((c) => (
                    <button
                      key={c.index}
                      onClick={() => setBgColor(c.index)}
                      title={c.label}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        bgColor === c.index ? "border-foreground scale-110" : "border-transparent hover:border-muted-foreground"
                      }`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Fonte</label>
                <div className="flex flex-wrap gap-2">
                  {[0, 1, 2, 6, 7, 8, 9, 10].map((f) => (
                    <button
                      key={f}
                      onClick={() => setFont(f)}
                      className={`px-3 py-1.5 rounded border text-xs transition-colors ${
                        font === f ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-muted/30"
                      }`}
                    >
                      Fonte {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(tipo === "image" || tipo === "video") && (
            <div className="space-y-4">
              {/* Upload de arquivo */}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {tipo === "image" ? "Imagem" : "Vídeo"} — upload ou URL
                </label>
                <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-3">
                  {fileBase64 ? (
                    <div className="space-y-2">
                      {tipo === "image" && (
                        <img src={fileBase64} alt="preview" className="max-h-32 mx-auto rounded object-contain" />
                      )}
                      {tipo === "video" && (
                        <video src={fileBase64} className="max-h-32 mx-auto rounded" controls />
                      )}
                      <button
                        onClick={() => { setFileBase64(""); setMimetype(""); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                        className="text-xs text-destructive underline"
                      >
                        Remover
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-center">
                        {tipo === "image" ? <Image className="w-8 h-8 text-muted-foreground opacity-40" /> : <Video className="w-8 h-8 text-muted-foreground opacity-40" />}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {tipo === "image" ? "JPG, PNG, WebP — máx 15 MB" : "MP4, AVI — máx 15 MB"}
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={tipo === "image" ? "image/*" : "video/*"}
                        onChange={handleFile}
                        className="hidden"
                        id="file-upload"
                      />
                      <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                        Selecionar arquivo
                      </Button>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-px bg-border flex-1" />
                  <span className="text-xs text-muted-foreground">ou informe uma URL pública</span>
                  <div className="h-px bg-border flex-1" />
                </div>
                <Input
                  placeholder="https://exemplo.com/arquivo.mp4"
                  value={fileUrl}
                  onChange={(e) => { setFileUrl(e.target.value); setFileBase64(""); }}
                  disabled={!!fileBase64}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Legenda (opcional)</label>
                <Input
                  placeholder="Texto que acompanha a mídia…"
                  value={legenda}
                  onChange={(e) => setLegenda(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Instâncias */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Instâncias WhatsApp</label>
            {instancias.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma instância conectada.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                {instancias.map((inst) => (
                  <label
                    key={inst.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      instSelecionadas.has(inst.id)
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/30"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={instSelecionadas.has(inst.id)}
                      onChange={() => toggleInst(inst.id)}
                      className="accent-primary"
                    />
                    <span className="text-sm font-medium truncate">{inst.nome}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {instSelecionadas.size} de {instancias.length} selecionada{instSelecionadas.size !== 1 ? "s" : ""}
            </p>
          </div>

          {/* Data e hora */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Data e hora de envio</label>
              <Input
                type="datetime-local"
                value={dataHora}
                onChange={(e) => setDataHora(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Máx. de destinatários</label>
              <Input
                type="number"
                min={1}
                max={5000}
                value={maxRecipients}
                onChange={(e) => setMaxRecipients(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">Limite de contatos da agenda que verão o story. Recomendado: 100.</p>
            </div>
          </div>

          {/* Recorrência */}
          <div className="space-y-3 border rounded-lg p-4 bg-muted/20">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={recorrente}
                onChange={(e) => setRecorrente(e.target.checked)}
                className="accent-primary w-4 h-4"
              />
              <div>
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5" /> Agendamento recorrente
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">Reenviará automaticamente após cada execução.</p>
              </div>
            </label>
            {recorrente && (
              <div className="pl-7 space-y-2">
                <label className="text-sm font-medium">Frequência</label>
                <div className="flex gap-2">
                  {(["diario", "semanal", "mensal"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRecorrencia(r)}
                      className={`px-3 py-1.5 rounded border text-xs font-medium transition-colors ${
                        recorrencia === r
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground hover:bg-muted/30"
                      }`}
                    >
                      {r === "diario" ? "Diário" : r === "semanal" ? "Semanal" : "Mensal"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            variant="outline"
            onClick={testarAgora}
            disabled={testando || salvando}
            className="gap-2"
          >
            {testando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Testar agora
          </Button>
          <Button onClick={salvar} disabled={salvando || testando} className="gap-2">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
            Agendar story
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
