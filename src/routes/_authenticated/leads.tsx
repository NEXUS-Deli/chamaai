import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Folder, FolderInput, Plus, Trash2, Upload, Download, UserPlus, Search, X, CheckSquare, Tag, History, Loader2 } from "lucide-react";
import { isValidPhone, formatPhoneBR } from "@/lib/phone";
import { parseCSV, downloadCSV, templateLeadsCSV } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/leads")({
  component: LeadsPage,
});

interface Pasta { id: string; nome: string; codigo: string | null }
interface Lead {
  id: string;
  telefone: string;
  nome: string | null;
  empresa: string | null;
  pasta_id: string | null;
  importado_em: string;
  tags: string[];
}

interface Disparo {
  id: string;
  telefone: string;
  status: string;
  instancia_usada: string | null;
  mensagem_enviada: string | null;
  atualizado_em: string;
  campanhas: { id: string; nome: string } | null;
}

function LeadsPage() {
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pastaSel, setPastaSel] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [novaPasta, setNovaPasta] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [excluindoMassa, setExcluindoMassa] = useState(false);
  const [movendoMassa, setMovendoMassa] = useState(false);
  const [showMoverPasta, setShowMoverPasta] = useState(false);
  const [tagsLead, setTagsLead] = useState<Lead | null>(null);
  const [historicoLead, setHistoricoLead] = useState<Lead | null>(null);

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    const { data: ps } = await supabase
      .from("pastas")
      .select("id,nome,codigo")
      .eq("usuario_id", u.user.id)
      .order("nome");

    // Busca todos os leads em lotes de 1000 (limite padrão do PostgREST)
    const BATCH = 1000;
    let allLeads: Lead[] = [];
    let from = 0;
    while (true) {
      const { data: ls } = await (supabase as any)
        .from("leads")
        .select("id,telefone,nome,empresa,pasta_id,importado_em,tags")
        .eq("usuario_id", u.user.id)
        .order("importado_em", { ascending: false })
        .range(from, from + BATCH - 1);
      const batch = ((ls ?? []) as Lead[]).map((l: Lead) => ({ ...l, tags: l.tags ?? [] }));
      allLeads = allLeads.concat(batch);
      if (batch.length < BATCH) break;
      from += BATCH;
    }

    setPastas(ps ?? []);
    setLeads(allLeads);
    setSelecionados(new Set());
  };

  useEffect(() => { load(); }, []);

  // Limpa seleção ao trocar filtro
  useEffect(() => { setSelecionados(new Set()); }, [pastaSel, search]);

  const criarPasta = async () => {
    if (!novaPasta.trim()) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("pastas").insert({ usuario_id: u.user.id, nome: novaPasta.trim() });
    if (error) return toast.error(error.message);
    setNovaPasta("");
    toast.success("Pasta criada");
    load();
  };

  const excluirPasta = async (id: string) => {
    if (!confirm("Excluir a pasta? Os contatos ficarão sem pasta.")) return;
    const { error } = await supabase.from("pastas").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (pastaSel === id) setPastaSel(null);
    load();
  };

  const excluirLead = async (id: string) => {
    if (!confirm("Excluir contato?")) return;
    await supabase.from("leads").delete().eq("id", id);
    load();
  };

  const selecionarProximos = (n: number) => {
    const disponiveis = filtered.filter((l) => !selecionados.has(l.id));
    const proximos = disponiveis.slice(0, n);
    setSelecionados((prev) => {
      const next = new Set(prev);
      proximos.forEach((l) => next.add(l.id));
      return next;
    });
  };

  const moverParaPasta = async (pastaId: string | null) => {
    if (!selecionados.size) return;
    setMovendoMassa(true);
    try {
      const ids = [...selecionados];
      for (let i = 0; i < ids.length; i += 200) {
        const lote = ids.slice(i, i + 200);
        const { error } = await supabase.from("leads").update({ pasta_id: pastaId }).in("id", lote);
        if (error) throw error;
      }
      toast.success(`${ids.length} contato(s) movido(s)`);
      setShowMoverPasta(false);
      load();
    } catch (e) {
      toast.error("Erro ao mover: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setMovendoMassa(false);
    }
  };

  const excluirSelecionados = async () => {
    if (!selecionados.size) return;
    if (!confirm(`Excluir ${selecionados.size} contato(s) selecionado(s)? Esta ação não pode ser desfeita.`)) return;
    setExcluindoMassa(true);
    try {
      const ids = [...selecionados];
      // Supabase limita .in() — divide em lotes de 200
      for (let i = 0; i < ids.length; i += 200) {
        const lote = ids.slice(i, i + 200);
        const { error } = await supabase.from("leads").delete().in("id", lote);
        if (error) throw error;
      }
      toast.success(`${ids.length} contato(s) excluído(s)`);
      load();
    } catch (e) {
      toast.error("Erro ao excluir: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExcluindoMassa(false);
    }
  };

  const leadsCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    leads.forEach((l) => { if (l.pasta_id) counts[l.pasta_id] = (counts[l.pasta_id] || 0) + 1; });
    return counts;
  }, [leads]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return leads.filter((l) => {
      if (pastaSel !== null && l.pasta_id !== pastaSel) return false;
      if (!q) return true;
      return (
        (l.nome ?? "").toLowerCase().includes(q) ||
        l.telefone.toLowerCase().includes(q) ||
        (l.empresa ?? "").toLowerCase().includes(q)
      );
    });
  }, [leads, pastaSel, search]);

  const countPorPasta = (id: string | null) => id === null ? leads.length : (leadsCounts[id] || 0);

  const exportar = () =>
    downloadCSV("leads.csv", filtered.map((l) => ({ telefone: l.telefone, nome: l.nome ?? "", empresa: l.empresa ?? "" })));

  const todosSelecionados = filtered.length > 0 && filtered.every((l) => selecionados.has(l.id));
  const algunsSelecionados = filtered.some((l) => selecionados.has(l.id));

  const toggleTodos = () => {
    if (todosSelecionados) {
      setSelecionados((prev) => {
        const next = new Set(prev);
        filtered.forEach((l) => next.delete(l.id));
        return next;
      });
    } else {
      setSelecionados((prev) => {
        const next = new Set(prev);
        filtered.forEach((l) => next.add(l.id));
        return next;
      });
    }
  };

  const toggleLead = (id: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── SIDEBAR PASTAS (desktop only) ── */}
      <aside className="hidden md:flex w-60 border-r bg-card flex-col shrink-0">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-sm">Pastas</h2>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1">
          <button
            onClick={() => setPastaSel(null)}
            className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-md text-sm ${
              pastaSel === null ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
            }`}
          >
            <span className="flex items-center gap-2"><Folder className="w-4 h-4" /> Todos os leads</span>
            <span className="text-xs text-muted-foreground">{countPorPasta(null)}</span>
          </button>
          {pastas.map((p) => (
            <div key={p.id} className="group">
              <button
                onClick={() => setPastaSel(p.id)}
                className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-md text-sm ${
                  pastaSel === p.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
                }`}
              >
                <span className="flex items-center gap-2 truncate min-w-0">
                  <Folder className="w-4 h-4 shrink-0" />
                  <span className="truncate">{p.nome}</span>
                  {p.codigo && (
                    <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">
                      {p.codigo}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1 shrink-0 ml-1">
                  <span className="text-xs text-muted-foreground">{countPorPasta(p.id)}</span>
                  <Trash2
                    className="w-3 h-3 opacity-0 group-hover:opacity-100 text-destructive cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); excluirPasta(p.id); }}
                  />
                </span>
              </button>
            </div>
          ))}
        </div>
        <div className="p-3 border-t flex gap-2">
          <Input
            placeholder="Nova pasta"
            value={novaPasta}
            onChange={(e) => setNovaPasta(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && criarPasta()}
            className="h-9 text-sm"
          />
          <Button size="sm" onClick={criarPasta}><Plus className="w-4 h-4" /></Button>
        </div>
      </aside>

      {/* ── CONTEÚDO PRINCIPAL ── */}
      <section className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Chips de pasta (mobile only) */}
        <div className="md:hidden border-b bg-card">
          <div className="overflow-x-auto px-3 py-2">
            <div className="flex gap-1.5 w-max">
              <button
                onClick={() => setPastaSel(null)}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  pastaSel === null ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                Todos ({leads.length})
              </button>
              {pastas.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPastaSel(p.id)}
                  className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    pastaSel === p.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {p.nome} ({countPorPasta(p.id)})
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Header: busca + ações */}
        <div className="px-3 sm:px-4 py-3 border-b bg-background flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, telefone, empresa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline ml-1.5">Importar</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
              <UserPlus className="w-4 h-4" />
              <span className="hidden sm:inline ml-1.5">Adicionar</span>
            </Button>
            <Button variant="outline" size="sm" onClick={exportar}>
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline ml-1.5">Exportar</span>
            </Button>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{filtered.length} contatos</span>
          </div>
        </div>

        {/* Barra de seleção rápida — sempre visível */}
        <div className="px-3 sm:px-4 py-2 border-b bg-muted/30 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Próximos:</span>
          {[10, 20, 50, 100, 500].map((n) => {
            const disponiveis = filtered.filter((l) => !selecionados.has(l.id)).length;
            if (disponiveis === 0) return null;
            return (
              <Button key={n} variant="outline" size="sm" className="h-6 px-2.5 text-xs font-medium" onClick={() => selecionarProximos(n)}>
                +{Math.min(n, disponiveis)}
              </Button>
            );
          })}
          <span className="text-xs text-muted-foreground ml-auto">
            {filtered.filter((l) => !selecionados.has(l.id)).length} disponíveis
          </span>
        </div>

        {/* Barra de ações em massa */}
        {selecionados.size > 0 && (
          <div className="px-3 sm:px-4 py-2.5 bg-primary/5 border-b border-primary/20 flex items-center gap-2 sm:gap-3">
            <CheckSquare className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-medium text-primary flex-1">
              {selecionados.size} contato{selecionados.size !== 1 ? "s" : ""} selecionado{selecionados.size !== 1 ? "s" : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowMoverPasta(true)}
              disabled={movendoMassa}
              className="gap-1.5"
            >
              <FolderInput className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Mover para pasta</span>
              <span className="sm:hidden">Mover</span>
            </Button>
            <Button size="sm" variant="destructive" onClick={excluirSelecionados} disabled={excluindoMassa} className="gap-1.5">
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{excluindoMassa ? "Excluindo…" : `Excluir ${selecionados.size}`}</span>
              <span className="sm:hidden">{excluindoMassa ? "…" : selecionados.size}</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelecionados(new Set())} className="gap-1 text-muted-foreground px-2">
              <X className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Cancelar</span>
            </Button>
          </div>
        )}

        {/* Tabela */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b sticky top-0 bg-background z-10">
              <tr>
                <th className="px-3 sm:px-4 py-3 w-8 sm:w-10">
                  <input
                    type="checkbox"
                    checked={todosSelecionados}
                    ref={(el) => { if (el) el.indeterminate = algunsSelecionados && !todosSelecionados; }}
                    onChange={toggleTodos}
                    className="accent-primary cursor-pointer"
                    title={todosSelecionados ? "Desmarcar todos" : "Selecionar todos"}
                  />
                </th>
                <th className="py-3 pr-2">Nome</th>
                <th className="py-3 pr-2 hidden sm:table-cell">Telefone</th>
                <th className="py-3 hidden md:table-cell">Empresa</th>
                <th className="py-3 hidden lg:table-cell">Tags</th>
                <th className="py-3 hidden md:table-cell">Importado</th>
                <th className="py-3 w-16 sm:w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const valido = isValidPhone(l.telefone);
                const sel = selecionados.has(l.id);
                return (
                  <tr
                    key={l.id}
                    onClick={() => toggleLead(l.id)}
                    className={`border-b last:border-0 cursor-pointer transition-colors ${
                      sel ? "bg-primary/5 hover:bg-primary/8" : "hover:bg-muted/30"
                    }`}
                  >
                    <td className="px-3 sm:px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={sel}
                        onChange={() => toggleLead(l.id)}
                        className="accent-primary cursor-pointer"
                      />
                    </td>

                    {/* Nome — no mobile exibe telefone como sublinha */}
                    <td className="py-3 pr-2 max-w-[120px] sm:max-w-none">
                      <div className="font-medium truncate">{l.nome || "—"}</div>
                      <div className="sm:hidden text-xs text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
                        {formatPhoneBR(l.telefone)}
                        {!valido && (
                          <span className="px-1 py-0.5 rounded bg-destructive/10 text-destructive text-[10px]">inválido</span>
                        )}
                      </div>
                    </td>

                    {/* Telefone (desktop) */}
                    <td className="py-3 pr-2 hidden sm:table-cell whitespace-nowrap">
                      {formatPhoneBR(l.telefone)}
                      {!valido && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-destructive/10 text-destructive text-xs">inválido</span>
                      )}
                    </td>

                    <td className="py-3 text-muted-foreground hidden md:table-cell">{l.empresa || "—"}</td>

                    <td className="py-3 hidden lg:table-cell" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap gap-1">
                        {(l.tags ?? []).slice(0, 3).map((tag) => (
                          <span key={tag} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium">
                            {tag}
                          </span>
                        ))}
                        {(l.tags ?? []).length > 3 && (
                          <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px]">
                            +{l.tags.length - 3}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 text-muted-foreground hidden md:table-cell whitespace-nowrap">
                      {new Date(l.importado_em).toLocaleDateString("pt-BR")}
                    </td>

                    <td className="py-2 pr-1 sm:pr-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setTagsLead(l)} title="Gerenciar tags">
                          <Tag className="w-3.5 h-3.5 text-muted-foreground hover:text-primary" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 hidden sm:inline-flex" onClick={() => setHistoricoLead(l)} title="Histórico de disparos">
                          <History className="w-3.5 h-3.5 text-muted-foreground hover:text-blue-600" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => excluirLead(l.id)} title="Excluir contato">
                          <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-muted-foreground">Nenhum contato</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ImportModal open={showImport} onClose={() => setShowImport(false)} pastas={pastas} onDone={load} />
      <AddModal open={showAdd} onClose={() => setShowAdd(false)} pastas={pastas} onDone={load} pastaAtual={pastaSel} />
      <MoverPastaModal
        open={showMoverPasta}
        onClose={() => setShowMoverPasta(false)}
        pastas={pastas}
        quantidade={selecionados.size}
        loading={movendoMassa}
        onMover={moverParaPasta}
      />
      {tagsLead && (
        <TagsModal
          lead={tagsLead}
          onClose={() => setTagsLead(null)}
          onSalvo={(novasTags: string[]) => {
            setLeads((prev) => prev.map((l) => l.id === tagsLead.id ? { ...l, tags: novasTags } : l));
            setTagsLead(null);
          }}
        />
      )}
      {historicoLead && (
        <HistoricoModal lead={historicoLead} onClose={() => setHistoricoLead(null)} />
      )}
    </div>
  );
}

