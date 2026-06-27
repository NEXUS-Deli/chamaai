import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Pause, Play, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/campanhas/$id")({
  component: Detalhes,
});

function Detalhes() {
  const { id } = Route.useParams();
  const [camp, setCamp] = useState<any>(null);
  const [contatos, setContatos] = useState<any[]>([]);
  const [loadingAcao, setLoadingAcao] = useState(false);

  const load = async () => {
    const { data: c } = await supabase.from("campanhas").select("*").eq("id", id).single();
    setCamp(c);
    const { data: cs } = await supabase
      .from("contatos_campanha")
      .select("*")
      .eq("campanha_id", id)
      .order("atualizado_em", { ascending: false });
    setContatos(cs ?? []);
  };

  useEffect(() => { load(); }, [id]);

  // Polling a cada 5s enquanto em andamento ou pausada
  useEffect(() => {
    if (!camp || !["em_andamento", "pausada"].includes(camp.status)) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [camp?.status, id]);

  if (!camp) return <div className="p-8">Carregando…</div>;

  const acaoComLoading = async (fn: () => Promise<void>) => {
    setLoadingAcao(true);
    try { await fn(); await load(); }
    catch (e) { toast.error("Erro ao executar ação: " + String(e)); }
    finally { setLoadingAcao(false); }
  };

  const handleIniciar = () =>
    acaoComLoading(async () => {
      const { error } = await supabase
        .from("campanhas")
        .update({ status: "em_andamento" })
        .eq("id", id);
      if (error) throw error;
      toast.success("Campanha iniciada! O motor processará os contatos em até 1 minuto.");
    });

  const handlePausar = () =>
    acaoComLoading(async () => {
      const { error } = await supabase
        .from("campanhas")
        .update({ status: "pausada" })
        .eq("id", id);
      if (error) throw error;
      toast.success("Campanha pausada.");
    });

  const handleRetomar = () =>
    acaoComLoading(async () => {
      const { error } = await supabase
        .from("campanhas")
        .update({ status: "em_andamento" })
        .eq("id", id);
      if (error) throw error;
      toast.success("Campanha retomada.");
    });

  const handleCancelar = () =>
    acaoComLoading(async () => {
      if (!confirm("Cancelar a campanha? Esta ação não pode ser desfeita.")) return;
      const { error: e1 } = await supabase
        .from("contatos_campanha")
        .update({ status: "cancelado" })
        .eq("campanha_id", id)
        .eq("status", "pendente");
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("campanhas")
        .update({ status: "cancelada" })
        .eq("id", id);
      if (e2) throw e2;
      toast.success("Campanha cancelada.");
    });

  const pct = camp.total_contatos > 0 ? (camp.enviadas / camp.total_contatos) * 100 : 0;

  const statusLabel: Record<string, string> = {
    aguardando: "Aguardando",
    agendada: "Agendada",
    em_andamento: "Em andamento",
    pausada: "Pausada",
    concluida: "Concluída",
    cancelada: "Cancelada",
  };

  const statusColor: Record<string, string> = {
    aguardando: "bg-yellow-100 text-yellow-800",
    agendada: "bg-blue-100 text-blue-800",
    em_andamento: "bg-green-100 text-green-800",
    pausada: "bg-orange-100 text-orange-800",
    concluida: "bg-muted text-muted-foreground",
    cancelada: "bg-red-100 text-red-800",
  };

  const contatoStatusColor: Record<string, string> = {
    pendente: "bg-yellow-100 text-yellow-800",
    enviado: "bg-green-100 text-green-800",
    invalido: "bg-red-100 text-red-800",
    erro: "bg-red-100 text-red-800",
    cancelado: "bg-muted text-muted-foreground",
  };

  const instanciasNomes: string[] = Array.isArray(camp.instancias_selecionadas)
    ? (camp.instancias_selecionadas as { nome: string }[]).map((i) => i.nome)
    : camp.instancia_nome
    ? [camp.instancia_nome]
    : [];

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{camp.nome}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor[camp.status] ?? "bg-muted"}`}>
              {statusLabel[camp.status] ?? camp.status}
            </span>
            {camp.agendada_para && (
              <span className="text-xs text-muted-foreground">
                Agendada para {new Date(camp.agendada_para).toLocaleString("pt-BR")}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          {["aguardando", "agendada"].includes(camp.status) && (
            <Button onClick={handleIniciar} disabled={loadingAcao}>
              {loadingAcao ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              Iniciar Agora
            </Button>
          )}
          {camp.status === "em_andamento" && (
            <Button variant="outline" onClick={handlePausar} disabled={loadingAcao}>
              {loadingAcao ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Pause className="w-4 h-4 mr-2" />}
              Pausar
            </Button>
          )}
          {camp.status === "pausada" && (
            <Button variant="outline" onClick={handleRetomar} disabled={loadingAcao}>
              {loadingAcao ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              Retomar
            </Button>
          )}
          {["aguardando", "agendada", "em_andamento", "pausada"].includes(camp.status) && (
            <Button variant="outline" onClick={handleCancelar} disabled={loadingAcao}>
              <X className="w-4 h-4 mr-2" />Cancelar
            </Button>
          )}
        </div>
      </div>

      {/* Progresso */}
      <Card className="p-6 space-y-3">
        <div className="flex justify-between text-sm">
          <span>Progresso</span>
          <span>{camp.enviadas}/{camp.total_contatos}</span>
        </div>
        <Progress value={pct} />
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { l: "Enviadas", v: camp.enviadas },
          { l: "Entregues", v: camp.entregues },
          { l: "Erros / Inválidos", v: camp.erros },
          { l: "Pendentes", v: Math.max(0, camp.total_contatos - camp.enviadas - camp.erros) },
        ].map((s) => (
          <Card key={s.l} className="p-5">
            <div className="text-sm text-muted-foreground">{s.l}</div>
            <div className="text-2xl font-bold">{Math.max(0, s.v)}</div>
          </Card>
        ))}
      </div>

      {/* Detalhes da campanha */}
      <Card className="p-5 space-y-3 text-sm">
        <h3 className="font-semibold">Configurações</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-muted-foreground">
          <div><span className="block font-medium text-foreground">Delay</span>{camp.delay_minimo}s – {camp.delay_maximo}s</div>
          <div><span className="block font-medium text-foreground">Horário</span>{camp.horario_inicio ?? "08:00"} – {camp.horario_fim ?? "22:00"}</div>
          <div>
            <span className="block font-medium text-foreground">Instâncias</span>
            {instanciasNomes.length > 0 ? instanciasNomes.join(", ") : "—"}
          </div>
          <div>
            <span className="block font-medium text-foreground">Variações de mensagem</span>
            {Array.isArray(camp.mensagens_variacoes) && (camp.mensagens_variacoes as string[]).length > 0
              ? `${(camp.mensagens_variacoes as string[]).length} variação(ões)`
              : "1 mensagem fixa"}
          </div>
        </div>
      </Card>

      {/* Tabela de contatos */}
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground border-b">
            <tr>
              <th className="px-6 py-3">Telefone</th>
              <th>Nome</th>
              <th>Status</th>
              <th>Instância</th>
              <th>Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {contatos.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="px-6 py-3">{c.telefone}</td>
                <td>{c.nome || "—"}</td>
                <td>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${contatoStatusColor[c.status] ?? "bg-muted"}`}>
                    {c.status}
                  </span>
                </td>
                <td className="text-muted-foreground text-xs">{c.instancia_usada ?? "—"}</td>
                <td className="text-muted-foreground text-xs">
                  {new Date(c.atualizado_em).toLocaleString("pt-BR")}
                </td>
              </tr>
            ))}
            {!contatos.length && (
              <tr><td colSpan={5} className="p-12 text-center text-muted-foreground">Sem contatos</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
