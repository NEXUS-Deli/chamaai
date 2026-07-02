import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, FileText, Loader2, Copy, Upload, Layers, AlertCircle,
  Image as ImageIcon, Video, Music, FileIcon,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/templates")({
  component: TemplatesPage,
});

// ── Types ──────────────────────────────────────────────────────────────────────

interface TextTemplate {
  id: string;
  nome: string;
  mensagem: string;
  variacoes: string[];
  criado_em: string;
  atualizado_em: string;
}

interface MediaTemplate {
  id: string;
  nome: string;
  tipo: "image" | "video" | "document" | "audio";
  url: string;
  storage_path: string;
  mimetype: string;
  tamanho: number | null;
  criado_em: string;
}

// ── Utils ──────────────────────────────────────────────────────────────────────

function parseMensagensArquivo(texto: string): string[] {
  texto = texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let msgs: string[];
  if (texto.includes("\n---\n") || texto.startsWith("---\n") || texto.endsWith("\n---")) {
    msgs = texto.split(/\n---\n|^---\n|\n---$/m);
  } else if (texto.includes("\n\n")) {
    msgs = texto.split(/\n{2,}/);
  } else {
    msgs = texto.split("\n");
  }
  return msgs.map((m) => m.trim()).filter((m) => m.length > 0).slice(0, 100);
}

function parseMensagensCSV(texto: string): string[] {
  const linhas = texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const msgs: string[] = [];
  for (const linha of linhas) {
    const cel = linha.replace(/^"|"$/g, "").trim();
    if (cel && !cel.toLowerCase().startsWith("mensagem") && !cel.toLowerCase().startsWith("message")) {
      msgs.push(cel);
    }
  }
  return msgs.slice(0, 100);
}

function inferirTipo(mimetype: string): MediaTemplate["tipo"] {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  return "document";
}

