import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2, ChevronRight, UploadCloud, X, Plus, Trash2, FileText, Layers, Check,
  Image as ImageIcon, Video, Music,
} from "lucide-react";
import { isValidPhone, toE164BR } from "@/lib/phone";
import { parseCSV } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/campanhas/nova")({
  component: NovaCampanha,
});

interface Contato { telefone: string; nome: string; empresa: string }
interface Instancia { id: string; nome: string; instancia: string; token: string | null }

function MidiaThumbUrl({ url, nome, tipo, onRemove }: { url: string; nome: string; tipo: string; onRemove: () => void }) {
  return (
    <div className="relative group w-20 h-20 rounded-md border bg-muted overflow-hidden flex-shrink-0">
      {tipo === "image" || tipo.startsWith("image/") ? (
        <img src={url} alt={nome} className="w-full h-full object-cover" />
      ) : tipo === "video" || tipo.startsWith("video/") ? (
        <video src={url} className="w-full h-full object-cover" muted />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-1">
          <FileText className="w-6 h-6 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground text-center leading-tight line-clamp-2">{nome}</span>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="w-3 h-3" />
      </button>
      <div className="absolute bottom-0 left-0 right-0 bg-primary/80 text-[9px] font-semibold text-white text-center py-0.5 leading-none">
        template
      </div>
    </div>
  );
}

function MidiaThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = URL.createObjectURL(file);
  return (
    <div className="relative group w-20 h-20 rounded-md border bg-muted overflow-hidden flex-shrink-0">
      {file.type.startsWith("image/") ? (
        <Dialog>
          <DialogTrigger asChild>
            <img src={url} alt={file.name} className="w-full h-full object-cover cursor-pointer" />
          </DialogTrigger>
          <DialogContent className="max-w-4xl border-none bg-transparent shadow-none p-0 flex justify-center">
            <img src={url} alt={file.name} className="max-h-[85vh] rounded-lg object-contain" />
          </DialogContent>
        </Dialog>
      ) : file.type.startsWith("video/") ? (
        <video src={url} className="w-full h-full object-cover" muted />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-1">
          <FileText className="w-6 h-6 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground text-center leading-tight line-clamp-2">{file.name}</span>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function NovaCampanha() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [nome, setNome] = useState("");

  const [mensagem, setMensagem] = useState("");
  const [mensagensVariacoes, setMensagensVariacoes] = useState<string[]>([]);

  const [delayMinimo, setDelayMinimo] = useState(5);
  const [delayMaximo, setDelayMaximo] = useState(15);
  const [delayMensagens, setDelayMensagens] = useState(3);
  const [horarioInicio, setHorarioInicio] = useState("08:00");
  const [horarioFim, setHorarioFim] = useState("22:00");

  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [instanciasSelecionadas, setInstanciasSelecionadas] = useState<string[]>([]);

  // Variações de mídia — arquivos locais e templates salvos (máx. 10 no total)
  const [midiasFiles, setMidiasFiles] = useState<File[]>([]);
  const [midiasTemplates, setMidiasTemplates] = useState<{ url: string; nome: string; tipo: string; mimetype: string }[]>([]);
  const [midiaTemplateModal, setMidiaTemplateModal] = useState(false);

  const [agendarPara, setAgendarPara] = useState("");

  const [pastas, setPastas] = useState<{ id: string; nome: string }[]>([]);
  const [pastasSel, setPastasSel] = useState<string[]>([]);
  const [leadsDaPasta, setLeadsDaPasta] = useState<(Contato & { id: string })[]>([]);
  const [leadsSel, setLeadsSel] = useState<string[]>([]);
  const leadsSelSet = useMemo(() => new Set(leadsSel), [leadsSel]);

  const [contatosCSV, setContatosCSV] = useState<Contato[]>([]);
  const [origem, setOrigem] = useState<"csv" | "lista">("csv");
  const [loading, setLoading] = useState(false);
  const [templateModal, setTemplateModal] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: p } = await supabase.from("pastas").select("id,nome").eq("usuario_id", u.user.id);
      setPastas(p ?? []);
      const { data: insts } = await supabase.from("instancias").select("*").eq("usuario_id", u.user.id);
      const filteredInsts = (insts ?? []).filter((i) => i.instancia !== "r1b5f62949ba437");
      setInstancias(filteredInsts);
    })();
  }, []);

  useEffect(() => {
    if (origem !== "lista" || pastasSel.length === 0) {
      setLeadsDaPasta([]);
      setLeadsSel([]);
      return;
    }
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;

      // Busca em lotes para superar o limite de 1000 linhas do PostgREST
      const BATCH = 1000;
      let all: { id: string; telefone: string; nome: string | null; empresa: string | null }[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("leads")
          .select("id, telefone, nome, empresa")
          .eq("usuario_id", u.user.id)
          .in("pasta_id", pastasSel)
          .range(from, from + BATCH - 1);
        const batch = data ?? [];
        all = all.concat(batch);
        if (batch.length < BATCH) break;
        from += BATCH;
      }

      const validos = all
        .filter((l) => isValidPhone(l.telefone))
        .map((l) => ({ id: l.id, telefone: toE164BR(l.telefone), nome: l.nome ?? "", empresa: l.empresa ?? "" }));

      setLeadsDaPasta(validos);
      setLeadsSel(validos.map((l) => l.telefone));
    })();
  }, [pastasSel, origem]);

  const selecionarProximos = (n: number) => {
    const naoSelecionados = leadsDaPasta
      .filter((l) => !leadsSelSet.has(l.telefone))
      .slice(0, n)
      .map((l) => l.telefone);
    if (!naoSelecionados.length) {
      toast.info("Todos os leads já estão selecionados");
      return;
    }
    setLeadsSel((prev) => [...prev, ...naoSelecionados]);
    toast.success(`+${naoSelecionados.length} leads adicionados à seleção`);
  };

  const handleCSV = async (file: File) => {
    const parsed = await parseCSV(file);
    const cs = parsed.rows
      .filter((r) => r.telefone && isValidPhone(String(r.telefone)))
      .map((r) => ({
        telefone: toE164BR(String(r.telefone)),
        nome: String(r.nome ?? ""),
        empresa: String(r.empresa ?? ""),
      }));
    setContatosCSV(cs);
    toast.success(`${cs.length} contatos válidos`);
  };

  const getContatos = (): Contato[] => {
    if (origem === "csv") return contatosCSV;
    return leadsDaPasta.filter((l) => leadsSelSet.has(l.telefone));
  };

  const uploadMidias = async (): Promise<{ url: string; nome: string; tipo: string }[]> => {
    const resultados: { url: string; nome: string; tipo: string }[] = [];

    // Upload de arquivos locais
    if (midiasFiles.length > 0) {
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        for (const file of midiasFiles) {
          const ext = file.name.split(".").pop();
          const fileName = `${u.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error } = await supabase.storage.from("midias").upload(fileName, file);
          if (error) { toast.error("Erro ao enviar mídia: " + error.message); continue; }
          const { data: urlData } = supabase.storage.from("midias").getPublicUrl(fileName);
          resultados.push({ url: urlData.publicUrl, nome: file.name, tipo: file.type });
        }
      }
    }

    // Mídias dos templates (já têm URL pública, não precisam de upload)
    for (const t of midiasTemplates) {
      resultados.push({ url: t.url, nome: t.nome, tipo: t.mimetype });
    }

    return resultados;
  };

  const formatarDataParaBRT = (dataLocal: string): string | null => {
    if (!dataLocal) return null;
    return `${dataLocal}:00-03:00`;
  };

  const adicionarVariacao = () => setMensagensVariacoes((v) => [...v, ""]);
  const removerVariacao = (i: number) => setMensagensVariacoes((v) => v.filter((_, idx) => idx !== i));
  const atualizarVariacao = (i: number, val: string) =>
    setMensagensVariacoes((v) => v.map((m, idx) => (idx === i ? val : m)));

  const toggleInstancia = (id: string) => {
    setInstanciasSelecionadas((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const adicionarMidia = (files: FileList | null) => {
    if (!files) return;
    const slotsDisponiveis = 10 - midiasTemplates.length;
    setMidiasFiles((prev) => {
      const novos = Array.from(files).filter((f) => !prev.some((p) => p.name === f.name && p.size === f.size));
      const combinados = [...prev, ...novos];
      if (combinados.length > slotsDisponiveis) {
        toast.warning("Máximo de 10 mídias por campanha.");
        return combinados.slice(0, slotsDisponiveis);
      }
      return combinados;
    });
  };

  const removerMidia = (index: number) => setMidiasFiles((prev) => prev.filter((_, i) => i !== index));

  const removerMidiaTemplate = (index: number) =>
    setMidiasTemplates((prev) => prev.filter((_, i) => i !== index));

  const adicionarMidiasTemplate = (items: { url: string; nome: string; tipo: string; mimetype: string }[]) => {
    setMidiasTemplates((prev) => {
      const novos = items.filter((item) => !prev.some((p) => p.url === item.url));
      const combinados = [...prev, ...novos];
      const total = combinados.length + midiasFiles.length;
      if (total > 10) {
        toast.warning("Máximo de 10 mídias por campanha.");
        return combinados.slice(0, 10 - midiasFiles.length);
      }
      return combinados;
    });
    setMidiaTemplateModal(false);
    toast.success(`${items.length} mídia(s) adicionada(s) dos templates`);
  };

  const disparar = async () => {
    if (instanciasSelecionadas.length === 0) return toast.error("Selecione ao menos uma instância de WhatsApp.");
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const contatos = getContatos();
      if (!contatos.length) { toast.error("Nenhum contato válido selecionado"); return; }

      const instsSelecionadas = instancias
        .filter((i) => instanciasSelecionadas.includes(i.id))
        .map((i) => ({ id: i.id, nome: i.nome, token: i.token ?? "" }));

      const primeiraInstancia = instsSelecionadas[0];
      const midiasVariacoes = await uploadMidias();
      const primeiraMidia = midiasVariacoes[0] ?? null;

      const { data: camp, error } = await supabase
        .from("campanhas")
        .insert({
          usuario_id: u.user.id,
          nome,
          mensagem: mensagem || (mensagensVariacoes[0] ?? ""),
          mensagens_variacoes: mensagensVariacoes.filter(Boolean) as unknown as import("@/integrations/supabase/types").Json,
          midias_variacoes: midiasVariacoes as unknown as import("@/integrations/supabase/types").Json,
          instancias_selecionadas: instsSelecionadas as unknown as import("@/integrations/supabase/types").Json,
          instancia_whatsapp: primeiraInstancia?.id ?? null,
          instancia_nome: primeiraInstancia?.nome ?? "",
          instancia_token: primeiraInstancia?.token ?? "",
          delay_minimo: delayMinimo,
          delay_maximo: delayMaximo,
          delay_mensagens: delayMensagens,
          delay_segundos: delayMinimo,
          horario_inicio: horarioInicio,
          horario_fim: horarioFim,
          midia_url: primeiraMidia?.url ?? null,
          midia_nome: primeiraMidia?.nome ?? null,
          midia_tipo: primeiraMidia?.tipo ?? null,
          midia_path: null,
          midia_bucket: primeiraMidia ? "midias" : null,
          total_contatos: contatos.length,
          status: agendarPara ? "agendada" : "em_andamento",
          agendada_para: formatarDataParaBRT(agendarPara),
        })
        .select()
        .single();

      if (error || !camp) { toast.error(error?.message ?? "Erro ao criar campanha"); return; }

      await supabase.from("contatos_campanha").insert(
        contatos.map((c) => ({ campanha_id: camp.id, telefone: c.telefone, nome: c.nome, empresa: c.empresa })),
      );

      toast.success("Campanha criada com sucesso!");
      navigate({ to: "/campanhas/$id", params: { id: camp.id } });
    } finally { setLoading(false); }
  };

  const totalContatos = origem === "csv" ? contatosCSV.length : leadsSel.length;
  const totalMidias = midiasFiles.length + midiasTemplates.length;
  const mensagemPrincipal = mensagensVariacoes.length > 0 ? `${mensagensVariacoes.length} variação(ões)` : mensagem ? "1 mensagem" : "—";
  const instSelecionadasNomes = instancias.filter((i) => instanciasSelecionadas.includes(i.id)).map((i) => i.nome);

  return (
    <div className="p-8 w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nova campanha</h1>
        <div className="flex items-center gap-2 mt-3 text-sm">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`flex items-center gap-2 ${step >= s ? "text-primary" : "text-muted-foreground"}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step >= s ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{s}</span>
              {["Configurações", "Contatos", "Revisão"][s - 1]}
              {s < 3 && <ChevronRight className="w-4 h-4" />}
            </div>
          ))}
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <Card className="p-6 space-y-4">
            <h2 className="font-semibold text-base">Dados da campanha</h2>

            <div className="space-y-2">
              <Label>Nome da campanha</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Prospecção Junho 2026" />
            </div>

            {/* Instâncias */}
            <div className="space-y-2">
              <Label>Instâncias do WhatsApp <span className="text-xs text-muted-foreground">(selecione uma ou mais — a mensagem sorteará entre elas)</span></Label>
              {instancias.length === 0 && (
                <p className="text-xs text-red-500">Cadastre instâncias em Configurações.</p>
              )}
              <div className="flex flex-col gap-2 p-3 border rounded-md">
                {instancias.map((i) => (
                  <label key={i.id} className="flex items-center gap-3 cursor-pointer">
                    <Checkbox
                      checked={instanciasSelecionadas.includes(i.id)}
                      onCheckedChange={() => toggleInstancia(i.id)}
                    />
                    <span className="text-sm font-medium">{i.nome}</span>
                    <span className="text-xs text-muted-foreground">({i.instancia})</span>
                  </label>
                ))}
              </div>
              {instanciasSelecionadas.length > 1 && (
                <p className="text-xs text-green-600 font-medium">
                  {instanciasSelecionadas.length} instâncias selecionadas — o sistema sorteia qual envia cada mensagem
                </p>
              )}
            </div>

            {/* Delays */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Delay Mínimo (s)</Label>
                <Input type="number" min={1} value={delayMinimo} onChange={(e) => setDelayMinimo(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Delay Máximo (s)</Label>
                <Input type="number" min={delayMinimo} value={delayMaximo} onChange={(e) => setDelayMaximo(Number(e.target.value))} />
              </div>
            </div>

            {/* Horário */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Horário início (BRT)</Label>
                <Input type="time" value={horarioInicio} onChange={(e) => setHorarioInicio(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Horário fim (BRT)</Label>
                <Input type="time" value={horarioFim} onChange={(e) => setHorarioFim(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Fora deste horário o motor pausa os disparos automaticamente.</p>

            <div className="space-y-2">
              <Label>Intervalo entre Mídia e Texto (s)</Label>
              <Input type="number" min={0} value={delayMensagens} onChange={(e) => setDelayMensagens(Number(e.target.value))} />
            </div>
          </Card>

          {/* Mensagens */}
          <Card className="p-6 space-y-4">
            <h2 className="font-semibold text-base">Mensagens</h2>

            <div className="space-y-2">
              <Label>
                Mensagem principal <span className="text-xs text-muted-foreground">(usada quando não há variações)</span>
              </Label>
              <Textarea
                rows={5}
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                placeholder="Olá {nome}, tudo bem?"
              />
              <p className="text-xs text-muted-foreground">Variáveis: {"{nome}"}, {"{empresa}"}, {"{telefone}"}</p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label>
                  Variações de mensagem <span className="text-xs text-muted-foreground">(o sistema sorteia uma por envio)</span>
                </Label>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setTemplateModal(true)} className="gap-1.5">
                    <Layers className="w-3 h-3" /> Carregar do template
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={adicionarVariacao}>
                    <Plus className="w-3 h-3 mr-1" /> Adicionar variação
                  </Button>
                </div>
              </div>

              {mensagensVariacoes.length === 0 && (
                <p className="text-xs text-muted-foreground italic">Sem variações — será usada a mensagem principal acima.</p>
              )}

              {mensagensVariacoes.map((v, i) => (
                <div key={i} className="flex gap-2">
                  <Textarea
                    rows={3}
                    className="flex-1 text-sm"
                    value={v}
                    onChange={(e) => atualizarVariacao(i, e.target.value)}
                    placeholder={`Variação ${i + 1} — use {nome}, {empresa}, {telefone}`}
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => removerVariacao(i)}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              ))}

              {mensagensVariacoes.length > 0 && (
                <p className="text-xs text-green-600 font-medium">
                  {mensagensVariacoes.filter(Boolean).length} variação(ões) ativa(s) — a mensagem principal será ignorada
                </p>
              )}
            </div>

            {/* Variações de mídia */}
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <Label>
                  Variações de mídia{" "}
                  <span className="text-xs text-muted-foreground">
                    (o sistema sorteia uma por envio — máx. 10)
                  </span>
                </Label>
                {totalMidias < 10 && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setMidiaTemplateModal(true)}
                      className="gap-1.5"
                    >
                      <Layers className="w-3 h-3" /> Dos templates
                    </Button>
                    <label className="cursor-pointer">
                      <Button type="button" variant="outline" size="sm" asChild>
                        <span><Plus className="w-3 h-3 mr-1" /> Arquivo local</span>
                      </Button>
                      <input
                        type="file"
                        accept="image/*,video/*,.pdf"
                        multiple
                        className="hidden"
                        onChange={(e) => adicionarMidia(e.target.files)}
                      />
                    </label>
                  </div>
                )}
              </div>

              {totalMidias === 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="cursor-pointer flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed rounded-lg text-muted-foreground hover:border-primary/50 transition-colors">
                    <UploadCloud className="w-6 h-6" />
                    <span className="text-sm font-medium">Enviar arquivo</span>
                    <span className="text-xs opacity-70">imagens, vídeos, pdf</span>
                    <input
                      type="file"
                      accept="image/*,video/*,.pdf"
                      multiple
                      className="hidden"
                      onChange={(e) => adicionarMidia(e.target.files)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setMidiaTemplateModal(true)}
                    className="flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed rounded-lg text-muted-foreground hover:border-primary/50 transition-colors"
                  >
                    <Layers className="w-6 h-6" />
                    <span className="text-sm font-medium">Dos templates</span>
                    <span className="text-xs opacity-70">mídias salvas</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {midiasFiles.map((f, i) => (
                    <MidiaThumb key={`file-${i}`} file={f} onRemove={() => removerMidia(i)} />
                  ))}
                  {midiasTemplates.map((t, i) => (
                    <MidiaThumbUrl key={`tpl-${i}`} url={t.url} nome={t.nome} tipo={t.tipo} onRemove={() => removerMidiaTemplate(i)} />
                  ))}
                </div>
              )}

              {totalMidias > 0 && (
                <p className="text-xs text-green-600 font-medium">
                  {totalMidias} mídia(s) — o sistema sorteia qual será enviada para cada contato
                </p>
              )}
            </div>
          </Card>
        </div>
      )}

      {step === 2 && (
        <Card className="p-6">
          <Tabs value={origem} onValueChange={(v) => setOrigem(v as "csv" | "lista")}>
            <TabsList>
              <TabsTrigger value="csv">Importar CSV</TabsTrigger>
              <TabsTrigger value="lista">Lista salva (Pastas)</TabsTrigger>
            </TabsList>

            <TabsContent value="csv" className="space-y-4 mt-4">
              <Input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && handleCSV(e.target.files[0])} />
              <p className="text-sm text-muted-foreground">Colunas: telefone (obrigatória), nome, empresa</p>
              {contatosCSV.length > 0 && (
                <div className="text-sm">
                  <p className="mb-2 font-medium">{contatosCSV.length} contatos válidos. Prévia:</p>
                  <ul className="space-y-1 text-muted-foreground">
                    {contatosCSV.slice(0, 5).map((c, i) => <li key={i}>{c.telefone} — {c.nome || "—"}</li>)}
                  </ul>
                </div>
              )}
            </TabsContent>

            <TabsContent value="lista" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Selecione as pastas:</Label>
                <div className="flex flex-wrap gap-4 p-3 bg-muted rounded">
                  {pastas.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={pastasSel.includes(p.id)}
                        onCheckedChange={(c) => setPastasSel(c ? [...pastasSel, p.id] : pastasSel.filter((x) => x !== p.id))}
                      />
                      <span className="text-sm font-medium">{p.nome}</span>
                    </label>
                  ))}
                  {!pastas.length && <p className="text-sm text-muted-foreground">Nenhuma pasta. Crie uma em Meus Leads.</p>}
                </div>
              </div>

              {pastasSel.length > 0 && (
                <div className="space-y-3 border-t pt-4">
                  {/* Cabeçalho com total e ações globais */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <Label>Leads ({leadsDaPasta.length})</Label>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setLeadsSel(leadsDaPasta.map((l) => l.telefone))}>Marcar todos</Button>
                      <Button variant="outline" size="sm" onClick={() => setLeadsSel([])}>Desmarcar</Button>
                    </div>
                  </div>

                  {/* Seleção rápida por lote */}
                  <div className="flex items-center gap-2 flex-wrap p-3 bg-muted/50 rounded-lg">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Próximos:</span>
                    {[10, 20, 50, 100, 200, 500].map((n) => {
                      const disponiveis = leadsDaPasta.filter((l) => !leadsSelSet.has(l.telefone)).length;
                      const label = Math.min(n, disponiveis);
                      if (disponiveis === 0) return null;
                      return (
                        <Button
                          key={n}
                          variant="outline"
                          size="sm"
                          disabled={disponiveis === 0}
                          onClick={() => selecionarProximos(n)}
                          className="h-7 px-3 text-xs font-medium"
                        >
                          +{label}
                        </Button>
                      );
                    })}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {leadsDaPasta.filter((l) => !leadsSelSet.has(l.telefone)).length} disponíveis
                    </span>
                  </div>

                  {/* Lista de leads */}
                  <div className="max-h-64 overflow-y-auto space-y-1 p-2 border rounded">
                    {leadsDaPasta.map((l) => (
                      <label key={l.id} className="flex items-center gap-3 p-2 hover:bg-muted rounded cursor-pointer">
                        <Checkbox
                          checked={leadsSelSet.has(l.telefone)}
                          onCheckedChange={(c) => setLeadsSel(c ? [...leadsSel, l.telefone] : leadsSel.filter((x) => x !== l.telefone))}
                        />
                        <span className="text-sm w-32">{l.telefone}</span>
                        <span className="text-sm text-muted-foreground flex-1">{l.nome || "Sem nome"}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-sm font-medium text-primary">Selecionados: {leadsSel.length}</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </Card>
      )}

      {step === 3 && (
        <Card className="p-6 space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div><Label className="text-muted-foreground">Nome</Label><p className="font-medium">{nome}</p></div>
              <div>
                <Label className="text-muted-foreground">Instâncias selecionadas</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {instSelecionadasNomes.map((n) => (
                    <span key={n} className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full">{n}</span>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-muted-foreground">Delay min</Label><p>{delayMinimo}s</p></div>
                <div><Label className="text-muted-foreground">Delay max</Label><p>{delayMaximo}s</p></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-muted-foreground">Horário início</Label><p>{horarioInicio}</p></div>
                <div><Label className="text-muted-foreground">Horário fim</Label><p>{horarioFim}</p></div>
              </div>
              <div><Label className="text-muted-foreground">Contatos</Label><p className="font-bold text-primary">{totalContatos}</p></div>
            </div>
            <div className="space-y-4">
              <div><Label className="text-muted-foreground">Mensagens</Label><p>{mensagemPrincipal}</p></div>
              <div>
                <Label className="text-muted-foreground">Mídias</Label>
                <p>{totalMidias > 0 ? `${totalMidias} arquivo(s)` : "Nenhuma"}</p>
                {totalMidias > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {midiasFiles.map((f, i) => (
                      <span key={`f-${i}`} className="text-xs bg-muted px-2 py-0.5 rounded truncate max-w-[140px]">{f.name}</span>
                    ))}
                    {midiasTemplates.map((t, i) => (
                      <span key={`t-${i}`} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded truncate max-w-[140px]">{t.nome}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Agendar para (opcional)</Label>
                <Input type="datetime-local" value={agendarPara} onChange={(e) => setAgendarPara(e.target.value)} />
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" disabled={step === 1} onClick={() => setStep(step - 1)}>Voltar</Button>
        {step < 3 ? (
          <Button
            onClick={() => setStep(step + 1)}
            disabled={
              (step === 1 && (!nome || instanciasSelecionadas.length === 0 || (!mensagem && mensagensVariacoes.filter(Boolean).length === 0))) ||
              (step === 2 && totalContatos === 0)
            }
          >
            Continuar
          </Button>
        ) : (
          <Button onClick={disparar} disabled={loading || instanciasSelecionadas.length === 0}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Criar Campanha
          </Button>
        )}
      </div>

      <LoadTemplateModal
        open={templateModal}
        onClose={() => setTemplateModal(false)}
        onCarregar={(msgs) => {
          setMensagensVariacoes(msgs);
          setTemplateModal(false);
          toast.success(`${msgs.length} variação(ões) carregada(s) do template!`);
        }}
      />

      <LoadMidiaTemplateModal
        open={midiaTemplateModal}
        onClose={() => setMidiaTemplateModal(false)}
        jaAdicionadas={midiasTemplates.map((t) => t.url)}
        limite={10 - midiasFiles.length - midiasTemplates.length}
        onAdicionar={(items) => {
          adicionarMidiasTemplate(items);
          setMidiaTemplateModal(false);
        }}
      />
    </div>
  );
}

interface MediaTemplateItem {
  id: string;
  nome: string;
  url: string;
  tipo: string;
  mimetype: string;
  storage_path: string;
}

function LoadMidiaTemplateModal({
  open,
  onClose,
  jaAdicionadas,
  limite,
  onAdicionar,
}: {
  open: boolean;
  onClose: () => void;
  jaAdicionadas: string[];
  limite: number;
  onAdicionar: (items: { url: string; nome: string; tipo: string; mimetype: string }[]) => void;
}) {
  const [midias, setMidias] = useState<MediaTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) { setSelecionadas(new Set()); return; }
    setLoading(true);
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await (supabase as any)
        .from("media_templates")
        .select("id,nome,url,tipo,mimetype,storage_path")
        .eq("usuario_id", u.user.id)
        .order("criado_em", { ascending: false });
      setMidias((data ?? []) as MediaTemplateItem[]);
      setLoading(false);
    })();
  }, [open]);

  const toggleSel = (url: string) => {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(url)) { next.delete(url); return next; }
      if (next.size >= limite) return prev;
      next.add(url);
      return next;
    });
  };

  const confirmar = () => {
    const items = midias
      .filter((m) => selecionadas.has(m.url))
      .map((m) => ({ url: m.url, nome: m.nome, tipo: m.tipo, mimetype: m.mimetype }));
    onAdicionar(items);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" /> Selecionar mídias dos templates
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Selecione até {limite} mídia(s). Já adicionadas: {jaAdicionadas.length}.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-2">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : midias.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-10">
              Nenhuma mídia salva. Adicione em <strong>Templates → Mídias</strong>.
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 p-1">
              {midias.map((m) => {
                const jaEsta = jaAdicionadas.includes(m.url);
                const sel = selecionadas.has(m.url);
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={jaEsta}
                    onClick={() => toggleSel(m.url)}
                    className={`relative rounded-lg border-2 overflow-hidden aspect-square transition-all ${
                      jaEsta
                        ? "opacity-40 cursor-not-allowed border-muted"
                        : sel
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    {m.tipo === "image" ? (
                      <img src={m.url} alt={m.nome} className="w-full h-full object-cover" />
                    ) : m.tipo === "video" ? (
                      <video src={m.url} className="w-full h-full object-cover" muted />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground text-xs p-2">
                        <FileText className="w-8 h-8" />
                        <span className="truncate w-full text-center">{m.nome}</span>
                      </div>
                    )}
                    {sel && (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1.5 py-1">
                      <p className="text-white text-xs truncate">{m.nome}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar} disabled={selecionadas.size === 0} className="gap-2">
            <Check className="w-4 h-4" />
            Adicionar {selecionadas.size > 0 ? `${selecionadas.size} mídia(s)` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface TemplateItem {
  id: string;
  nome: string;
  mensagem: string;
  variacoes: string[];
}

function LoadTemplateModal({
  open, onClose, onCarregar,
}: {
  open: boolean;
  onClose: () => void;
  onCarregar: (msgs: string[]) => void;
}) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecionado, setSelecionado] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelecionado(null);
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await (supabase as any)
        .from("message_templates")
        .select("id,nome,mensagem,variacoes")
        .eq("usuario_id", u.user.id)
        .order("atualizado_em", { ascending: false });
      setTemplates(((data ?? []) as TemplateItem[]).map((t) => ({ ...t, variacoes: t.variacoes ?? [] })));
      setLoading(false);
    })();
  }, [open]);

  const confirmar = () => {
    const t = templates.find((x) => x.id === selecionado);
    if (!t) return;
    const msgs = t.variacoes.length > 0 ? t.variacoes : [t.mensagem];
    onCarregar(msgs.filter(Boolean));
  };

  const packs = templates.filter((t) => t.variacoes.length > 0);
  const singles = templates.filter((t) => t.variacoes.length === 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" /> Carregar variações do template
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Selecione um template — suas mensagens substituirão as variações atuais.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              Nenhum template encontrado. Crie um em <strong>Templates</strong>.
            </p>
          ) : (
            <>
              {packs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Packs de variações</p>
                  {packs.map((t) => (
                    <label
                      key={t.id}
                      className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-colors ${
                        selecionado === t.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                      }`}
                    >
                      <input
                        type="radio"
                        name="template"
                        value={t.id}
                        checked={selecionado === t.id}
                        onChange={() => setSelecionado(t.id)}
                        className="accent-primary mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{t.nome}</span>
                          <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold">
                            {t.variacoes.length} msgs
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{t.variacoes[0]}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {singles.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mensagens individuais</p>
                  {singles.map((t) => (
                    <label
                      key={t.id}
                      className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-colors ${
                        selecionado === t.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                      }`}
                    >
                      <input
                        type="radio"
                        name="template"
                        value={t.id}
                        checked={selecionado === t.id}
                        onChange={() => setSelecionado(t.id)}
                        className="accent-primary mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-sm">{t.nome}</span>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.mensagem}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar} disabled={!selecionado} className="gap-2">
            <Layers className="w-4 h-4" />
            {selecionado
              ? `Carregar ${(() => { const t = templates.find((x) => x.id === selecionado); return t?.variacoes.length ? `${t.variacoes.length} variações` : "1 variação"; })()}`
              : "Selecione um template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
