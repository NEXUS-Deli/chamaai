import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Pause, Play, X, Loader2, FileText, ImageIcon, Video, Download, Filter } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/campanhas/$id")({
  component: Detalhes,
});

function MidiaPreview({ tipo, url, nome }: { tipo: string; url: string; nome: string }) {
  if (tipo.startsWith("image/")) {
    return (
      <div className="flex items-center gap-3">
        <img src={url} alt={nome} className="w-16 h-16 rounded-md object-cover border" />
        <div>
          <p className="text-sm font-medium">{nome}</p>
          <p className="text-xs text-muted-foreground">Imagem</p>
        </div>
      </div>
    );
  }
  if (tipo.startsWith("video/")) {
    return (
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-md border bg-muted flex items-center justify-center">
          <Video className="w-6 h-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">{nome}</p>
          <p className="text-xs text-muted-foreground">Vídeo</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <div className="w-16 h-16 rounded-md border bg-muted flex items-center justify-center">
        <FileText className="w-6 h-6 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">{nome}</p>
        <p className="text-xs text-muted-foreground">Documento</p>
      </div>
    </div>
  );
}

function Detalhes() {
  const { id } = Route.useParams();
  const [camp, setCamp] = useState<any>(null);
  const [contatos, setContatos] = useState<any[]>([]);
  const [loadingAcao, setLoadingAcao] = useState(false);
  const [nextSendAt, setNextSendAt] = useState<string | null>(null);
  const [lastDispatchAt, setLastDispatchAt] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");

  const load = async () => {
    const { data: c } = await supabase.from("campanhas").select("*").eq("id", id).single();
    setCamp(c);
    const { data: cs } = await supabase
      .from("contatos_campanha")
      .select("*")
      .eq("campanha_id", id)
      .order("atualizado_em", { ascending: false });
    setContatos(cs ?? []);

    // Próximo contato agendado (para countdown)
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

    // Último disparo realizado (referência do início do countdown)
    const lastSent = (cs ?? [])
      .filter((x: any) => ["enviado", "entregue", "lido"].includes(x.status))
      .sort((a: any, b: any) => new Date(b.atualizado_em).getTime() - new Date(a.atualizado_em).getTime())[0];
    setLastDispatchAt(lastSent?.atualizado_em ?? null);
  };

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (!camp || !["em_andamento", "pausada"].includes(camp.status)) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [camp?.status, id]);

  // Tick de 1s para atualizar o countdown em tempo real
  useEffect(() => {
    if (!nextSendAt || camp?.status !== "em_andamento") {
      setSecondsLeft(null);
      return;
    }
    const nextTime = new Date(nextSendAt).getTime();
    const tick = () => setSecondsLeft(Math.max(0, Math.round((nextTime - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [nextSendAt, camp?.status]);

  if (!camp) return <div className="p-8">Carregando…</div>;

  // Delay médio entre envios reais
  const contatosEnviados = [...contatos]
    .filter((c) => ["enviado", "entregue", "lido"].includes(c.status))
    .sort((a, b) => new Date(a.atualizado_em).getTime() - new Date(b.atualizado_em).getTime());

  const delayMedioSeg = (() => {
    if (contatosEnviados.length < 2) return null;
    const first = new Date(contatosEnviados[0].atualizado_em).getTime();
    const last = new Date(contatosEnviados[contatosEnviados.length - 1].atualizado_em).getTime();
    return Math.round((last - first) / (contatosEnviados.length - 1) / 1000);
  })();

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
      toast.success("Campanha iniciada! O motor processará os contatos em até 1 minuto.");
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
      const { error: e1 } = await supabase
        .from("contatos_campanha").update({ status: "cancelado" })
        .eq("campanha_id", id).eq("status", "pendente");
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("campanhas").update({ status: "cancelada" }).eq("id", id);
      if (e2) throw e2;
      toast.success("Campanha cancelada.");
    });

  // Derivar contadores do array contatos (mais atualizado que camp.enviadas do DB)
  const enviadasCount = contatos.filter((c) => ["enviado", "entregue", "lido"].includes(c.status)).length;
  const entreguesCount = contatos.filter((c) => ["entregue", "lido"].includes(c.status)).length;
  const errosCount = contatos.filter((c) => ["erro", "invalido"].includes(c.status)).length;
  const pendentesCount = contatos.filter((c) => c.status === "pendente").length;
  const totalCount = contatos.length || camp.total_contatos || 0;
  const pct = totalCount > 0 ? (enviadasCount / totalCount) * 100 : 0;

  // Percentual do countdown: elapsed / total_delay onde total = next_send_at - last_dispatch_at
  const countdownPct = (() => {
    if (secondsLeft === null || !nextSendAt) return null;
    const nextTime = new Date(nextSendAt).getTime();
    const fromTime = lastDispatchAt
      ? new Date(lastDispatchAt).getTime()
      : nextTime - (camp.delay_maximo ?? 15) * 1000;
    const totalMs = Math.max(1000, nextTime - fromTime);
    const elapsedMs = totalMs - secondsLeft * 1000;
    return Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));
  })();

  const estaForaDoHorario = (inicio: string, fim: string): boolean => {
    const agora = new Date();
    const h = (agora.getUTCHours() - 3 + 24) % 24;
    const m = agora.getUTCMinutes();
    const total = h * 60 + m;
    const [hI, mI] = inicio.split(":").map(Number);
    const [hF, mF] = fim.split(":").map(Number);
    const inicioMin = hI * 60 + mI;
    const fimMin = hF === 0 && mF === 0 ? 24 * 60 : hF * 60 + mF;
    return total < inicioMin || total > fimMin;
  };

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
    enviado: "bg-blue-100 text-blue-800",
    entregue: "bg-green-100 text-green-800",
    lido: "bg-purple-100 text-purple-800",
    invalido: "bg-red-100 text-red-800",
    erro: "bg-red-100 text-red-800",
    cancelado: "bg-muted text-muted-foreground",
  };

  const contatoStatusLabel: Record<string, string> = {
    pendente: "Pendente",
    enviado: "Enviado",
    entregue: "Entregue",
    lido: "Lido",
    invalido: "Inválido",
    erro: "Erro",
    cancelado: "Cancelado",
  };

  const instanciasNomes: string[] = Array.isArray(camp.instancias_selecionadas)
    ? (camp.instancias_selecionadas as { nome: string }[]).map((i) => i.nome)
    : camp.instancia_nome ? [camp.instancia_nome] : [];

  const contatosFiltrados = filtroStatus === "todos"
    ? contatos
    : contatos.filter((c) => c.status === filtroStatus);

  const exportarCSV = () => {
    const header = "telefone,nome,status,instancia,mensagem,atualizado_em";
    const rows = contatosFiltrados.map((c) =>
      [c.telefone, c.nome ?? "", c.status, c.instancia_usada ?? "", `"${(c.mensagem_enviada ?? "").replace(/"/g, '""')}"`, c.atualizado_em].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `campanha-${camp.nome.replace(/\s+/g, "-")}.csv`;
    a.click();
  };


  return (
    <div className="p-8 space-y-6">
      {/* Header */}
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
          <span>{enviadasCount}/{totalCount}</span>
        </div>
        <Progress value={pct} />

        {/* Countdown do próximo disparo */}
        {camp.status === "em_andamento" && pendentesCount > 0 && (
          <div className="pt-2 space-y-1.5">
            {estaForaDoHorario(camp.horario_inicio ?? "08:00", camp.horario_fim ?? "22:00") ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500" />
                <span>Fora do horário de disparo — retoma às {camp.horario_inicio ?? "08:00"}</span>
              </div>
            ) : secondsLeft !== null && secondsLeft > 0 ? (
              <>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Próximo disparo em</span>
                  <span className="tabular-nums font-semibold text-primary">{secondsLeft}s</span>
                </div>
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
                  <div
                    className="h-full rounded-full bg-primary transition-none"
                    style={{ width: `${countdownPct ?? 0}%` }}
                  />
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span>Disparando agora…</span>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { l: "Enviadas", v: enviadasCount },
          { l: "Entregues", v: entreguesCount },
          { l: "Erros / Inválidos", v: errosCount },
          { l: "Pendentes", v: pendentesCount },
        ].map((s) => (
          <Card key={s.l} className="p-5">
            <div className="text-sm text-muted-foreground">{s.l}</div>
            <div className="text-2xl font-bold">{s.v}</div>
          </Card>
        ))}
      </div>

      {/* Configurações + Mídia + Delay médio */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-5 space-y-3 text-sm">
          <h3 className="font-semibold">Configurações</h3>
          <div className="grid grid-cols-2 gap-3 text-muted-foreground">
            <div>
              <span className="block font-medium text-foreground">Delay configurado</span>
              {camp.delay_minimo}s – {camp.delay_maximo}s
            </div>
            <div>
              <span className="block font-medium text-foreground">Delay médio real</span>
              {delayMedioSeg !== null ? `${delayMedioSeg}s` : "—"}
            </div>
            <div>
              <span className="block font-medium text-foreground">Horário</span>
              {camp.horario_inicio ?? "08:00"} – {camp.horario_fim ?? "22:00"}
            </div>
            <div>
              <span className="block font-medium text-foreground">Instâncias</span>
              {instanciasNomes.length > 0 ? instanciasNomes.join(", ") : "—"}
            </div>
            <div className="col-span-2">
              <span className="block font-medium text-foreground">Variações de mensagem</span>
              {Array.isArray(camp.mensagens_variacoes) && (camp.mensagens_variacoes as string[]).length > 0
                ? `${(camp.mensagens_variacoes as string[]).length} variação(ões)`
                : "1 mensagem fixa"}
            </div>
          </div>
        </Card>

        <Card className="p-5 space-y-3 text-sm">
          <h3 className="font-semibold">Mídias</h3>
          {(() => {
            const variacoes = Array.isArray(camp.midias_variacoes) && (camp.midias_variacoes as { url: string; tipo: string; nome: string }[]).length > 0
              ? (camp.midias_variacoes as { url: string; tipo: string; nome: string }[])
              : camp.midia_url && camp.midia_tipo && camp.midia_nome
              ? [{ url: camp.midia_url, tipo: camp.midia_tipo, nome: camp.midia_nome }]
              : [];
            if (variacoes.length === 0) {
              return (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <ImageIcon className="w-4 h-4" />
                  <span>Sem mídia — apenas texto</span>
                </div>
              );
            }
            return (
              <div className="space-y-2">
                {variacoes.length > 1 && (
                  <p className="text-xs text-muted-foreground">{variacoes.length} variação(ões) — o sistema sorteia uma por envio</p>
                )}
                <div className="flex flex-wrap gap-3">
                  {variacoes.map((m, i) => (
                    <MidiaPreview key={i} tipo={m.tipo} url={m.url} nome={m.nome} />
                  ))}
                </div>
              </div>
            );
          })()}
        </Card>
      </div>

      {/* Tabela de contatos */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b flex-wrap">
          <div className="flex items-center gap-2 flex-1 flex-wrap">
            <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
            {["todos","pendente","enviado","entregue","lido","erro","invalido","cancelado"].map((s) => (
              <button
                key={s}
                onClick={() => setFiltroStatus(s)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  filtroStatus === s
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {s === "todos" ? `Todos (${contatos.length})` : `${contatoStatusLabel[s] ?? s} (${contatos.filter((c) => c.status === s).length})`}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={exportarCSV} className="gap-2 shrink-0">
            <Download className="w-4 h-4" /> Exportar CSV
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground border-b">
            <tr>
              <th className="px-6 py-3">Telefone</th>
              <th>Nome</th>
              <th>Status</th>
              <th>Instância</th>
              <th>Mensagem enviada</th>
              <th>Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {contatosFiltrados.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="px-6 py-3 font-mono text-xs">{c.telefone}</td>
                <td>{c.nome || "—"}</td>
                <td>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${contatoStatusColor[c.status] ?? "bg-muted"}`}>
                    {contatoStatusLabel[c.status] ?? c.status}
                  </span>
                </td>
                <td className="text-muted-foreground text-xs">{c.instancia_usada ?? "—"}</td>
                <td className="text-muted-foreground text-xs max-w-xs truncate" title={c.mensagem_enviada ?? ""}>
                  {c.mensagem_enviada ?? "—"}
                </td>
                <td className="text-muted-foreground text-xs">
                  {new Date(c.atualizado_em).toLocaleString("pt-BR")}
                </td>
              </tr>
            ))}
            {!contatosFiltrados.length && (
              <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">
                {filtroStatus === "todos" ? "Sem contatos" : "Nenhum contato com este status"}
              </td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
