import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Smartphone } from "lucide-react";
import {
  AgenteFormFields,
  VALORES_PADRAO,
  validarAgente,
  valoresParaBanco,
  type AgenteFormValues,
} from "@/components/ai-agent-form";

export const Route = createFileRoute("/_authenticated/atendimento-ia/nova")({
  component: NovoAgenteIA,
});

interface Instancia {
  id: string;
  nome: string;
  status: string;
  token: string | null;
}

function NovoAgenteIA() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Instâncias do usuário que ainda não têm agente (um agente por WhatsApp)
  const disponiveisQuery = useQuery<Instancia[]>({
    queryKey: ["ai-instancias-disponiveis"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Não autenticado");

      const [instRes, configRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("instancias")
          .select("id, nome, status, token")
          .eq("usuario_id", uid)
          .neq("instancia", "r1b5f62949ba437")
          .order("criada_em", { ascending: false }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("ai_configuracoes")
          .select("instancia_id")
          .eq("usuario_id", uid),
      ]);

      const jaConfiguradas = new Set(((configRes.data ?? []) as { instancia_id: string }[]).map(r => r.instancia_id));
      return ((instRes.data ?? []) as Instancia[]).filter(i => !jaConfiguradas.has(i.id));
    },
  });

  const [instanciaId, setInstanciaId] = useState<string>("");
  useEffect(() => {
    if (!instanciaId && disponiveisQuery.data && disponiveisQuery.data.length > 0) {
      setInstanciaId(disponiveisQuery.data[0].id);
    }
  }, [disponiveisQuery.data, instanciaId]);

  const [valores, setValores] = useState<AgenteFormValues>(VALORES_PADRAO);
  const [saving, setSaving] = useState(false);

  const instancias = disponiveisQuery.data ?? [];
  const instanciaSelecionada = instancias.find(i => i.id === instanciaId);

  const salvar = async () => {
    if (!instanciaId) return toast.error("Selecione o WhatsApp do agente");
    const erro = validarAgente(valores);
    if (erro) return toast.error(erro);

    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("ai_configuracoes")
        .insert({
          usuario_id: u.user.id,
          instancia_id: instanciaId,
          ativo: true,
          ...valoresParaBanco(valores),
        });

      if (error) throw new Error(error.message);
      toast.success("Agente de IA criado e ativado!");
      qc.invalidateQueries({ queryKey: ["ai-agents"] });
      qc.invalidateQueries({ queryKey: ["ai-instancias-disponiveis"] });
      navigate({ to: "/atendimento-ia/$id", params: { id: instanciaId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar agente");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Criar Agente de IA</h1>
        <p className="text-sm text-muted-foreground">
          O agente responde automaticamente as mensagens recebidas no WhatsApp escolhido.
        </p>
      </div>

      {disponiveisQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando seus WhatsApps...
        </div>
      ) : instancias.length === 0 ? (
        <div className="border rounded-xl bg-card p-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            Todos os seus WhatsApps já têm um agente, ou você ainda não conectou nenhum.
          </p>
          <div className="flex justify-center gap-4 text-sm font-medium">
            <Link to="/configuracoes" className="text-brand hover:underline">Conectar um WhatsApp</Link>
            <Link to="/atendimento-ia" className="text-brand hover:underline">Ver meus agentes</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="border rounded-xl bg-card overflow-hidden">
            {/* WhatsApp do agente */}
            <div className="px-5 py-4 border-b space-y-3">
              <div className="flex items-start gap-3">
                <Smartphone className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">WhatsApp do agente</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Escolha qual número o agente vai atender.</p>
                </div>
              </div>
              <div className="pl-7 max-w-md">
                <Select value={instanciaId} onValueChange={setInstanciaId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {instancias.map(i => (
                      <SelectItem key={i.id} value={i.id}>{i.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <AgenteFormFields
              values={valores}
              onChange={setValores}
              instanciaToken={instanciaSelecionada?.token}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={salvar} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Criar agente
            </Button>
            <Link to="/atendimento-ia">
              <Button variant="ghost">Cancelar</Button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
