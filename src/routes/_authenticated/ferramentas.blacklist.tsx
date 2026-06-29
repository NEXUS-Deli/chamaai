import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Ban, Plus, Trash2, Search, Upload, Download, Loader2, X, CheckSquare } from "lucide-react";
import { formatPhoneBR } from "@/lib/phone";

export const Route = createFileRoute("/_authenticated/ferramentas/blacklist")({
  component: BlacklistPage,
});

interface BloqueadoItem {
  id: string;
  telefone: string;
  motivo: string | null;
  criado_em: string;
}

function BlacklistPage() {
  const [lista, setLista] = useState<BloqueadoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [excluindo, setExcluindo] = useState(false);

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data } = await (supabase as any)
      .from("blacklist")
      .select("id,telefone,motivo,criado_em")
      .eq("usuario_id", u.user.id)
      .order("criado_em", { ascending: false });
    setLista((data ?? []) as BloqueadoItem[]);
    setLoading(false);
    setSelecionados(new Set());
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return lista;
    return lista.filter((b) =>
      b.telefone.includes(q) || (b.motivo ?? "").toLowerCase().includes(q)
    );
  }, [lista, search]);

  const excluir = async (id: string) => {
    if (!confirm("Remover da blacklist?")) return;
    await (supabase as any).from("blacklist").delete().eq("id", id);
    toast.success("Removido da blacklist");
    load();
  };

  const excluirSelecionados = async () => {
    if (!selecionados.size) return;
    if (!confirm(`Remover ${selecionados.size} número(s) da blacklist?`)) return;
    setExcluindo(true);
    const ids = [...selecionados];
    for (let i = 0; i < ids.length; i += 200) {
      await (supabase as any).from("blacklist").delete().in("id", ids.slice(i, i + 200));
    }
    toast.success(`${ids.length} número(s) removido(s)`);
    setExcluindo(false);
    load();
  };

  const exportar = () => {
    const csv = "telefone,motivo\n" + lista.map((b) => `${b.telefone},${b.motivo ?? ""}`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "blacklist.csv";
    a.click();
  };

  const importarCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const rows = lines
      .filter((l) => !l.toLowerCase().startsWith("telefone"))
      .map((l) => {
        const [telefone, ...motParts] = l.split(",");
        return { usuario_id: u.user!.id, telefone: telefone.trim(), motivo: motParts.join(",").trim() || null };
      })
      .filter((r) => r.telefone);
    if (!rows.length) return toast.error("Nenhum número encontrado no CSV");
    const { error } = await (supabase as any).from("blacklist").upsert(rows, { onConflict: "usuario_id,telefone" });
    if (error) return toast.error(error.message);
    toast.success(`${rows.length} número(s) adicionados à blacklist`);
    load();
    e.target.value = "";
  };

  const todosSelecionados = filtered.length > 0 && filtered.every((b) => selecionados.has(b.id));
  const toggleTodos = () => {
    if (todosSelecionados) setSelecionados(new Set());
    else setSelecionados(new Set(filtered.map((b) => b.id)));
  };
  const toggleItem = (id: string) => setSelecionados((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Ban className="w-6 h-6 text-destructive" /> Lista de Bloqueio
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Números bloqueados nunca receberão mensagens das suas campanhas.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="cursor-pointer">
            <Button variant="outline" size="sm" className="gap-2" asChild>
              <span><Upload className="w-4 h-4" /> Importar CSV</span>
            </Button>
            <input type="file" accept=".csv" className="hidden" onChange={importarCSV} />
          </label>
          <Button variant="outline" size="sm" onClick={exportar} className="gap-2">
            <Download className="w-4 h-4" /> Exportar
          </Button>
          <Button size="sm" onClick={() => setModal(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Adicionar número
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground text-base">{lista.length}</span> número(s) bloqueado(s)
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
        <Input
          placeholder="Buscar número ou motivo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Barra de seleção em massa */}
      {selecionados.size > 0 && (
        <div className="px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-lg flex items-center gap-3">
          <CheckSquare className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-medium text-primary flex-1">
            {selecionados.size} selecionado(s)
          </span>
          <Button size="sm" variant="destructive" onClick={excluirSelecionados} disabled={excluindo} className="gap-1.5">
            <Trash2 className="w-3.5 h-3.5" />
            {excluindo ? "Removendo…" : `Remover ${selecionados.size}`}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelecionados(new Set())}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Tabela */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground bg-muted/30 border-b">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={todosSelecionados}
                    onChange={toggleTodos}
                    className="accent-primary cursor-pointer"
                  />
                </th>
                <th className="py-3">Telefone</th>
                <th className="py-3">Motivo</th>
                <th className="py-3 hidden sm:table-cell">Bloqueado em</th>
                <th className="py-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selecionados.has(b.id)} onChange={() => toggleItem(b.id)} className="accent-primary cursor-pointer" />
                  </td>
                  <td className="py-3 font-mono text-xs">{formatPhoneBR(b.telefone)}</td>
                  <td className="py-3 text-muted-foreground">{b.motivo || "—"}</td>
                  <td className="py-3 text-muted-foreground hidden sm:table-cell text-xs">
                    {new Date(b.criado_em).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="py-3">
                    <Button variant="ghost" size="sm" onClick={() => excluir(b.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-muted-foreground">
                    {lista.length === 0 ? "Nenhum número bloqueado ainda." : "Nenhum resultado encontrado."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <AddBlacklistModal open={modal} onClose={() => setModal(false)} onSalvo={() => { setModal(false); load(); }} />
    </div>
  );
}

function AddBlacklistModal({ open, onClose, onSalvo }: { open: boolean; onClose: () => void; onSalvo: () => void }) {
  const [telefone, setTelefone] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { if (open) { setTelefone(""); setMotivo(""); } }, [open]);

  const salvar = async () => {
    const tel = telefone.replace(/\D/g, "");
    if (tel.length < 10) return toast.error("Número inválido");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setSalvando(true);
    const { error } = await (supabase as any).from("blacklist").upsert(
      { usuario_id: u.user.id, telefone: tel, motivo: motivo.trim() || null },
      { onConflict: "usuario_id,telefone" }
    );
    setSalvando(false);
    if (error) return toast.error(error.message);
    toast.success("Número adicionado à blacklist");
    onSalvo();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Adicionar à blacklist</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Telefone</label>
            <Input placeholder="5511912345678" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Motivo (opcional)</label>
            <Input placeholder="Ex: Solicitou remoção, descadastro..." value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando} className="gap-2">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
