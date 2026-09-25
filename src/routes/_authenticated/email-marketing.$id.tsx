import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Pause, Play, X, Loader2, Filter, Download, Mail, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/email-marketing/$id")({
  component: EmailCampanhaDetalhes,
});

function EmailCampanhaDetalhes() {
  const { id } = Route.useParams();
  const [camp, setCamp] = useState<any>(null);
  const [contatos, setContatos] = useState<any[]>([]);
  const [loadingAcao, setLoadingAcao] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [nextSendAt, setNextSendAt] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const load = async () => {
    const { data: c } = await supabase.from("campanhas").select("*").eq("id", id).single();
    setCamp(c);
    const { data: cs } = await supabase
      .from("contatos_campanha")
      .select("*")
      .eq("campanha_id", id)
      .order("atualizado_em", { ascending: false });
    setContatos(cs ?? []);

    const { data: nextPending } = await supabase
      .from("contatos_campanha")
      .select("next_send_at")
      .eq("campanha_id", id)
      .eq("status", "pendente")
      .not("next_send_at", "is", null)
      .order("next_send_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    setNextSendAt(nextPending?.next_send_at ?? null);
  };

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (!camp || !["em_andamento", "pausada"].includes(camp.status)) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [camp?.status, id]);

  useEffect(() => {
    if (!nextSendAt || camp?.status !== "em_andamento") { setSecondsLeft(null); return; }
    const nextTime = new Date(nextSendAt).getTime();
    const tick = () => setSecondsLeft(Math.max(0, Math.round((nextTime - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [nextSendAt, camp?.status]);

  if (!camp) return <div className="p-8 flex items-center gap-3 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Carregando...</div>;

  const acaoComLoading = async (fn: () => Promise<void>) => {
    setLoadingAcao(true);
    try { await fn(); await load(); }
    catch (e) { toast.error("Erro: " + String(e)); }
    finally { setLoadingAcao(false); }
  };

  const handleIniciar = () =>
    acaoComLoading(async () => {
      const { error } = await supabase.from("campanhas").update({ status: "em_andamento" }).eq("id", id);
      if (error) throw error;
      toast.success("Campanha iniciada!");
    });

  const handlePausar = () =>
    acaoComLoading(async () => {
      const { error } = await supabase.from("campanhas").update({ status: "pausada" }).eq("id", id);
      if (error) throw error;
      toast.success("Campanha pausada.");
    });

  const handleRetomar = () =>
    acaoComLoading(async () => {
      const { error } = await supabase.from("campanhas").update({ status: "em_andamento" }).eq("id", id);
      if (error) throw error;
      toast.success("Campanha retomada.");
    });

  const handleCancelar = () =>
    acaoComLoading(async () => {
      if (!confirm("Cancelar a campanha? Esta ação não pode ser desfeita.")) return;
      await supabase.from("contatos_campanha").update({ status: "cancelado" }).eq("campanha_id", id).eq("status", "pendente");
      await supabase.from("campanhas").update({ status: "cancelada" }).eq("id", id);
      toast.success("Campanha cancelada.");
    });

  const handleReenviarErros = () =>
    acaoComLoading(async () => {
      const agora = new Date().toISOString();
      const { error: e1 } = await supabase
        .from("contatos_campanha")
        .update({ status: "pendente", next_send_at: agora })
        .eq("campanha_id", id)
        .in("status", ["erro", "invalido"]);
      if (e1) throw e1;

      const { error: e2 } = await supabase
        .from("campanhas")
        .update({ status: "em_andamento" })
        .eq("id", id);
      if (e2) throw e2;

      toast.success("Contatos redefinidos para envio! O disparo iniciará em instantes.");
    });

  const enviadasCount = contatos.filter((c) => ["enviado", "entregue", "lido"].includes(c.status)).length;
  const errosCount = contatos.filter((c) => ["erro", "invalido"].includes(c.status)).length;
  const pendentesCount = contatos.filter((c) => c.status === "pendente").length;
  const totalCount = contatos.length || camp.total_contatos || 0;
  const pct = totalCount > 0 ? (enviadasCount / totalCount) * 100 : 0;

  const STATUS_LABEL: Record<string, string> = {
    aguardando: "Aguardando", agendada: "Agendada", em_andamento: "Em andamento",
    pausada: "Pausada", concluida: "Concluída", cancelada: "Cancelada",
  };
  const STATUS_COLOR: Record<string, string> = {
    aguardando: "bg-yellow-100 text-yellow-800", agendada: "bg-blue-100 text-blue-800",
    em_andamento: "bg-green-100 text-green-800", pausada: "bg-orange-100 text-orange-800",
    concluida: "bg-muted text-muted-foreground", cancelada: "bg-red-100 text-red-800",
  };
  const CONTATO_STATUS_COLOR: Record<string, string> = {
    pendente: "bg-yellow-100 text-yellow-800", enviado: "bg-blue-100 text-blue-800",
    entregue: "bg-green-100 text-green-800", lido: "bg-purple-100 text-purple-800",
    invalido: "bg-red-100 text-red-800", erro: "bg-red-100 text-red-800",
    cancelado: "bg-muted text-muted-foreground",
  };
  const CONTATO_STATUS_LABEL: Record<string, string> = {
    pendente: "Pendente", enviado: "Enviado", entregue: "Entregue",
    lido: "Lido", invalido: "Inválido", erro: "Erro", cancelado: "Cancelado",
  };

  const contatosFiltrados = filtroStatus === "todos" ? contatos : contatos.filter((c) => c.status === filtroStatus);

  const exportarCSV = () => {
    const header = "email,nome,status,atualizado_em";
    const rows = contatosFiltrados.map((c) =>
      [c.telefone, c.nome ?? "", c.status, c.atualizado_em].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `email-campanha-${camp.nome.replace(/\s+/g, "-")}.csv`;
    a.click();
  };

  return (
    <div className="p-8 w-full space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="w-6 h-6 text-primary" />
            {camp.nome}
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[camp.status] ?? "bg-muted"}`}>
              {STATUS_LABEL[camp.status] ?? camp.status}
            </span>
            {camp.agendada_para && (
              <span className="text-xs text-muted-foreground">
                Agendada para {new Date(camp.agendada_para).toLocaleString("pt-BR")}
              </span>
            )}
            <span className="text-xs text-muted-foreground">E-mail Marketing</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
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
          {errosCount > 0 && (
            <Button variant="secondary" onClick={handleReenviarErros} disabled={loadingAcao}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Reenviar Erros ({errosCount})
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={load} title="Atualizar">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Progresso */}
      <Card className="p-6 space-y-3">
        <div className="flex justify-between text-sm">
          <span>Progresso de envio</span>
          <span className="font-semibold">{enviadasCount}/{totalCount}</span>
        </div>
        <Progress value={pct} />
        {camp.status === "em_andamento" && pendentesCount > 0 && (
          <div className="pt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {secondsLeft !== null && secondsLeft > 0 ? (
              <>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span>Próximo envio em <strong className="text-primary">{secondsLeft}s</strong></span>
              </>
            ) : (
              <>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span>Enviando agora…</span>
              </>
            )}
          </div>
        )}
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Enviadas</div>
          <div className="text-2xl font-bold">{enviadasCount}</div>
          {totalCount > 0 && <div className="text-xs text-muted-foreground">{Math.round((enviadasCount / totalCount) * 100)}%</div>}
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Erros</div>
          <div className="text-2xl font-bold text-destructive">{errosCount}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Pendentes</div>
          <div className="text-2xl font-bold">{pendentesCount}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="text-2xl font-bold">{totalCount}</div>
        </Card>
      </div>

      {/* Configurações */}
      <Card className="p-5 text-sm space-y-2">
        <h3 className="font-semibold">Detalhes da Campanha</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-muted-foreground">
          <div><span className="block font-medium text-foreground">Assunto</span>{camp.email_assunto || "—"}</div>
          <div><span className="block font-medium text-foreground">Delay</span>{camp.delay_minimo}s – {camp.delay_maximo}s</div>
          <div><span className="block font-medium text-foreground">Horário</span>{camp.horario_inicio ?? "08:00"} – {camp.horario_fim ?? "22:00"}</div>
          <div><span className="block font-medium text-foreground">Tipo</span>E-mail Marketing</div>
        </div>
      </Card>

      {/* Tabela de contatos */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b flex-wrap">
          <div className="flex items-center gap-2 flex-1 flex-wrap">
            <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
            {["todos", "pendente", "enviado", "entregue", "erro", "invalido", "cancelado"].map((s) => (
              <button
                key={s}
                onClick={() => setFiltroStatus(s)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  filtroStatus === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {s === "todos" ? `Todos (${contatos.length})` : `${CONTATO_STATUS_LABEL[s] ?? s} (${contatos.filter((c) => c.status === s).length})`}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={exportarCSV} className="gap-2 shrink-0">
            <Download className="w-4 h-4" /> Exportar CSV
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[400px]">
            <thead className="text-left text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="px-6 py-3">E-mail</th>
                <th className="py-3">Nome</th>
                <th className="py-3">Status</th>
                <th className="py-3">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {contatosFiltrados.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-3 font-mono text-xs">{c.telefone}</td>
                  <td className="py-3 text-sm">{c.nome || "—"}</td>
                  <td className="py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${CONTATO_STATUS_COLOR[c.status] ?? "bg-muted"}`}>
                      {CONTATO_STATUS_LABEL[c.status] ?? c.status}
                    </span>
                    {c.status === "erro" && c.mensagem_enviada && (
                      <p className="text-[11px] text-destructive mt-1 max-w-[280px] break-words leading-tight" title={c.mensagem_enviada}>
                        {c.mensagem_enviada}
                      </p>
                    )}
                  </td>
                  <td className="py-3 text-muted-foreground text-xs">
                    {new Date(c.atualizado_em).toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
              {!contatosFiltrados.length && (
                <tr><td colSpan={4} className="p-12 text-center text-muted-foreground">
                  {filtroStatus === "todos" ? "Sem contatos" : "Nenhum contato com este status"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
