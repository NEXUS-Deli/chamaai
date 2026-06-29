import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowDownToLine, CheckCircle2, RefreshCw, BookUser, PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { FerramentasNav } from "@/components/ferramentas-nav";

export const Route = createFileRoute("/_authenticated/ferramentas/importador")({
  component: Importador,
});

interface Instancia { id: string; nome: string; token: string }
interface Pasta { id: string; nome: string }

interface Contato {
  jid?: string;
  id?: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
  number?: string;
  phone?: string;
}

type ContactScope = "address_book" | "not_address_book" | "all";

const scopeOptions: { value: ContactScope; label: string; desc: string }[] = [
  { value: "address_book",     label: "Agenda",        desc: "Apenas contatos salvos na agenda do celular" },
  { value: "not_address_book", label: "Fora da agenda", desc: "Contatos conhecidos, mas não salvos na agenda" },
  { value: "all",              label: "Todos",          desc: "Todos os contatos conhecidos pelo WhatsApp" },
];

function extrairNumero(c: Contato): string {
  if (c.number) return c.number.replace(/\D/g, "");
  if (c.phone) return c.phone.replace(/\D/g, "");
  const jid = c.jid ?? c.id ?? "";
  return jid.split("@")[0].replace(/\D/g, "");
}

function extrairNome(c: Contato): string | null {
  return c.name || c.verifiedName || c.notify || null;
}

function Importador() {
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [instanciaId, setInstanciaId] = useState("");
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [pastaId, setPastaId] = useState("none");
  const [scope, setScope] = useState<ContactScope>("address_book");
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [loadingContatos, setLoadingContatos] = useState(false);
  const [importando, setImportando] = useState(false);
  const [importados, setImportados] = useState(0);

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

  const buscarContatos = async () => {
    const inst = instancias.find((i) => i.id === instanciaId);
    if (!inst) return toast.error("Selecione uma instância");
    setLoadingContatos(true);
    setContatos([]);
    setSelecionados(new Set());
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-proxy", {
        body: { action: "get_contacts", payload: { token: inst.token, contactScope: scope } },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const lista: Contato[] = Array.isArray(data) ? data : [];
      // Filtra grupos (JIDs com @g.us) e contatos sem número
      const validos = lista.filter((c) => {
        const jid = c.jid ?? c.id ?? "";
        if (jid.includes("@g.us") || jid.includes("@broadcast")) return false;
        return extrairNumero(c).length >= 8;
      });

      if (!validos.length) {
        toast.info("Nenhum contato encontrado com os critérios selecionados.");
      } else {
        setContatos(validos);
        setSelecionados(new Set(validos.map((c, i) => c.jid ?? c.id ?? String(i))));
        toast.success(`${validos.length} contatos encontrados`);
      }
    } catch (e) {
      toast.error("Não foi possível buscar contatos: " + String(e instanceof Error ? e.message : e));
    } finally {
      setLoadingContatos(false);
    }
  };

  const chaveContato = (c: Contato, i: number) => c.jid ?? c.id ?? String(i);

  const toggleTodos = () => {
    if (selecionados.size === contatos.length) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(contatos.map((c, i) => chaveContato(c, i))));
    }
  };

  const toggleContato = (key: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const importar = async () => {
    if (!selecionados.size) return toast.error("Selecione ao menos um contato");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    setImportando(true);
    try {
      const rows = contatos
        .filter((c, i) => selecionados.has(chaveContato(c, i)))
        .map((c) => ({
          usuario_id: u.user!.id,
          pasta_id: pastaId === "none" ? null : pastaId || null,
          telefone: extrairNumero(c),
          nome: extrairNome(c),
          empresa: null,
        }))
        .filter((r) => r.telefone.length >= 8);

      if (!rows.length) { toast.error("Nenhum número válido extraído"); setImportando(false); return; }

      const { error } = await supabase.from("leads").upsert(rows, { onConflict: "usuario_id,telefone" });
      if (error) throw new Error(error.message ?? JSON.stringify(error));

      setImportados(rows.length);
      toast.success(`${rows.length} contatos importados com sucesso!`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as {message?: string})?.message ?? JSON.stringify(e);
      toast.error("Erro ao importar: " + msg);
    } finally {
      setImportando(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Importador de Contatos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Importe os contatos do WhatsApp diretamente para uma pasta dentro da Chama AI.
        </p>
      </div>

      <FerramentasNav active="importador" />

      <Card className="p-6 space-y-5">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Instância */}
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

          {/* Escopo de busca */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Filtro de contatos</label>
            <Select value={scope} onValueChange={(v) => setScope(v as ContactScope)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {scopeOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {scopeOptions.find((o) => o.value === scope)?.desc}
            </p>
          </div>

          {/* Pasta destino */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Importar para pasta</label>
            <Select value={pastaId} onValueChange={setPastaId}>
              <SelectTrigger><SelectValue placeholder="Sem pasta (todos os leads)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem pasta</SelectItem>
                {pastas.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button onClick={buscarContatos} disabled={loadingContatos || !instanciaId} variant="outline">
          {loadingContatos
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Buscando contatos…</>
            : <><RefreshCw className="w-4 h-4 mr-2" />Buscar contatos do WhatsApp</>}
        </Button>
      </Card>

      {contatos.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <button onClick={toggleTodos} className="text-sm text-primary underline">
                {selecionados.size === contatos.length ? "Desmarcar todos" : "Selecionar todos"}
              </button>
              <span className="text-sm text-muted-foreground">{selecionados.size} de {contatos.length} selecionados</span>
            </div>
            <Button onClick={importar} disabled={importando || !selecionados.size}>
              {importando
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importando…</>
                : <><ArrowDownToLine className="w-4 h-4 mr-2" />Importar selecionados</>}
            </Button>
          </div>

          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground bg-muted/30">
                <tr>
                  <th className="px-4 py-3 w-10"></th>
                  <th className="font-medium py-3">Nome</th>
                  <th className="font-medium py-3 hidden sm:table-cell">Número</th>
                  <th className="font-medium py-3 hidden lg:table-cell">JID</th>
                </tr>
              </thead>
              <tbody>
                {contatos.map((c, i) => {
                  const key = chaveContato(c, i);
                  const nome = extrairNome(c);
                  const numero = extrairNumero(c);
                  const jid = c.jid ?? c.id ?? "";
                  return (
                    <tr
                      key={key}
                      className="border-b last:border-0 hover:bg-muted/20 cursor-pointer"
                      onClick={() => toggleContato(key)}
                    >
                      <td className="px-4 py-2.5">
                        <input type="checkbox" readOnly checked={selecionados.has(key)} className="accent-primary" />
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          {nome
                            ? <span className="font-medium">{nome}</span>
                            : <span className="text-muted-foreground text-xs">Sem nome</span>}
                        </div>
                      </td>
                      <td className="py-2.5 font-mono text-xs text-muted-foreground hidden sm:table-cell">
                        {numero || "—"}
                      </td>
                      <td className="py-2.5 font-mono text-xs text-muted-foreground hidden lg:table-cell">
                        {jid || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {contatos.length === 0 && !loadingContatos && instanciaId && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground space-y-3">
          <div className="flex gap-3">
            <BookUser className="w-10 h-10 opacity-20" />
            <PhoneCall className="w-10 h-10 opacity-20" />
          </div>
          <p className="text-sm">Clique em "Buscar contatos do WhatsApp" para carregar os contatos da instância selecionada.</p>
        </div>
      )}

      {importados > 0 && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {importados} contatos importados com sucesso para a Chama AI.
        </div>
      )}
    </div>
  );
}
