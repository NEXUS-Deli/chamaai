import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Pause, Play, X, Loader2 } from "lucide-react";
import { buscarStatus, chamarAcaoCampanha, dispararCampanha } from "@/lib/webhooks";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/campanhas/$id")({
  component: Detalhes,
});

function Detalhes() {
  const { id } = Route.useParams();
  const [camp, setCamp] = useState<any>(null);
  const [contatos, setContatos] = useState<any[]>([]);
  const [cfg, setCfg] = useState<any>(null);
  const [loadingAcao, setLoadingAcao] = useState(false);

  const iniciarCampanha = async () => {
    if (!cfg?.webhook_criar) return toast.error("Webhook de criação não configurado.");
    setLoadingAcao(true);
    try {
      const ok = await dispararCampanha(cfg.webhook_criar, {
        campanha_id: camp.id,
        nome: camp.nome,
        mensagem: camp.mensagem,
        midia_url: camp.midia_url,
        midia_nome: camp.midia_nome,
        midia_tipo: camp.midia_tipo,
        midia_path: camp.midia_path,
        midia_bucket: camp.midia_bucket,
        delay_segundos: camp.delay_minimo || 5, // retrocompatibilidade
        delay_minimo: camp.delay_minimo || 5,
        delay_maximo: camp.delay_maximo || 15,
        delay_mensagens: camp.delay_mensagens || 3,
        contatos: contatos.map((c) => ({
          telefone: c.telefone,
          nome: c.nome ?? "",
          empresa: c.empresa ?? "",
        })),
        instancia: camp.instancia_nome ?? "",
        token: camp.instancia_token ?? "",
        agendar_para: camp.agendada_para || null,
      });

      if (ok) {
        const { error } = await supabase
          .from("campanhas")
          .update({ status: "em_andamento" })
          .eq("id", id);
        if (error) {
          toast.error("Erro ao atualizar status da campanha: " + error.message);
        } else {
          toast.success("Campanha iniciada com sucesso!");
          load();
        }
      }
    } finally {
      setLoadingAcao(false);
    }
  };

  const load = async () => {
    const { data: c } = await supabase.from("campanhas").select("*").eq("id", id).single();
    setCamp(c);
    const { data: cs } = await supabase.from("contatos_campanha").select("*").eq("campanha_id", id);
    setContatos(cs ?? []);
    const { data: u } = await supabase.auth.getUser();
    if (u.user) {
      const { data } = await supabase.from("configuracoes").select("*").eq("usuario_id", u.user.id).maybeSingle();
      setCfg(data);
    }
  };

  useEffect(() => { load(); }, [id]);

  // Polling de status a cada 5s
  useEffect(() => {
    if (!cfg?.webhook_status || !camp || camp.status === "concluida" || camp.status === "aguardando" || camp.status === "agendada") return;
    const tick = async () => {
      const st = await buscarStatus(cfg.webhook_status, id);
      if (!st) return;
      await supabase.from("campanhas").update({
        status: st.status, enviadas: st.enviadas, entregues: st.entregues, erros: st.erros,
      }).eq("id", id);
      load();
    };
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, [cfg, camp?.status, id]);

  if (!camp) return <div className="p-8">Carregando…</div>;

  const acao = async (tipo: "pausar" | "retomar" | "cancelar") => {
    const url = cfg?.[`webhook_${tipo}`];
    if (!url) return toast.error(`Webhook de ${tipo} não configurado`);
    await chamarAcaoCampanha(url, id, tipo);
    toast.success(`Solicitação de ${tipo} enviada`);
  };

  const pct = camp.total_contatos > 0 ? (camp.enviadas / camp.total_contatos) * 100 : 0;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{camp.nome}</h1>
          <p className="text-sm text-muted-foreground">Status: <span className="font-medium">{camp.status}</span></p>
        </div>
        <div className="flex gap-2">
          {camp.status === "aguardando" && (
            <Button onClick={iniciarCampanha} disabled={loadingAcao}>
              {loadingAcao ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Iniciar Campanha
            </Button>
          )}
          
          {camp.status !== "aguardando" && camp.status !== "agendada" && (
            <>
              <Button variant="outline" onClick={() => acao("pausar")} disabled={loadingAcao}><Pause className="w-4 h-4 mr-2" />Pausar</Button>
              <Button variant="outline" onClick={() => acao("retomar")} disabled={loadingAcao}><Play className="w-4 h-4 mr-2" />Retomar</Button>
            </>
          )}
          
          <Button variant="outline" onClick={() => acao("cancelar")} disabled={loadingAcao}><X className="w-4 h-4 mr-2" />Cancelar</Button>
        </div>
      </div>

      <Card className="p-6 space-y-3">
        <div className="flex justify-between text-sm"><span>Progresso</span><span>{camp.enviadas}/{camp.total_contatos}</span></div>
        <Progress value={pct} />
      </Card>

      <div className="grid grid-cols-4 gap-4">
        {[
          { l: "Enviadas", v: camp.enviadas },
          { l: "Entregues", v: camp.entregues },
          { l: "Erros", v: camp.erros },
          { l: "Pendentes", v: camp.total_contatos - camp.enviadas },
        ].map((s) => (
          <Card key={s.l} className="p-5"><div className="text-sm text-muted-foreground">{s.l}</div><div className="text-2xl font-bold">{s.v}</div></Card>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground border-b"><tr><th className="px-6 py-3">Telefone</th><th>Nome</th><th>Status</th></tr></thead>
          <tbody>
            {contatos.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="px-6 py-3">{c.telefone}</td>
                <td>{c.nome || "—"}</td>
                <td><span className="px-2 py-0.5 rounded bg-muted text-xs">{c.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}