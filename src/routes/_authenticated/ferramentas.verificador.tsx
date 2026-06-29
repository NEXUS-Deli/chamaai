import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { CheckCircle2, XCircle, Loader2, PhoneCall, Download, BookmarkPlus, AlertCircle, Users, FolderPlus, Folder } from "lucide-react";
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
}

type Filtro = "todos" | "com" | "sem";

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

  const verificar = async () => {
    const inst = instancias.find((i) => i.id === instanciaId);
    if (!inst) return toast.error("Selecione uma instância conectada");

    const linhas = numeros
      .split(/[\n,;]+/)
      .map(normalizarNumero)
      .filter(Boolean);

    if (!linhas.length) return toast.error("Digite ao menos um número válido (mínimo 8 dígitos)");

    setLoading(true);
    setResultados([]);
    setFiltro("todos");
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-proxy", {
        body: { action: "check_numbers", payload: { token: inst.token, numbers: linhas } },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const arr: CheckResult[] = Array.isArray(data) ? data : data ? [data] : [];
      if (!arr.length) throw new Error("A API retornou uma resposta vazia");
      setResultados(arr);
      const validos = arr.filter((r) => r.isInWhatsapp).length;
      toast.success(`${arr.length} verificado(s) — ${validos} com WhatsApp`);
    } catch (e) {
      toast.error("Erro: " + String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
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

        <div className="space-y-2">
          <label className="text-sm font-medium">Números de telefone</label>
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

        <Button onClick={verificar} disabled={loading || !instanciaId || !numeros.trim()}>
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
                    <th className="px-4 py-3 font-medium">Número consultado</th>
                    <th className="font-medium">Status</th>
                    <th className="font-medium hidden sm:table-cell">Nome verificado</th>
                    <th className="font-medium hidden lg:table-cell">JID</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((r, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
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
                      <td colSpan={4} className="p-10 text-center text-muted-foreground text-sm">
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