function MoverPastaModal({
  open, onClose, pastas, quantidade, loading, onMover,
}: {
  open: boolean;
  onClose: () => void;
  pastas: Pasta[];
  quantidade: number;
  loading: boolean;
  onMover: (pastaId: string | null) => void;
}) {
  const [destino, setDestino] = useState<string>("__sem_pasta__");

  useEffect(() => { if (open) setDestino("__sem_pasta__"); }, [open]);

  const confirmar = () => onMover(destino === "__sem_pasta__" ? null : destino);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="w-4 h-4 text-primary" /> Mover {quantidade} contato{quantidade !== 1 ? "s" : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">Selecione a pasta de destino:</p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${destino === "__sem_pasta__" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
              <input type="radio" name="pasta-destino" value="__sem_pasta__" checked={destino === "__sem_pasta__"} onChange={() => setDestino("__sem_pasta__")} className="accent-primary" />
              <span className="flex items-center gap-2 text-sm font-medium">
                <Folder className="w-4 h-4 text-muted-foreground" /> Sem pasta
              </span>
            </label>
            {pastas.map((p) => (
              <label key={p.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${destino === p.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                <input type="radio" name="pasta-destino" value={p.id} checked={destino === p.id} onChange={() => setDestino(p.id)} className="accent-primary" />
                <span className="flex items-center gap-2 text-sm font-medium flex-1 min-w-0">
                  <Folder className="w-4 h-4 text-primary shrink-0" />
                  <span className="truncate">{p.nome}</span>
                  {p.codigo && <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">{p.codigo}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={confirmar} disabled={loading} className="gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? "Movendo…" : `Mover ${quantidade} contato${quantidade !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportModal({ open, onClose, pastas, onDone }: { open: boolean; onClose: () => void; pastas: Pasta[]; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [pastaId, setPastaId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const baixarTemplate = () => {
    const blob = new Blob([templateLeadsCSV()], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "modelo-leads.csv";
    a.click();
  };

  const importar = async () => {
    if (!file) return toast.error("Selecione um arquivo");
    setLoading(true);
    try {
      const parsed = await parseCSV(file);
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const rows = parsed.rows
        .filter((r) => r.telefone)
        .map((r) => ({
          usuario_id: u.user!.id,
          pasta_id: pastaId || null,
          telefone: String(r.telefone).trim(),
          nome: r.nome ?? null,
          empresa: r.empresa ?? null,
        }));
      if (!rows.length) { toast.error("Nenhum telefone válido"); setLoading(false); return; }
      const { error } = await supabase.from("leads").insert(rows);
      if (error) throw error;
      toast.success(`${rows.length} contatos importados`);
      onDone(); onClose(); setFile(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao importar");
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Importar contatos via CSV</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <Button variant="outline" size="sm" onClick={baixarTemplate}>Baixar modelo CSV</Button>
          <Input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <div className="space-y-2">
            <Label>Importar para a pasta</Label>
            <Select value={pastaId} onValueChange={setPastaId}>
              <SelectTrigger><SelectValue placeholder="Sem pasta" /></SelectTrigger>
              <SelectContent>
                {pastas.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={importar} disabled={loading}>Importar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddModal({ open, onClose, pastas, onDone, pastaAtual }: { open: boolean; onClose: () => void; pastas: Pasta[]; onDone: () => void; pastaAtual: string | null }) {
  const [form, setForm] = useState({ telefone: "", nome: "", empresa: "", notas: "", pasta_id: "" });

  useEffect(() => { if (open) setForm({ telefone: "", nome: "", empresa: "", notas: "", pasta_id: pastaAtual ?? "" }); }, [open, pastaAtual]);

  const salvar = async () => {
    if (!isValidPhone(form.telefone)) return toast.error("Telefone inválido");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("leads").insert({
      usuario_id: u.user.id,
      pasta_id: form.pasta_id || null,
      telefone: form.telefone,
      nome: form.nome || null,
      empresa: form.empresa || null,
      notas: form.notas || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Contato adicionado");
    onDone(); onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Adicionar contato</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Telefone *</Label>
            <Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="+5511912345678" />
          </div>
          <div className="space-y-2"><Label>Nome</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
          <div className="space-y-2"><Label>Empresa</Label><Input value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} /></div>
          <div className="space-y-2">
            <Label>Pasta</Label>
            <Select value={form.pasta_id} onValueChange={(v) => setForm({ ...form, pasta_id: v })}>
              <SelectTrigger><SelectValue placeholder="Sem pasta" /></SelectTrigger>
              <SelectContent>
                {pastas.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TagsModal({ lead, onClose, onSalvo }: { lead: Lead; onClose: () => void; onSalvo: (tags: string[]) => void }) {
  const [tags, setTags] = useState<string[]>(lead.tags ?? []);
  const [input, setInput] = useState("");
  const [salvando, setSalvando] = useState(false);

  const addTag = () => {
    const t = input.trim().toLowerCase();
    if (!t || tags.includes(t)) { setInput(""); return; }
    setTags((prev) => [...prev, t]);
    setInput("");
  };

  const removeTag = (t: string) => setTags((prev) => prev.filter((x) => x !== t));

  const salvar = async () => {
    setSalvando(true);
    const { error } = await (supabase as any).from("leads").update({ tags }).eq("id", lead.id);
    setSalvando(false);
    if (error) return toast.error(error.message);
    toast.success("Tags salvas");
    onSalvo(tags);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="w-4 h-4" /> Tags — {lead.nome || lead.telefone}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex gap-2">
            <Input
              placeholder="Nova tag..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTag()}
              className="flex-1"
            />
            <Button variant="outline" onClick={addTag}>Adicionar</Button>
          </div>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <span key={t} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  {t}
                  <button onClick={() => removeTag(t)} className="hover:text-destructive transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma tag. Digite acima e pressione Enter.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando} className="gap-2">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Salvar tags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const DISPARO_STATUS_COLOR: Record<string, string> = {
  pendente: "bg-yellow-100 text-yellow-800",
  enviado: "bg-blue-100 text-blue-800",
  entregue: "bg-green-100 text-green-800",
  lido: "bg-purple-100 text-purple-800",
  invalido: "bg-red-100 text-red-800",
  erro: "bg-red-100 text-red-800",
  cancelado: "bg-muted text-muted-foreground",
};

const DISPARO_STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente", enviado: "Enviado", entregue: "Entregue",
  lido: "Lido", invalido: "Inválido", erro: "Erro", cancelado: "Cancelado",
};

function HistoricoModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [disparos, setDisparos] = useState<Disparo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("contatos_campanha")
        .select("id,telefone,status,instancia_usada,mensagem_enviada,atualizado_em,campanhas(id,nome)")
        .eq("telefone", lead.telefone)
        .order("atualizado_em", { ascending: false })
        .limit(50);
      setDisparos((data ?? []) as unknown as Disparo[]);
      setLoading(false);
    })();
  }, [lead.telefone]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4" /> Histórico — {lead.nome || formatPhoneBR(lead.telefone)}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : disparos.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">
              Nenhum disparo encontrado para este contato.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b sticky top-0 bg-background">
                <tr>
                  <th className="py-2 pr-4">Campanha</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4 hidden sm:table-cell">Instância</th>
                  <th className="py-2 hidden md:table-cell">Mensagem</th>
                  <th className="py-2">Data</th>
                </tr>
              </thead>
              <tbody>
                {disparos.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{d.campanhas?.nome ?? "—"}</td>
                    <td className="py-2 pr-4">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${DISPARO_STATUS_COLOR[d.status] ?? "bg-muted"}`}>
                        {DISPARO_STATUS_LABEL[d.status] ?? d.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground text-xs hidden sm:table-cell">{d.instancia_usada ?? "—"}</td>
                    <td className="py-2 text-muted-foreground text-xs max-w-[200px] truncate hidden md:table-cell" title={d.mensagem_enviada ?? ""}>
                      {d.mensagem_enviada ?? "—"}
                    </td>
                    <td className="py-2 text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(d.atualizado_em).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
