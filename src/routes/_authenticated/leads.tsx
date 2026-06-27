import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Folder, Plus, Trash2, Upload, Download, UserPlus, Search } from "lucide-react";
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
}

function LeadsPage() {
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pastaSel, setPastaSel] = useState<string | null>(null); // null = todos
  const [search, setSearch] = useState("");
  const [novaPasta, setNovaPasta] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const [{ data: ps }, { data: ls }] = await Promise.all([
      supabase.from("pastas").select("id,nome,codigo").eq("usuario_id", u.user.id).order("nome"),
      supabase
        .from("leads")
        .select("id,telefone,nome,empresa,pasta_id,importado_em")
        .eq("usuario_id", u.user.id)
        .order("importado_em", { ascending: false }),
    ]);
    setPastas(ps ?? []);
    setLeads(ls ?? []);
  };

  useEffect(() => { load(); }, []);

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

  const leadsCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    leads.forEach((l) => {
      if (l.pasta_id) {
        counts[l.pasta_id] = (counts[l.pasta_id] || 0) + 1;
      }
    });
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

  const countPorPasta = (id: string | null) => {
    if (id === null) return leads.length;
    return leadsCounts[id] || 0;
  };

  const exportar = () =>
    downloadCSV("leads.csv", filtered.map((l) => ({
      telefone: l.telefone, nome: l.nome ?? "", empresa: l.empresa ?? "",
    })));

  return (
    <div className="flex h-screen">
      {/* Painel pastas */}
      <aside className="w-60 border-r bg-card flex flex-col">
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
                title={`ID: ${p.id}`}
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

      {/* Tabela */}
      <section className="flex-1 flex flex-col overflow-hidden">
        <div className="p-6 border-b bg-background flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
            <Input placeholder="Buscar por nome, telefone, empresa..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Button variant="outline" onClick={() => setShowImport(true)}><Upload className="w-4 h-4 mr-2" />Importar CSV</Button>
          <Button variant="outline" onClick={() => setShowAdd(true)}><UserPlus className="w-4 h-4 mr-2" />Adicionar</Button>
          <Button variant="outline" onClick={exportar}><Download className="w-4 h-4 mr-2" />Exportar</Button>
          <span className="text-sm text-muted-foreground">{filtered.length} contatos</span>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b sticky top-0 bg-background">
              <tr>
                <th className="px-6 py-3">Nome</th><th>Telefone</th><th>Empresa</th><th>Importado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const valido = isValidPhone(l.telefone);
                return (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-6 py-3 font-medium">{l.nome || "—"}</td>
                    <td>
                      {formatPhoneBR(l.telefone)}
                      {!valido && <span className="ml-2 px-1.5 py-0.5 rounded bg-destructive/10 text-destructive text-xs">inválido</span>}
                    </td>
                    <td className="text-muted-foreground">{l.empresa || "—"}</td>
                    <td className="text-muted-foreground">{new Date(l.importado_em).toLocaleDateString("pt-BR")}</td>
                    <td>
                      <Button variant="ghost" size="sm" onClick={() => excluirLead(l.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr><td colSpan={5} className="p-12 text-center text-muted-foreground">Nenhum contato</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ImportModal open={showImport} onClose={() => setShowImport(false)} pastas={pastas} onDone={load} />
      <AddModal open={showAdd} onClose={() => setShowAdd(false)} pastas={pastas} onDone={load} pastaAtual={pastaSel} />
    </div>
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