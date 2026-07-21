import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, XCircle, Loader2, PhoneCall, Download, BookmarkPlus, AlertCircle, Users, FolderPlus, Folder, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FerramentasNav } from "@/components/ferramentas-nav";
import { downloadCSV } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/ferramentas/verificador")({
  component: Verificador,
});

interface Instancia { id: string; nome: string; token: string }
interface Pasta { id: string; nome: string }

interface CheckResult {
  query: string;
  jid: string;
  lid?: string;
  isInWhatsapp: boolean;
  verifiedName?: string;
  groupName?: string;
  error?: string;
  leadId?: string;
}

interface LeadDaPasta { id: string; telefone: string; nome: string | null }

type Filtro = "todos" | "com" | "sem";
type Origem = "colar" | "pasta";

function normalizarNumero(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (!d || d.length < 8) return "";
  if ((d.length === 10 || d.length === 11) && !d.startsWith("55")) return "55" + d;
  return d;
}

function Verificador() {
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [instanciaId, setInstanciaId] = useState("");
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [numeros, setNumeros] = useState("");
  const [loading, setLoading] = useState(false);
  const [resultados, setResultados] = useState<CheckResult[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("todos");

  // Origem dos números: colar manualmente ou selecionar pasta(s) de leads existentes
  const [origem, setOrigem] = useState<Origem>("colar");
  const [pastasOrigemSel, setPastasOrigemSel] = useState<string[]>([]);
  const [leadsDaPasta, setLeadsDaPasta] = useState<LeadDaPasta[]>([]);
  const [carregandoLeads, setCarregandoLeads] = useState(false);

  // Exclusão real dos leads "sem WhatsApp" carregados de pasta
  const [selecionadosExcluir, setSelecionadosExcluir] = useState<Set<string>>(new Set());
  const [excluindo, setExcluindo] = useState(false);

  // Modal de pasta
  const [modalAberto, setModalAberto] = useState(false);
  const [pastaSelecionada, setPastaSelecionada] = useState<string>("sem-pasta");
  const [novaPastaNome, setNovaPastaNome] = useState("");
  const [criandoPasta, setCriandoPasta] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [{ data: insts }, { data: ps }] = await Promise.all([
        supabase.from("instancias").select("id,nome,token").eq("usuario_id", u.user.id),
        supabase.from("pastas").select("id,nome").eq("usuario_id", u.user.id).order("nome"),
      ]);
      const lista = insts ?? [];
      setInstancias(lista);
      if (lista[0]) setInstanciaId(lista[0].id);
      setPastas(ps ?? []);
    })();
  }, []);

  // Busca os leads das pastas selecionadas como origem, paginado em lotes de 1000
  // (mesmo padrão de leads.tsx / campanhas.nova.tsx)
  useEffect(() => {
    if (origem !== "pasta" || pastasOrigemSel.length === 0) {
      setLeadsDaPasta([]);
      return;
    }
    let cancelado = false;
    (async () => {
      setCarregandoLeads(true);
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) return;
        const BATCH = 1000;
        let from = 0;
        const todos: LeadDaPasta[] = [];
        for (;;) {
          const { data, error } = await supabase
            .from("leads")
            .select("id, telefone, nome")
            .eq("usuario_id", u.user.id)
            .in("pasta_id", pastasOrigemSel)
            .range(from, from + BATCH - 1);
          if (error) throw new Error(error.message);
          todos.push(...((data ?? []) as LeadDaPasta[]));
          if (!data || data.length < BATCH) break;
          from += BATCH;
        }
        if (!cancelado) setLeadsDaPasta(todos);
      } catch (e) {
        if (!cancelado) toast.error("Erro ao carregar leads da pasta: " + String(e instanceof Error ? e.message : e));
      } finally {
        if (!cancelado) setCarregandoLeads(false);
      }
    })();
    return () => { cancelado = true; };
  }, [origem, pastasOrigemSel]);

  const trocarOrigem = (novaOrigem: Origem) => {
    setOrigem(novaOrigem);
    setResultados([]);
    setFiltro("todos");
    setSelecionadosExcluir(new Set());
  };

  const togglePastaOrigem = (id: string) => {
    setPastasOrigemSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const verificar = async () => {
    const inst = instancias.find((i) => i.id === instanciaId);
    if (!inst) return toast.error("Selecione uma instância conectada");

    // Mapa numeroNormalizado -> leadId, usado só no modo "pasta" pra depois saber
    // exatamente qual lead cada resultado representa (garante exclusão precisa).
    const mapaLeadPorNumero = new Map<string, string>();
    let linhas: string[];

    if (origem === "pasta") {
      if (!leadsDaPasta.length) return toast.error("Nenhum lead carregado nas pastas selecionadas");
      for (const l of leadsDaPasta) {
        const n = normalizarNumero(l.telefone);
        if (n) mapaLeadPorNumero.set(n, l.id);
      }
      linhas = [...mapaLeadPorNumero.keys()];
    } else {
      linhas = numeros.split(/[\n,;]+/).map(normalizarNumero).filter(Boolean);
    }

    if (!linhas.length) return toast.error("Nenhum número válido para verificar (mínimo 8 dígitos)");

    setLoading(true);
    setResultados([]);
    setFiltro("todos");
    setSelecionadosExcluir(new Set());
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-proxy", {
        body: { action: "check_numbers", payload: { token: inst.token, numbers: linhas } },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const arrBruto: CheckResult[] = Array.isArray(data) ? data : data ? [data] : [];
      if (!arrBruto.length) throw new Error("A API retornou uma resposta vazia");

      const arr = origem === "pasta"
        ? arrBruto.map((r) => ({ ...r, leadId: mapaLeadPorNumero.get(r.query) }))
        : arrBruto;

      setResultados(arr);

      // Pré-seleciona pra exclusão todos os "sem WhatsApp" que vieram de um lead real
      if (origem === "pasta") {
        setSelecionadosExcluir(new Set(arr.filter((r) => !r.isInWhatsapp && r.leadId).map((r) => r.leadId!)));
      }

      const validos = arr.filter((r) => r.isInWhatsapp).length;
      toast.success(`${arr.length} verificado(s) — ${validos} com WhatsApp`);
    } catch (e) {
      toast.error("Erro: " + String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  const excluirSemWhatsAppDaPasta = async () => {
    if (!selecionadosExcluir.size) return;
    if (!confirm(`Excluir ${selecionadosExcluir.size} contato(s) sem WhatsApp da pasta? Esta ação não pode ser desfeita.`)) return;

    setExcluindo(true);
    try {
      const ids = [...selecionadosExcluir];
      for (let i = 0; i < ids.length; i += 200) {
        const lote = ids.slice(i, i + 200);
        const { error } = await supabase.from("leads").delete().in("id", lote);
        if (error) throw error;
      }
      setResultados((prev) => prev.filter((r) => !r.leadId || !selecionadosExcluir.has(r.leadId)));
      setLeadsDaPasta((prev) => prev.filter((l) => !selecionadosExcluir.has(l.id)));
      toast.success(`${ids.length} contato(s) excluído(s) da pasta`);
      setSelecionadosExcluir(new Set());
    } catch (e) {
      toast.error("Erro ao excluir: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExcluindo(false);
    }
  };

  const abrirModalSalvar = () => {
    setPastaSelecionada(pastas[0]?.id ?? "sem-pasta");
    setNovaPastaNome("");
    setModalAberto(true);
  };

  const criarPastaESelecionar = async () => {
    const nome = novaPastaNome.trim();
    if (!nome) return toast.error("Digite um nome para a pasta");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    setCriandoPasta(true);
    try {
      const { data, error } = await supabase
        .from("pastas")
        .insert({ nome, usuario_id: u.user.id })
        .select("id,nome")
        .single();
      if (error) throw new Error(error.message ?? JSON.stringify(error));
      setPastas((prev) => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)));
      setPastaSelecionada(data.id);
      setNovaPastaNome("");
      toast.success(`Pasta "${nome}" criada`);
    } catch (e) {
      toast.error("Erro ao criar pasta: " + String(e instanceof Error ? e.message : e));
    } finally {
      setCriandoPasta(false);
    }
  };

  const confirmarSalvar = async () => {
    const validos = resultados.filter((r) => r.isInWhatsapp);
    if (!validos.length) return;

    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    const pastaId = pastaSelecionada === "sem-pasta" ? null : pastaSelecionada;

    setSalvando(true);
    try {
      const rows = validos.map((r) => ({
        usuario_id: u.user!.id,
        pasta_id: pastaId,
        telefone: r.jid ? r.jid.split("@")[0] : r.query,
        nome: r.verifiedName ?? null,
        empresa: null,
      }));
      const { error } = await supabase.from("leads").upsert(rows, { onConflict: "usuario_id,telefone" });
      if (error) throw new Error(error.message ?? error.details ?? JSON.stringify(error));

      const nomePasta = pastas.find((p) => p.id === pastaId)?.nome ?? "sem pasta";
      toast.success(`${rows.length} lead(s) salvos${pastaId ? ` na pasta "${nomePasta}"` : ""}`);
      setModalAberto(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as {message?: string})?.message ?? JSON.stringify(e);
      toast.error("Erro ao salvar: " + msg);
    } finally {
      setSalvando(false);
    }
  };

  const exportarResultados = () => {
    if (!resultados.length) return;
    downloadCSV(
      "verificacao-whatsapp.csv",
      resultados.map((r) => ({
        numero: r.query,
        tem_whatsapp: r.isInWhatsapp ? "Sim" : "Não",
        nome_verificado: r.verifiedName ?? "",
        nome_grupo: r.groupName ?? "",
        jid: r.jid ?? "",
        erro: r.error ?? "",
      }))
    );
    toast.success("CSV exportado");
  };

  const comWpp = resultados.filter((r) => r.isInWhatsapp).length;
  const semWpp = resultados.filter((r) => !r.isInWhatsapp).length;
  const comErro = resultados.filter((r) => !!r.error).length;

  const filtrados = useMemo(() => {
    if (filtro === "com") return resultados.filter((r) => r.isInWhatsapp);
    if (filtro === "sem") return resultados.filter((r) => !r.isInWhatsapp);
    return resultados;
  }, [resultados, filtro]);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Verificador de WhatsApp</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Valide números de telefone para saber se possuem WhatsApp ativo.
        </p>
      </div>

      <FerramentasNav active="verificador" />

      <Card className="p-6 space-y-5">
        <div className="space-y-2 max-w-xs">
          <label className="text-sm font-medium">Instância WhatsApp</label>
          {instancias.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma instância conectada. Configure em <span className="text-primary">Conexões</span>.
            </p>
          ) : (
            <Select value={instanciaId} onValueChange={setInstanciaId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {instancias.map((i) => (
                  <SelectItem key={i.id} value={i.id}>{i.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-3">
          <label className="text-sm font-medium">Números a verificar</label>
          <Tabs value={origem} onValueChange={(v) => trocarOrigem(v as Origem)}>
            <TabsList>
              <TabsTrigger value="colar">Colar números</TabsTrigger>
              <TabsTrigger value="pasta">Selecionar por pasta</TabsTrigger>
            </TabsList>
          </Tabs>

          {origem === "colar" ? (
            <div className="space-y-2">
              <Textarea
                placeholder={"5511912345678\n5521987654321\n11998765432"}
                value={numeros}
                onChange={(e) => setNumeros(e.target.value)}
                rows={8}
                className="font-mono text-sm resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Um número por linha (ou separados por vírgula). Com ou sem o código do país — o sistema adiciona{" "}
                <code className="bg-muted px-1 rounded">55</code> automaticamente para números brasileiros de 10 ou 11 dígitos.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {pastas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma pasta criada ainda. Crie pastas em <span className="text-primary">Clientes/Leads</span>.</p>
              ) : (
                <div className="flex flex-wrap gap-4 p-3 bg-muted rounded max-h-40 overflow-y-auto">
                  {pastas.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 cursor-pointer text-sm">
                      <Checkbox
                        checked={pastasOrigemSel.includes(p.id)}
                        onCheckedChange={() => togglePastaOrigem(p.id)}
                      />
                      <Folder className="w-3.5 h-3.5 text-primary shrink-0" />
                      {p.nome}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {carregandoLeads
                  ? "Carregando leads das pastas selecionadas…"
                  : pastasOrigemSel.length === 0
                  ? "Selecione ao menos uma pasta."
                  : `${leadsDaPasta.length} lead(s) encontrado(s) na(s) pasta(s) selecionada(s).`}
              </p>
            </div>
          )}
        </div>

        <Button
          onClick={verificar}
          disabled={loading || !instanciaId || carregandoLeads || (origem === "colar" ? !numeros.trim() : leadsDaPasta.length === 0)}
        >
          {loading
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verificando…</>
            : <><PhoneCall className="w-4 h-4 mr-2" />Verificar números</>}
        </Button>
      </Card>

      {resultados.length > 0 && (
        <div className="space-y-4">
          {/* Resumo e ações */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4 text-sm flex-wrap">
              <span className="flex items-center gap-1.5 text-green-600 font-medium">
                <CheckCircle2 className="w-4 h-4" />{comWpp} com WhatsApp
              </span>
              <span className="flex items-center gap-1.5 text-destructive font-medium">
                <XCircle className="w-4 h-4" />{semWpp} sem WhatsApp
              </span>
              {comErro > 0 && (
                <span className="flex items-center gap-1.5 text-yellow-600 font-medium">
                  <AlertCircle className="w-4 h-4" />{comErro} com erro
                </span>
              )}
              <span className="text-muted-foreground">{resultados.length} verificados no total</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={abrirModalSalvar}
                disabled={comWpp === 0}
              >
                <BookmarkPlus className="w-4 h-4 mr-2" />
                Salvar válidos como leads
              </Button>
              <Button variant="outline" size="sm" onClick={exportarResultados}>
                <Download className="w-4 h-4 mr-2" />Exportar CSV
              </Button>
              {origem === "pasta" && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={excluirSemWhatsAppDaPasta}
                  disabled={selecionadosExcluir.size === 0 || excluindo}
                >
                  {excluindo
                    ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    : <Trash2 className="w-4 h-4 mr-2" />}
                  Excluir {selecionadosExcluir.size} sem WhatsApp da pasta
                </Button>
              )}
            </div>
          </div>

          {/* Filtros */}
          <div className="flex items-center gap-1 border rounded-lg p-1 w-fit bg-muted/30">
            {([
              { key: "todos", label: `Todos (${resultados.length})` },
              { key: "com",   label: `Com WhatsApp (${comWpp})` },
              { key: "sem",   label: `Sem WhatsApp (${semWpp})` },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFiltro(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  filtro === key
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tabela */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-muted-foreground bg-muted/30">
                  <tr>
                    {origem === "pasta" && <th className="px-4 py-3 font-medium w-10">Excluir?</th>}
                    <th className="px-4 py-3 font-medium">Número consultado</th>
                    <th className="font-medium">Status</th>
                    <th className="font-medium hidden sm:table-cell">Nome verificado</th>
                    <th className="font-medium hidden lg:table-cell">JID</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((r, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                      {origem === "pasta" && (
                        <td className="px-4 py-2.5">
                          {!r.isInWhatsapp && r.leadId && (
                            <Checkbox
                              checked={selecionadosExcluir.has(r.leadId)}
                              onCheckedChange={() =>
                                setSelecionadosExcluir((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(r.leadId!)) next.delete(r.leadId!);
                                  else next.add(r.leadId!);
                                  return next;
                                })
                              }
                            />
                          )}
                        </td>
                      )}
                      <td className="px-4 py-2.5 font-mono text-xs">{r.query}</td>
                      <td className="py-2.5">
                        {r.error ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full">
                            <AlertCircle className="w-3 h-3" /> {r.error}
                          </span>
                        ) : r.isInWhatsapp ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" /> Com WhatsApp
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                            <XCircle className="w-3 h-3" /> Sem WhatsApp
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 hidden sm:table-cell">
                        {r.groupName ? (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Users className="w-3 h-3 shrink-0" /> {r.groupName}
                          </span>
                        ) : r.verifiedName ? (
                          <span className="text-xs font-medium">{r.verifiedName}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2.5 font-mono text-xs text-muted-foreground hidden lg:table-cell">
                        {r.jid || "—"}
                      </td>
                    </tr>
                  ))}
                  {filtrados.length === 0 && (
                    <tr>
                      <td colSpan={origem === "pasta" ? 5 : 4} className="p-10 text-center text-muted-foreground text-sm">
                        Nenhum resultado para este filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Modal de seleção de pasta */}
      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Salvar {comWpp} lead(s) válidos</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Escolha uma pasta para organizar os leads ou salve sem pasta.
            </p>

            {/* Lista de pastas */}
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {/* Opção sem pasta */}
              <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                pastaSelecionada === "sem-pasta" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
              }`}>
                <input
                  type="radio"
                  name="pasta"
                  value="sem-pasta"
                  checked={pastaSelecionada === "sem-pasta"}
                  onChange={() => setPastaSelecionada("sem-pasta")}
                  className="accent-primary"
                />
                <span className="text-sm text-muted-foreground">Sem pasta (todos os leads)</span>
              </label>

              {pastas.map((p) => (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    pastaSelecionada === p.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="pasta"
                    value={p.id}
                    checked={pastaSelecionada === p.id}
                    onChange={() => setPastaSelecionada(p.id)}
                    className="accent-primary"
                  />
                  <Folder className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-sm font-medium">{p.nome}</span>
                </label>
              ))}
            </div>

            {/* Criar nova pasta */}
            <div className="border-t pt-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <FolderPlus className="w-3.5 h-3.5" /> Criar nova pasta
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="Nome da nova pasta…"
                  value={novaPastaNome}
                  onChange={(e) => setNovaPastaNome(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && criarPastaESelecionar()}
                  className="flex-1 text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={criarPastaESelecionar}
                  disabled={criandoPasta || !novaPastaNome.trim()}
                >
                  {criandoPasta ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar"}
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setModalAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmarSalvar} disabled={salvando}>
              {salvando
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando…</>
                : <><BookmarkPlus className="w-4 h-4 mr-2" />Salvar leads</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
