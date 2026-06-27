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
import { Loader2, ChevronRight, UploadCloud, X } from "lucide-react";
import { isValidPhone, toE164BR } from "@/lib/phone";
import { parseCSV } from "@/lib/csv";
import { dispararCampanha } from "@/lib/webhooks";

export const Route = createFileRoute("/_authenticated/campanhas/nova")({
  component: NovaCampanha,
});

interface Contato { telefone: string; nome: string; empresa: string }
interface Instancia { id: string; nome: string; instancia: string; token: string | null }

function NovaCampanha() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [nome, setNome] = useState("");
  const [mensagem, setMensagem] = useState("Olá {nome}, tudo bem?");
  
  // New Delay States
  const [delayMinimo, setDelayMinimo] = useState(5);
  const [delayMaximo, setDelayMaximo] = useState(15);
  const [delayMensagens, setDelayMensagens] = useState(3);
  
  // Instance State
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [instanciaId, setInstanciaId] = useState("");
  
  // Media State
  const [midiaFile, setMidiaFile] = useState<File | null>(null);

  const [agendarPara, setAgendarPara] = useState("");
  
  const [pastas, setPastas] = useState<{ id: string; nome: string }[]>([]);
  const [pastasSel, setPastasSel] = useState<string[]>([]);
  
  // Leads for step 2
  const [leadsDaPasta, setLeadsDaPasta] = useState<(Contato & { id: string })[]>([]);
  const [leadsSel, setLeadsSel] = useState<string[]>([]); // array of telefones
  
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
      const filteredInsts = (insts ?? []).filter(i => i.instancia !== 'r1b5f62949ba437');
      setInstancias(filteredInsts);
      if (filteredInsts.length > 0) setInstanciaId(filteredInsts[0].id);
    })();
  }, []);

  // When selected folders change, fetch their leads
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
        .filter(l => isValidPhone(l.telefone))
        .map(l => ({ id: l.id, telefone: toE164BR(l.telefone), nome: l.nome ?? "", empresa: l.empresa ?? "" }));
      
      setLeadsDaPasta(validos);
      // Auto-select all by default
      setLeadsSel(validos.map(l => l.telefone));
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
    return leadsDaPasta.filter(l => leadsSelSet.has(l.telefone));
  };

  interface MidiaInfo {
    url: string;
    name: string;
    type: string;
    path: string;
    bucket: string;
  }

  const uploadMidia = async (): Promise<MidiaInfo | null> => {
    if (!midiaFile) return null;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return null;
    
    const ext = midiaFile.name.split('.').pop();
    const fileName = `${u.user.id}/${Date.now()}.${ext}`;
    const bucketName = "midias";
    
    const { data, error } = await supabase.storage.from(bucketName).upload(fileName, midiaFile);
    if (error) {
      toast.error("Erro ao enviar mídia: " + error.message);
      return null;
    }
    
    const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(fileName);
    return {
      url: urlData.publicUrl,
      name: midiaFile.name,
      type: midiaFile.type,
      path: fileName,
      bucket: bucketName,
    };
  };

  const formatarDataParaBRT = (dataLocal: string): string | null => {
    if (!dataLocal) return null;
    // datetime-local retorna "YYYY-MM-DDTHH:mm"
    // Anexa segundos (:00) e fuso de Brasília (-03:00)
    return `${dataLocal}:00-03:00`;
  };

  const disparar = async () => {
    if (!instanciaId) return toast.error("Selecione uma instância de WhatsApp.");
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const contatos = getContatos();
      if (!contatos.length) { toast.error("Nenhum contato válido selecionado"); return; }

      const instancia = instancias.find(i => i.id === instanciaId);
      if (!instancia) return toast.error("Instância inválida");

      const { data: cfg } = await supabase
        .from("configuracoes").select("*").eq("usuario_id", u.user.id).maybeSingle();

      let midiaInfo = null;
      if (midiaFile) {
        midiaInfo = await uploadMidia();
      }

      const { data: camp, error } = await supabase
        .from("campanhas")
        .insert({
          usuario_id: u.user.id,
          nome,
          mensagem,
          instancia_whatsapp: instancia.id,
          instancia_nome: instancia.nome,
          instancia_token: instancia.token ?? "",
          delay_minimo: delayMinimo,
          delay_maximo: delayMaximo,
          delay_mensagens: delayMensagens,
          delay_segundos: delayMinimo, // retrocompatibilidade
          midia_url: midiaInfo?.url ?? null,
          midia_nome: midiaInfo?.name ?? null,
          midia_tipo: midiaInfo?.type ?? null,
          midia_path: midiaInfo?.path ?? null,
          midia_bucket: midiaInfo?.bucket ?? null,
          total_contatos: contatos.length,
          status: agendarPara ? "agendada" : "aguardando",
          agendada_para: formatarDataParaBRT(agendarPara),
        })
        .select().single();
      if (error || !camp) { toast.error(error?.message ?? "Erro"); return; }

      await supabase.from("contatos_campanha").insert(
        contatos.map((c) => ({ campanha_id: camp.id, telefone: c.telefone, nome: c.nome, empresa: c.empresa }))
      );

      toast.success("Campanha criada com sucesso!");
      navigate({ to: "/campanhas/$id", params: { id: camp.id } });
    } finally { setLoading(false); }
  };

  const totalContatos = origem === "csv" ? contatosCSV.length : leadsSel.length;

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
        <Card className="p-6 space-y-4">
            <div className="space-y-2">
              <Label>Nome da campanha</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            
            <div className="space-y-2">
              <Label>Instância do WhatsApp</Label>
              <select 
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={instanciaId} 
                onChange={(e) => setInstanciaId(e.target.value)}
              >
                <option value="" disabled>Selecione uma instância</option>
                {instancias.map(i => (
                  <option key={i.id} value={i.id}>{i.nome} ({i.instancia})</option>
                ))}
              </select>
              {instancias.length === 0 && <p className="text-xs text-red-500">Cadastre uma instância em Configurações.</p>}
            </div>

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
            <div className="space-y-2">
              <Label>Intervalo entre Mídia e Mensagem (s)</Label>
              <Input type="number" min={1} value={delayMensagens} onChange={(e) => setDelayMensagens(Number(e.target.value))} />
              <p className="text-xs text-muted-foreground">Tempo de espera do n8n para enviar a foto e depois a mensagem.</p>
            </div>

            <div className="space-y-2">
              <Label>Mídia (Opcional)</Label>
              <div className="flex flex-col gap-3">
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
                      <div className="w-16 h-16 bg-muted rounded-md border flex items-center justify-center overflow-hidden cursor-pointer hover:opacity-80 transition-opacity" title="Clique para ampliar">
                        {midiaFile.type.startsWith("image/") ? (
                          <img src={URL.createObjectURL(midiaFile)} alt="Prévia da Mídia" className="w-full h-full object-cover" />
                        ) : midiaFile.type.startsWith("video/") ? (
                          <video src={URL.createObjectURL(midiaFile)} className="w-full h-full object-cover" muted />
                        ) : (
                          <div className="p-1 text-center">
                            <UploadCloud className="w-6 h-6 mx-auto text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl border-none bg-transparent shadow-none p-0 flex justify-center outline-none">
                      {midiaFile.type.startsWith("image/") ? (
                        <img src={URL.createObjectURL(midiaFile)} alt="Prévia Ampliada" className="max-h-[85vh] rounded-lg object-contain" />
                      ) : midiaFile.type.startsWith("video/") ? (
                        <video src={URL.createObjectURL(midiaFile)} className="max-h-[85vh] rounded-lg object-contain" controls autoPlay />
                      ) : (
                        <div className="bg-background p-8 rounded-lg text-center max-w-md w-full">
                          <UploadCloud className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                          <p className="font-medium text-lg">{midiaFile.name}</p>
                          <p className="text-sm text-muted-foreground mt-2">O preview deste tipo de arquivo não está disponível no navegador.</p>
                        </div>
                      )}
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Mensagem</Label>
              <Textarea rows={6} value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
              <p className="text-xs text-muted-foreground">Variáveis: {"{nome}"}, {"{empresa}"}, {"{telefone}"}</p>
            </div>
          </Card>
      )}

      {step === 2 && (
        <Card className="p-6">
          <Tabs value={origem} onValueChange={(v) => setOrigem(v as "csv" | "lista")}>
            <TabsList><TabsTrigger value="csv">Importar CSV</TabsTrigger><TabsTrigger value="lista">Lista salva (Pastas)</TabsTrigger></TabsList>
            
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
                    <Label>Leads nas pastas selecionadas ({leadsDaPasta.length})</Label>
                    <div className="space-x-2">
                      <Button variant="outline" size="sm" onClick={() => setLeadsSel(leadsDaPasta.map(l => l.telefone))}>Marcar Todos</Button>
                      <Button variant="outline" size="sm" onClick={() => setLeadsSel([])}>Desmarcar Todos</Button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-1 p-2 border rounded">
                    {leadsDaPasta.map((l) => (
                      <label key={l.id} className="flex items-center gap-3 p-2 hover:bg-muted rounded cursor-pointer">
                        <Checkbox
                          checked={leadsSelSet.has(l.telefone)}
                          onCheckedChange={(c) => setLeadsSel(c ? [...leadsSel, l.telefone] : leadsSel.filter(x => x !== l.telefone))}
                        />
                        <span className="text-sm w-32">{l.telefone}</span>
                        <span className="text-sm text-muted-foreground flex-1">{l.nome || "Sem nome"}</span>
                      </label>
                    ))}
                    {leadsDaPasta.length === 0 && <p className="text-sm text-muted-foreground">Nenhum lead com telefone válido encontrado nestas pastas.</p>}
                  </div>
                  <p className="text-sm font-medium text-primary">Contatos selecionados: {leadsSel.length}</p>
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
              <div><Label className="text-muted-foreground">Nome da Campanha</Label><p className="font-medium">{nome}</p></div>
              <div>
                <Label className="text-muted-foreground">Instância</Label>
                <p className="font-medium">{instancias.find(i => i.id === instanciaId)?.nome || "Não selecionada"}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-muted-foreground">Delay Min</Label><p>{delayMinimo}s</p></div>
                <div><Label className="text-muted-foreground">Delay Max</Label><p>{delayMaximo}s</p></div>
              </div>
              <div><Label className="text-muted-foreground">Intervalo entre Mídia/Mensagem</Label><p>{delayMensagens}s</p></div>
              <div><Label className="text-muted-foreground">Contatos Selecionados</Label><p className="font-bold text-primary">{totalContatos}</p></div>
            </div>
            
            <div className="space-y-4">
              <div>
                <Label className="text-muted-foreground">Mídia Anexada</Label>
                <p className="font-medium">{midiaFile ? midiaFile.name : "Nenhuma"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Mensagem</Label>
                <p className="text-sm whitespace-pre-wrap p-3 bg-muted rounded h-32 overflow-y-auto">{mensagem}</p>
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
          <Button onClick={() => setStep(step + 1)} disabled={(step === 1 && (!nome || !instanciaId)) || (step === 2 && totalContatos === 0)}>Continuar</Button>
        ) : (
          <Button onClick={disparar} disabled={loading || !instanciaId}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Criar Campanha
          </Button>
        )}
      </div>
    </div>
  );
}