function formatarTamanho(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Page ───────────────────────────────────────────────────────────────────────

function TemplatesPage() {
  const [tab, setTab] = useState<"mensagens" | "midias">("mensagens");

  return (
    <div className="p-4 sm:p-8 space-y-6">
      {/* Header + Tabs */}
      <div>
        <h1 className="text-2xl font-bold">Templates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Salve mensagens e mídias para usar nas suas campanhas com um clique.
        </p>
        <div className="flex gap-1 mt-4 bg-muted/50 rounded-lg p-1 w-fit">
          <button
            onClick={() => setTab("mensagens")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === "mensagens"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="w-3.5 h-3.5 inline mr-1.5" />
            Mensagens
          </button>
          <button
            onClick={() => setTab("midias")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === "midias"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5 inline mr-1.5" />
            Mídias
          </button>
        </div>
      </div>

      {tab === "mensagens" && <MensagensTab />}
      {tab === "midias" && <MidiasTab />}
    </div>
  );
}

// ── Mensagens Tab ──────────────────────────────────────────────────────────────

function MensagensTab() {
  const [templates, setTemplates] = useState<TextTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; item: TextTemplate | null }>({ open: false, item: null });
  const [packModal, setPackModal] = useState(false);

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data } = await (supabase as any)
      .from("message_templates")
      .select("id,nome,mensagem,variacoes,criado_em,atualizado_em")
      .eq("usuario_id", u.user.id)
      .order("atualizado_em", { ascending: false });
    setTemplates(((data ?? []) as TextTemplate[]).map((t) => ({ ...t, variacoes: t.variacoes ?? [] })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const excluir = async (id: string) => {
    if (!confirm("Excluir este template?")) return;
    await (supabase as any).from("message_templates").delete().eq("id", id);
    toast.success("Template excluído");
    load();
  };

  const copiar = (t: TextTemplate) => {
    const texto = t.variacoes?.length > 0 ? t.variacoes.join("\n---\n") : t.mensagem;
    navigator.clipboard.writeText(texto);
    toast.success(t.variacoes?.length > 0 ? `${t.variacoes.length} mensagens copiadas!` : "Mensagem copiada!");
  };

  const singles = templates.filter((t) => !t.variacoes?.length);
  const packs = templates.filter((t) => t.variacoes?.length > 0);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <Button variant="outline" onClick={() => setPackModal(true)} className="gap-2">
          <Upload className="w-4 h-4" /> Importar pack (arquivo)
        </Button>
        <Button onClick={() => setModal({ open: true, item: null })} className="gap-2">
          <Plus className="w-4 h-4" /> Novo template
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground space-y-3">
          <FileText className="w-12 h-12 opacity-20" />
          <p className="text-sm">Nenhum template criado ainda.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {packs.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Packs de variações</h2>
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{packs.length}</span>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {packs.map((t) => (
                  <Card key={t.id} className="p-5 flex flex-col gap-3 hover:shadow-md transition-shadow border-primary/20">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Layers className="w-4 h-4 text-primary shrink-0" />
                        <h3 className="font-semibold text-sm truncate">{t.nome}</h3>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => copiar(t)} title="Copiar todas"><Copy className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => setModal({ open: true, item: t })}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => excluir(t.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                        <Layers className="w-3 h-3" /> {t.variacoes.length} mensagens
                      </span>
                    </div>
                    <div className="space-y-1.5 flex-1">
                      {t.variacoes.slice(0, 3).map((v, i) => (
                        <p key={i} className="text-xs text-muted-foreground leading-snug line-clamp-2 pl-2 border-l-2 border-muted">{v}</p>
                      ))}
                      {t.variacoes.length > 3 && <p className="text-xs text-muted-foreground italic pl-2">+ {t.variacoes.length - 3} mensagem(ns)...</p>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-auto pt-2 border-t">
                      Atualizado {new Date(t.atualizado_em).toLocaleDateString("pt-BR")}
                    </p>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {singles.length > 0 && (
            <div className="space-y-3">
              {packs.length > 0 && (
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Mensagens individuais</h2>
                  <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">{singles.length}</span>
                </div>
              )}
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {singles.map((t) => (
                  <Card key={t.id} className="p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm truncate">{t.nome}</h3>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => copiar(t)} title="Copiar mensagem"><Copy className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => setModal({ open: true, item: t })}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => excluir(t.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap flex-1">{t.mensagem}</p>
                    <p className="text-xs text-muted-foreground mt-auto pt-2 border-t">
                      Atualizado {new Date(t.atualizado_em).toLocaleDateString("pt-BR")}
                    </p>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <TemplateModal
        open={modal.open}
        item={modal.item}
        onClose={() => setModal({ open: false, item: null })}
        onSalvo={() => { setModal({ open: false, item: null }); load(); }}
      />
      <PackImportModal
        open={packModal}
        onClose={() => setPackModal(false)}
        onSalvo={() => { setPackModal(false); load(); }}
      />
    </div>
  );
}

// ── Mídias Tab ─────────────────────────────────────────────────────────────────

function MidiasTab() {
  const [midias, setMidias] = useState<MediaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [editModal, setEditModal] = useState<MediaTemplate | null>(null);
  const [novoNome, setNovoNome] = useState("");

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data } = await (supabase as any)
      .from("media_templates")
      .select("id,nome,tipo,url,storage_path,mimetype,tamanho,criado_em")
      .eq("usuario_id", u.user.id)
      .order("criado_em", { ascending: false });
    setMidias((data ?? []) as MediaTemplate[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const uploadArquivo = async (file: File) => {
    const MAX_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      toast.error("Arquivo muito grande. Máximo: 50 MB");
      return;
    }

    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const nomeSemExt = file.name.replace(/\.[^/.]+$/, "");
      const uid = crypto.randomUUID().slice(0, 8);
      const storagePath = `${u.user.id}/${uid}-${nomeSemExt.slice(0, 40)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("media-templates")
        .upload(storagePath, file, { contentType: file.type });

      if (uploadError) throw new Error(uploadError.message);

      const { data: urlData } = supabase.storage
        .from("media-templates")
        .getPublicUrl(storagePath);

      const tipo = inferirTipo(file.type);

      const { error: dbError } = await (supabase as any)
        .from("media_templates")
        .insert({
          usuario_id: u.user.id,
          nome: nomeSemExt,
          tipo,
          url: urlData.publicUrl,
          storage_path: storagePath,
          mimetype: file.type,
          tamanho: file.size,
        });

      if (dbError) {
        // Limpa o arquivo do storage se o DB falhar
        await supabase.storage.from("media-templates").remove([storagePath]);
        throw new Error(dbError.message);
      }

      toast.success(`"${nomeSemExt}" salvo nos templates!`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao fazer upload");
    } finally {
      setUploading(false);
    }
  };

  const excluir = async (m: MediaTemplate) => {
    if (!confirm(`Excluir "${m.nome}"?`)) return;
    try {
      await supabase.storage.from("media-templates").remove([m.storage_path]);
      await (supabase as any).from("media_templates").delete().eq("id", m.id);
      toast.success("Mídia excluída");
      setMidias(prev => prev.filter(x => x.id !== m.id));
    } catch (e) {
      toast.error("Erro ao excluir: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const salvarNome = async () => {
    if (!editModal || !novoNome.trim()) return;
    await (supabase as any).from("media_templates").update({ nome: novoNome.trim() }).eq("id", editModal.id);
    setMidias(prev => prev.map(m => m.id === editModal.id ? { ...m, nome: novoNome.trim() } : m));
    toast.success("Nome atualizado");
    setEditModal(null);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach(uploadArquivo);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setArrastando(false);
    Array.from(e.dataTransfer.files).forEach(uploadArquivo);
  };

  const TIPO_ICON: Record<string, React.ReactNode> = {
    image: <ImageIcon className="w-5 h-5 text-blue-500" />,
    video: <Video className="w-5 h-5 text-purple-500" />,
    audio: <Music className="w-5 h-5 text-green-500" />,
    document: <FileIcon className="w-5 h-5 text-orange-500" />,
  };

  const TIPO_LABEL: Record<string, string> = {
    image: "Imagem",
    video: "Vídeo",
    audio: "Áudio",
    document: "Documento",
  };

  return (
    <div className="space-y-6">
      {/* Upload area */}
      <div
        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          arrastando ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm">Fazendo upload...</p>
          </div>
        ) : (
          <>
            <Upload className="w-8 h-8 mx-auto text-muted-foreground opacity-40 mb-3" />
            <p className="text-sm font-medium">Arraste arquivos aqui ou clique para selecionar</p>
            <p className="text-xs text-muted-foreground mt-1">
              Imagens, vídeos, documentos e áudios — máximo 50 MB por arquivo
            </p>
            <label className="cursor-pointer mt-4 inline-block">
              <Button variant="outline" size="sm" asChild><span>Selecionar arquivos</span></Button>
              <input
                type="file"
                multiple
                accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={handleFileInput}
              />
            </label>
          </>
        )}
      </div>

      {/* Grid de mídias */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : midias.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground space-y-3">
          <ImageIcon className="w-12 h-12 opacity-20" />
          <p className="text-sm">Nenhuma mídia salva ainda.</p>
          <p className="text-xs">Faça upload de imagens, vídeos ou documentos para usar nas suas campanhas.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{midias.length} arquivo(s) salvo(s)</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {midias.map((m) => (
              <Card key={m.id} className="overflow-hidden group hover:shadow-md transition-shadow">
                {/* Preview */}
                <div className="relative aspect-square bg-muted flex items-center justify-center overflow-hidden">
                  {m.tipo === "image" ? (
                    <img
                      src={m.url}
                      alt={m.nome}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : m.tipo === "video" ? (
                    <video
                      src={m.url}
                      className="w-full h-full object-cover"
                      muted
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      {TIPO_ICON[m.tipo]}
                      <span className="text-xs font-medium">{m.mimetype.split("/")[1]?.toUpperCase()}</span>
                    </div>
                  )}
                  {/* Actions overlay */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                      title="Abrir"
                    >
                      <Upload className="w-4 h-4 text-white rotate-180" />
                    </a>
                    <button
                      onClick={() => { setEditModal(m); setNovoNome(m.nome); }}
                      className="p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                      title="Renomear"
                    >
                      <Pencil className="w-4 h-4 text-white" />
                    </button>
                    <button
                      onClick={() => excluir(m)}
                      className="p-2 bg-red-500/70 hover:bg-red-500/90 rounded-lg transition-colors"
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4 text-white" />
                    </button>
                  </div>
                  {/* Type badge */}
                  <div className="absolute top-2 left-2">
                    <span className="flex items-center gap-1 px-1.5 py-0.5 bg-black/60 rounded text-white text-[10px] font-medium">
                      {TIPO_ICON[m.tipo]}
                      {TIPO_LABEL[m.tipo]}
                    </span>
                  </div>
                </div>
                {/* Info */}
                <div className="p-3">
                  <p className="text-sm font-medium truncate" title={m.nome}>{m.nome}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatarTamanho(m.tamanho)}
                    {m.tamanho ? " · " : ""}
                    {new Date(m.criado_em).toLocaleDateString("pt-BR")}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Edit name modal */}
      <Dialog open={!!editModal} onOpenChange={(o) => !o && setEditModal(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear arquivo</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              placeholder="Nome do arquivo"
              onKeyDown={(e) => e.key === "Enter" && salvarNome()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModal(null)}>Cancelar</Button>
            <Button onClick={salvarNome} disabled={!novoNome.trim()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Text Template Modal ────────────────────────────────────────────────────────

function TemplateModal({
  open, item, onClose, onSalvo,
}: {
  open: boolean;
  item: TextTemplate | null;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [nome, setNome] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [salvando, setSalvando] = useState(false);
  const isPack = (item?.variacoes?.length ?? 0) > 0;

  useEffect(() => {
    if (open) {
      setNome(item?.nome ?? "");
      setMensagem(isPack ? (item?.variacoes?.join("\n---\n") ?? "") : (item?.mensagem ?? ""));
    }
  }, [open, item]);

  const salvar = async () => {
    if (!nome.trim()) return toast.error("Digite um nome para o template");
    if (!mensagem.trim()) return toast.error("Digite a mensagem");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    setSalvando(true);
    try {
      let variacoes: string[] = [];
      let mensagemPrincipal = mensagem.trim();

      if (isPack) {
        variacoes = parseMensagensArquivo(mensagem);
        mensagemPrincipal = variacoes[0] ?? "";
      }

      if (item) {
        const { error } = await (supabase as any)
          .from("message_templates")
          .update({ nome: nome.trim(), mensagem: mensagemPrincipal, variacoes })
          .eq("id", item.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await (supabase as any)
          .from("message_templates")
          .insert({ usuario_id: u.user.id, nome: nome.trim(), mensagem: mensagemPrincipal, variacoes });
        if (error) throw new Error(error.message);
      }
      toast.success(item ? "Template atualizado" : "Template criado");
      onSalvo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {item ? (isPack ? "Editar pack" : "Editar template") : "Novo template"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Nome do template</label>
            <Input
              placeholder="Ex: Promoção mensal, Boas-vindas..."
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {isPack ? "Mensagens (separadas por linha em branco ou ---)" : "Mensagem"}
            </label>
            <Textarea
              placeholder={isPack
                ? "Mensagem 1\n\nMensagem 2\n\nMensagem 3..."
                : "Digite a mensagem aqui. Use {nome} para personalizar..."}
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              rows={8}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground text-right">{mensagem.length} caracteres</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando} className="gap-2">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
            {item ? "Salvar alterações" : "Criar template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Pack Import Modal ──────────────────────────────────────────────────────────

function PackImportModal({ open, onClose, onSalvo }: { open: boolean; onClose: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState("");
  const [mensagens, setMensagens] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  useEffect(() => { if (open) { setNome(""); setMensagens([]); } }, [open]);

  const processarArquivo = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) return toast.error("Arquivo muito grande (máx 2 MB)");
    const texto = await file.text();
    let msgs: string[];
    if (file.name.endsWith(".csv")) {
      msgs = parseMensagensCSV(texto);
    } else {
      msgs = parseMensagensArquivo(texto);
    }
    if (!msgs.length) return toast.error("Nenhuma mensagem encontrada no arquivo");
    setMensagens(msgs);
    if (!nome) setNome(file.name.replace(/\.[^/.]+$/, ""));
    toast.success(`${msgs.length} mensagem(ns) encontrada(s)`);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processarArquivo(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setArrastando(false);
    const file = e.dataTransfer.files[0];
    if (file) processarArquivo(file);
  };

  const salvar = async () => {
    if (!nome.trim()) return toast.error("Digite um nome para o pack");
    if (!mensagens.length) return toast.error("Carregue um arquivo com as mensagens");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setSalvando(true);
    const { error } = await (supabase as any)
      .from("message_templates")
      .insert({ usuario_id: u.user.id, nome: nome.trim(), mensagem: mensagens[0], variacoes: mensagens });
    setSalvando(false);
    if (error) return toast.error(error.message);
    toast.success(`Pack "${nome}" salvo com ${mensagens.length} mensagem(ns)!`);
    onSalvo();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" /> Importar pack de mensagens
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="flex gap-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm text-blue-800 dark:text-blue-200">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">Formato do arquivo:</p>
              <ul className="text-xs space-y-0.5 list-disc list-inside">
                <li><strong>.txt</strong> — separe as mensagens com uma linha em branco ou com <code>---</code> em linha própria</li>
                <li><strong>.csv</strong> — uma mensagem por linha, primeira coluna</li>
                <li>Máximo de 100 mensagens por pack</li>
              </ul>
            </div>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              arrastando ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
          >
            {mensagens.length > 0 ? (
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-semibold">
                  <Layers className="w-4 h-4" /> {mensagens.length} mensagem(ns) carregada(s)
                </div>
                <div className="mt-3 space-y-1.5 max-h-36 overflow-y-auto text-left">
                  {mensagens.slice(0, 5).map((m, i) => (
                    <p key={i} className="text-xs text-muted-foreground pl-3 border-l-2 border-muted line-clamp-2">
                      <span className="font-medium text-foreground">#{i + 1}</span> {m}
                    </p>
                  ))}
                  {mensagens.length > 5 && <p className="text-xs text-muted-foreground italic pl-3">+ {mensagens.length - 5} mais...</p>}
                </div>
                <label className="cursor-pointer inline-block mt-2">
                  <Button variant="outline" size="sm" asChild><span>Trocar arquivo</span></Button>
                  <input type="file" accept=".txt,.csv" className="hidden" onChange={handleFile} />
                </label>
              </div>
            ) : (
              <>
                <Upload className="w-10 h-10 mx-auto text-muted-foreground opacity-40 mb-3" />
                <p className="text-sm font-medium">Arraste um arquivo aqui ou clique para selecionar</p>
                <p className="text-xs text-muted-foreground mt-1">.txt ou .csv — até 100 mensagens</p>
                <label className="cursor-pointer mt-4 inline-block">
                  <Button variant="outline" size="sm" asChild><span>Selecionar arquivo</span></Button>
                  <input type="file" accept=".txt,.csv" className="hidden" onChange={handleFile} />
                </label>
              </>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Nome do pack</label>
            <Input
              placeholder="Ex: Variações promo julho, Mensagens de boas-vindas..."
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando || !mensagens.length} className="gap-2">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar pack {mensagens.length > 0 && `(${mensagens.length} msgs)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
