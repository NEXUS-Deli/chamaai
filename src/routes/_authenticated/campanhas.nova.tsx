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
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2, ChevronRight, UploadCloud, X, Plus, Trash2,
} from "lucide-react";
import { isValidPhone, toE164BR } from "@/lib/phone";
import { parseCSV } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/campanhas/nova")({
  component: NovaCampanha,
});

interface Contato { telefone: string; nome: string; empresa: string }
interface Instancia { id: string; nome: string; instancia: string; token: string | null }

function NovaCampanha() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [nome, setNome] = useState("");

  // Mensagem única (fallback quando não há variações)
  const [mensagem, setMensagem] = useState("");
  // Variações de mensagem para sorteio
  const [mensagensVariacoes, setMensagensVariacoes] = useState<string[]>([]);

  const [delayMinimo, setDelayMinimo] = useState(5);
  const [delayMaximo, setDelayMaximo] = useState(15);
  const [delayMensagens, setDelayMensagens] = useState(3);
  const [horarioInicio, setHorarioInicio] = useState("08:00");
  const [horarioFim, setHorarioFim] = useState("22:00");

  // Múltiplas instâncias
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [instanciasSelecionadas, setInstanciasSelecionadas] = useState<string[]>([]);

  const [midiaFile, setMidiaFile] = useState<File | null>(null);
  const [agendarPara, setAgendarPara] = useState("");

  const [pastas, setPastas] = useState<{ id: string; nome: string }[]>([]);
  const [pastasSel, setPastasSel] = useState<string[]>([]);
  const [leadsDaPasta, setLeadsDaPasta] = useState<(Contato & { id: string })[]>([]);
  const [leadsSel, setLeadsSel] = useState<string[]>([]);
  const leadsSelSet = useMemo(() => new Set(leadsSel), [leadsSel]);

  const [contatosCSV, setContatosCSV] = useState<Contato[]>([]);
  const [origem, setOrigem] = useState<"csv" | "lista">("csv");
  const [loading, setLoading] = useState(false);

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
      const { data } = await supabase
        .from("leads")
        .select("id, telefone, nome, empresa")
        .eq("usuario_id", u.user.id)
        .in("pasta_id", pastasSel);

      const validos = (data ?? [])
        .filter((l) => isValidPhone(l.telefone))
        .map((l) => ({ id: l.id, telefone: toE164BR(l.telefone), nome: l.nome ?? "", empresa: l.empresa ?? "" }));

      setLeadsDaPasta(validos);
      setLeadsSel(validos.map((l) => l.telefone));
    })();
  }, [pastasSel, origem]);

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

  const uploadMidia = async () => {
    if (!midiaFile) return null;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return null;
    const ext = midiaFile.name.split(".").pop();
    const fileName = `${u.user.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("midias").upload(fileName, midiaFile);
    if (error) { toast.error("Erro ao enviar mídia: " + error.message); return null; }
    const { data: urlData } = supabase.storage.from("midias").getPublicUrl(fileName);
    return { url: urlData.publicUrl, name: midiaFile.name, type: midiaFile.type, path: fileName, bucket: "midias" };
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
      const midiaInfo = midiaFile ? await uploadMidia() : null;

        const { data: camp, error } = await supabase
        .from("campanhas")
        .insert({
          usuario_id: u.user.id,
          nome,
          mensagem: mensagem || (mensagensVariacoes[0] ?? ""),
          mensagens_variacoes: mensagensVariacoes.filter(Boolean) as unknown as import("@/integrations/supabase/types").Json,
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
          midia_url: midiaInfo?.url ?? null,
          midia_nome: midiaInfo?.name ?? null,
          midia_tipo: midiaInfo?.type ?? null,
          midia_path: midiaInfo?.path ?? null,
          midia_bucket: midiaInfo?.bucket ?? null,
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

            {/* Instâncias — múltipla seleção */}
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

            {/* Horário de envio */}
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
              <div className="flex items-center justify-between">
                <Label>
                  Variações de mensagem <span className="text-xs text-muted-foreground">(o sistema sorteia uma por envio)</span>
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={adicionarVariacao}>
                  <Plus className="w-3 h-3 mr-1" /> Adicionar variação
                </Button>
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

            {/* Mídia */}
            <div className="space-y-2">
              <Label>Mídia (opcional)</Label>
              <div className="flex items-center gap-2">
                <Input type="file" accept="image/*,video/*,.pdf" onChange={(e) => setMidiaFile(e.target.files?.[0] || null)} />
                {midiaFile && (
                  <Button variant="ghost" size="icon" onClick={() => setMidiaFile(null)}>
                    <X className="w-4 h-4 text-red-500" />
                  </Button>
                )}
              </div>
              {midiaFile && (
                <Dialog>
                  <DialogTrigger asChild>
                    <div className="w-16 h-16 bg-muted rounded-md border flex items-center justify-center overflow-hidden cursor-pointer hover:opacity-80">
                      {midiaFile.type.startsWith("image/") ? (
                        <img src={URL.createObjectURL(midiaFile)} alt="Prévia" className="w-full h-full object-cover" />
                      ) : midiaFile.type.startsWith("video/") ? (
                        <video src={URL.createObjectURL(midiaFile)} className="w-full h-full object-cover" muted />
                      ) : (
                        <UploadCloud className="w-6 h-6 text-muted-foreground" />
                      )}
                    </div>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl border-none bg-transparent shadow-none p-0 flex justify-center">
                    {midiaFile.type.startsWith("image/") ? (
                      <img src={URL.createObjectURL(midiaFile)} alt="Prévia" className="max-h-[85vh] rounded-lg object-contain" />
                    ) : midiaFile.type.startsWith("video/") ? (
                      <video src={URL.createObjectURL(midiaFile)} className="max-h-[85vh] rounded-lg" controls autoPlay />
                    ) : (
                      <div className="bg-background p-8 rounded-lg text-center">
                        <UploadCloud className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                        <p className="font-medium">{midiaFile.name}</p>
                      </div>
                    )}
                  </DialogContent>
                </Dialog>
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
                <div className="space-y-2 border-t pt-4">
                  <div className="flex items-center justify-between">
                    <Label>Leads ({leadsDaPasta.length})</Label>
                    <div className="space-x-2">
                      <Button variant="outline" size="sm" onClick={() => setLeadsSel(leadsDaPasta.map((l) => l.telefone))}>Marcar todos</Button>
                      <Button variant="outline" size="sm" onClick={() => setLeadsSel([])}>Desmarcar</Button>
                    </div>
                  </div>
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
              <div><Label className="text-muted-foreground">Mídia</Label><p>{midiaFile ? midiaFile.name : "Nenhuma"}</p></div>
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
    </div>
  );
}
