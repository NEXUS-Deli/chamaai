import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Loader2, ChevronRight, ArrowDownToLine, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { FerramentasNav } from "@/components/ferramentas-nav";

export const Route = createFileRoute("/_authenticated/ferramentas/extrator")({
  component: Extrator,
});

interface Instancia { id: string; nome: string; token: string }
interface Pasta { id: string; nome: string }
interface Grupo { id: string; subject: string; size: number | null }
interface Membro { id: string; number: string; name: string | null; admin: boolean }

function Extrator() {
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [instanciaId, setInstanciaId] = useState("");
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [pastaId, setPastaId] = useState("none");
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [grupoSel, setGrupoSel] = useState<Grupo | null>(null);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [loadingGrupos, setLoadingGrupos] = useState(false);
  const [loadingMembros, setLoadingMembros] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvados, setSalvados] = useState(0);

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

  const buscarGrupos = async () => {
    const inst = instancias.find((i) => i.id === instanciaId);
    if (!inst) return toast.error("Selecione uma instância");
    setLoadingGrupos(true);
    setGrupos([]);
    setGrupoSel(null);
    setMembros([]);
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-proxy", {
        body: { action: "get_groups", payload: { token: inst.token } },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const lista: Grupo[] = Array.isArray(data) ? data : [];
      if (!lista.length) {
        toast.info("Nenhum grupo encontrado nesta instância.");
      } else {
        setGrupos(lista);
        toast.success(`${lista.length} grupos encontrados`);
      }
    } catch (e) {
      toast.error("Erro ao buscar grupos: " + String(e instanceof Error ? e.message : e));
    } finally {
      setLoadingGrupos(false);
    }
  };

  const buscarMembros = async (grupo: Grupo) => {
    const inst = instancias.find((i) => i.id === instanciaId);
    if (!inst) return;
    setGrupoSel(grupo);
    setLoadingMembros(true);
    setMembros([]);
    setSelecionados(new Set());
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-proxy", {
        body: { action: "get_group_members", payload: { token: inst.token, groupId: grupo.id } },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const lista: Membro[] = Array.isArray(data) ? data : [];
      setMembros(lista);
      setSelecionados(new Set(lista.map((m) => m.id)));
      if (!lista.length) {
        toast.info("Nenhum membro encontrado neste grupo.");
      } else {
        toast.success(`${lista.length} membros carregados`);
      }
    } catch (e) {
      toast.error("Erro ao buscar membros: " + String(e instanceof Error ? e.message : e));
    } finally {
      setLoadingMembros(false);
    }
  };

  const toggleMembro = (id: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleTodos = () => {
    if (selecionados.size === membros.length) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(membros.map((m) => m.id)));
    }
  };

  const salvarLeads = async () => {
    if (!selecionados.size) return toast.error("Selecione ao menos um membro");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setSalvando(true);
    try {
      const rows = membros
        .filter((m) => selecionados.has(m.id))
        .map((m) => {
          // Remove DDI 55 se número tiver 13 dígitos (55 + DDD + 9 + número)
          let tel = m.number.replace(/\D/g, "");
          if (tel.startsWith("55") && (tel.length === 12 || tel.length === 13)) {
            tel = tel.substring(2);
          }
          return {
            usuario_id: u.user!.id,
            pasta_id: pastaId === "none" ? null : pastaId || null,
            telefone: tel,
            nome: m.name || null,
            empresa: null,
          };
        })
        .filter((r) => r.telefone.length >= 8);

      if (!rows.length) { toast.error("Nenhum número válido extraído"); setSalvando(false); return; }

      const { error } = await supabase.from("leads").upsert(rows, { onConflict: "usuario_id,telefone" });
      if (error) throw new Error(error.message ?? JSON.stringify(error));

      setSalvados(rows.length);
      toast.success(`${rows.length} membros salvos como leads!`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as {message?: string})?.message ?? JSON.stringify(e);
      toast.error("Erro ao salvar: " + msg);
    } finally {
      setSalvando(false);
    }
  };

  const adminCount = membros.filter((m) => m.admin).length;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Extrator de Grupos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Faça a extração de leads dos grupos do WhatsApp com a Chama AI.
        </p>
      </div>

      <FerramentasNav active="extrator" />

      <Card className="p-6 space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Instância WhatsApp</label>
            {instancias.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma instância. Configure em <span className="text-primary">Conexões</span>.</p>
            ) : (
              <Select value={instanciaId} onValueChange={setInstanciaId}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {instancias.map((i) => <SelectItem key={i.id} value={i.id}>{i.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Salvar na pasta</label>
            <Select value={pastaId} onValueChange={setPastaId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem pasta</SelectItem>
                {pastas.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button onClick={buscarGrupos} disabled={loadingGrupos || !instanciaId} variant="outline">
          {loadingGrupos
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Buscando grupos…</>
            : <><RefreshCw className="w-4 h-4 mr-2" />Buscar grupos</>}
        </Button>
      </Card>

      {grupos.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Lista de grupos */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {grupos.length} grupos encontrados
            </h3>
            <Card className="overflow-hidden divide-y max-h-[480px] overflow-y-auto">
              {grupos.map((g) => (
                <button
                  key={g.id}
                  onClick={() => buscarMembros(g)}
                  className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors ${
                    grupoSel?.id === g.id ? "bg-primary/5 border-l-2 border-primary" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{g.subject}</p>
                    <p className="text-xs text-muted-foreground font-mono">{g.size != null ? `${g.size} membros` : "—"}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              ))}
            </Card>
          </div>

          {/* Membros do grupo selecionado */}
          <div className="space-y-2">
            {grupoSel ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate">
                      {grupoSel.subject}
                    </h3>
                    {membros.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {membros.length} membros · {adminCount} admin{adminCount !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                  {membros.length > 0 && (
                    <Button size="sm" onClick={salvarLeads} disabled={salvando || !selecionados.size}>
                      {salvando
                        ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        : <ArrowDownToLine className="w-3 h-3 mr-1" />}
                      Salvar {selecionados.size}
                    </Button>
                  )}
                </div>

                {loadingMembros ? (
                  <div className="flex items-center justify-center py-16 text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando membros…
                  </div>
                ) : membros.length > 0 ? (
                  <>
                    {/* Selecionar todos */}
                    <div className="flex items-center gap-3 py-1">
                      <button onClick={toggleTodos} className="text-xs text-primary underline">
                        {selecionados.size === membros.length ? "Desmarcar todos" : "Selecionar todos"}
                      </button>
                      <span className="text-xs text-muted-foreground">{selecionados.size} de {membros.length}</span>
                    </div>

                    <Card className="overflow-hidden divide-y max-h-[400px] overflow-y-auto">
                      {membros.map((m) => {
                        const tel = m.number.replace(/\D/g, "");
                        const telExibido = tel.startsWith("55") && (tel.length === 12 || tel.length === 13)
                          ? tel.substring(2)
                          : tel;
                        return (
                          <label
                            key={m.id}
                            className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selecionados.has(m.id)}
                              onChange={() => toggleMembro(m.id)}
                              className="accent-primary shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              {m.name ? (
                                <p className="text-sm font-medium truncate">{m.name}</p>
                              ) : (
                                <p className="text-sm text-muted-foreground italic">Sem nome</p>
                              )}
                              <p className="text-xs font-mono text-muted-foreground">{telExibido || m.id.split("@")[0]}</p>
                            </div>
                            {m.admin && (
                              <span title="Admin">
                                <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </Card>
                  </>
                ) : (
                  <Card className="p-8 text-center text-sm text-muted-foreground">
                    Nenhum membro encontrado
                  </Card>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center h-full min-h-[200px]">
                <div className="text-center text-sm text-muted-foreground space-y-2">
                  <Users className="w-8 h-8 mx-auto opacity-30" />
                  <p>Selecione um grupo para ver os membros</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {salvados > 0 && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {salvados} membros salvos como leads na Chama AI.
        </div>
      )}
    </div>
  );
}
