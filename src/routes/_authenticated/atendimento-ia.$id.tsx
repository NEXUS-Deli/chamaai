import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, Users, Plus, Trash2 } from "lucide-react";
import {
  AgenteFormFields,
  VALORES_PADRAO,
  validarAgente,
  valoresDoBanco,
  valoresParaBanco,
  type AgenteFormValues,
} from "@/components/ai-agent-form";

export const Route = createFileRoute("/_authenticated/atendimento-ia/$id")({
  component: AgenteIADetalhe,
});

interface ContatoExcluido {
  id: string;
  telefone: string;
  nome: string | null;
}

interface AgentData {
  instancia_id: string;
  instancia_nome: string;
  instancia_token: string;
  ativo: boolean;
  valores: AgenteFormValues;
}

function AgenteIADetalhe() {
  const { id: instanciaId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const agentQuery = useQuery<AgentData | null>({
    queryKey: ["ai-agent", instanciaId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("ai_configuracoes")
        .select("instancia_id, ativo, system_prompt, buffer_segundos, responder_audio, responder_imagem, restringir_horario, dias_semana, horario_inicio, horario_fim, mensagem_fora_horario, transferencia_ativa, transferencia_telefone, transferencia_destino, transferencia_destino_nome, instancias(nome, token)")
        .eq("instancia_id", instanciaId)
        .maybeSingle();
      if (!data) return null;
      return {
        instancia_id: data.instancia_id,
        instancia_nome: data.instancias?.nome ?? "WhatsApp",
        instancia_token: data.instancias?.token ?? "",
        ativo: data.ativo,
        valores: valoresDoBanco(data),
      } satisfies AgentData;
    },
  });

  const [ativo, setAtivo] = useState(true);
  const [valores, setValores] = useState<AgenteFormValues>(VALORES_PADRAO);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const a = agentQuery.data;
    if (!a) return;
    setAtivo(a.ativo);
    setValores(a.valores);
  }, [agentQuery.data]);

  // Modal de contatos excluídos
  const [excludeOpen, setExcludeOpen]   = useState(false);
  const [excluidos, setExcluidos]       = useState<ContatoExcluido[]>([]);
  const [loadingExcl, setLoadingExcl]   = useState(false);
  const [novoTel, setNovoTel]           = useState("");
  const [novoNome, setNovoNome]         = useState("");
  const [addingExcl, setAddingExcl]     = useState(false);

  const fetchExcluidos = async () => {
    setLoadingExcl(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("ai_contatos_excluidos")
      .select("id, telefone, nome")
      .eq("instancia_id", instanciaId)
      .order("criado_em", { ascending: false });
    setExcluidos((data ?? []) as ContatoExcluido[]);
    setLoadingExcl(false);
  };

  const openExcludeModal = async () => {
    setExcludeOpen(true);
    setNovoTel(""); setNovoNome("");
    await fetchExcluidos();
  };

  const addExcluido = async () => {
    if (!novoTel.trim()) return toast.error("Informe o telefone");
    setAddingExcl(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      // Mesmo formato do número que chega do WhatsApp (55 + DDD + número); sem isso a exclusão não funcionava
      const digitos = novoTel.replace(/\D/g, "");
      const telefone = digitos.length <= 11 ? `55${digitos}` : digitos;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("ai_contatos_excluidos")
        .insert({ usuario_id: u.user.id, instancia_id: instanciaId, telefone, nome: novoNome.trim() || null });
      if (error) {
        if (error.code === "23505") throw new Error("Este contato já está na lista de exclusão");
        throw new Error(error.message);
      }
      setNovoTel(""); setNovoNome("");
      await fetchExcluidos();
      toast.success("Contato adicionado à exclusão");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao adicionar contato");
    } finally {
      setAddingExcl(false);
    }
  };

  const removeExcluido = async (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("ai_contatos_excluidos").delete().eq("id", id);
    if (error) return toast.error("Erro ao remover contato");
    setExcluidos(prev => prev.filter(c => c.id !== id));
    toast.success("Contato removido da exclusão");
  };

  const salvar = async () => {
    const erro = validarAgente(valores);
    if (erro) return toast.error(erro);
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("ai_configuracoes")
        .update({
          ativo,
          ...valoresParaBanco(valores),
          atualizado_em: new Date().toISOString(),
        })
        .eq("instancia_id", instanciaId);

      if (error) throw new Error(error.message);
      toast.success("Configurações salvas!");
      qc.invalidateQueries({ queryKey: ["ai-agent", instanciaId] });
      qc.invalidateQueries({ queryKey: ["ai-agents"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar configurações");
    } finally {
      setSaving(false);
    }
  };

  const apagar = async () => {
    setDeleting(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("ai_configuracoes")
        .delete()
        .eq("instancia_id", instanciaId);
      if (error) throw new Error(error.message);
      toast.success("Agente apagado");
      qc.invalidateQueries({ queryKey: ["ai-agents"] });
      navigate({ to: "/atendimento-ia" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao apagar agente");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (agentQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!agentQuery.data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
        <p className="text-lg font-semibold">Agente não encontrado</p>
        <Link to="/atendimento-ia"><Button>Voltar para Atendimento com IA</Button></Link>
      </div>
    );
  }

  const a = agentQuery.data;

  return (
    <div className="p-4 sm:p-8 w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{a.instancia_nome}</h1>
          <p className="text-sm text-muted-foreground">Configurações do agente de IA</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground">{ativo ? "Agente ativo" : "Agente pausado"}</span>
          <Switch checked={ativo} onCheckedChange={setAtivo} />
        </div>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <AgenteFormFields values={valores} onChange={setValores} instanciaToken={a.instancia_token} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button onClick={salvar} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Salvar configurações
          </Button>
          <Button variant="outline" onClick={openExcludeModal} className="gap-2">
            <Users className="w-4 h-4" />
            Contatos Excluídos
          </Button>
        </div>
        <Button variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="w-4 h-4 mr-2" />
          Apagar agente
        </Button>
      </div>

      {/* Modal: Contatos Excluídos */}
      <Dialog open={excludeOpen} onOpenChange={setExcludeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Contatos Excluídos
            </DialogTitle>
            <DialogDescription>
              {a.instancia_nome} — O agente de IA não responderá a estes contatos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
              <p className="text-xs font-medium text-muted-foreground">Adicionar contato</p>
              <div className="flex gap-2">
                <Input placeholder="Telefone (ex: 11999990000)" value={novoTel} onChange={e => setNovoTel(e.target.value)} className="text-sm" onKeyDown={e => e.key === "Enter" && addExcluido()} />
                <Input placeholder="Nome (opcional)" value={novoNome} onChange={e => setNovoNome(e.target.value)} className="text-sm" />
              </div>
              <Button size="sm" onClick={addExcluido} disabled={addingExcl || !novoTel.trim()} className="w-full">
                {addingExcl ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
                Adicionar
              </Button>
            </div>

            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {loadingExcl ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando...
                </div>
              ) : excluidos.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum contato excluído.</p>
              ) : (
                excluidos.map(c => (
                  <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-background">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{c.nome || c.telefone}</p>
                      {c.nome && <p className="text-xs text-muted-foreground font-mono">{c.telefone}</p>}
                    </div>
                    <button
                      onClick={() => removeExcluido(c.id)}
                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão do agente */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar agente de IA</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza de que deseja apagar o agente de "{a.instancia_nome}"? A configuração será removida e o agente deixará de responder mensagens nesta instância.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground ring-0 before:hidden [&_svg]:text-destructive-foreground"
              onClick={apagar}
              disabled={deleting}
            >
              {deleting ? "Apagando..." : "Apagar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
