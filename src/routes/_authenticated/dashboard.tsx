import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Link } from "@tanstack/react-router";
import { Send, MessageSquare, CheckCircle2, Activity } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const { data: camps } = await supabase
        .from("campanhas")
        .select("id,nome,status,total_contatos,enviadas,entregues,criada_em")
        .order("criada_em", { ascending: false });
      const list = camps ?? [];
      const total = list.length;
      const enviadas = list.reduce((a, c) => a + (c.enviadas ?? 0), 0);
      const entregues = list.reduce((a, c) => a + (c.entregues ?? 0), 0);
      const ativas = list.filter((c) => c.status === "em_andamento").length;
      const taxa = enviadas > 0 ? Math.round((entregues / enviadas) * 100) : 0;
      return { total, enviadas, taxa, ativas, recentes: list.slice(0, 5) };
    },
  });

  const stats = [
    { label: "Campanhas criadas", value: data?.total ?? 0, icon: Send },
    { label: "Mensagens enviadas", value: data?.enviadas ?? 0, icon: MessageSquare },
    { label: "Taxa de entrega", value: `${data?.taxa ?? 0}%`, icon: CheckCircle2 },
    { label: "Ativas agora", value: data?.ativas ?? 0, icon: Activity },
  ];

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral das suas campanhas</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">{s.label}</span>
              <s.icon className="w-4 h-4 text-primary" />
            </div>
            <div className="text-3xl font-bold">{s.value}</div>
          </Card>
        ))}
      </div>
      <Card className="p-6">
        <h2 className="font-semibold mb-4">Últimas campanhas</h2>
        {!data?.recentes.length ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            Nenhuma campanha ainda. <Link to="/campanhas/nova" className="text-primary underline">Criar a primeira</Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="py-2">Nome</th><th>Status</th><th>Contatos</th><th>Data</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.recentes.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-3 font-medium">{c.nome}</td>
                  <td><span className="px-2 py-0.5 rounded bg-muted text-xs">{c.status}</span></td>
                  <td>{c.total_contatos}</td>
                  <td>{new Date(c.criada_em).toLocaleDateString("pt-BR")}</td>
                  <td><Link to="/campanhas/$id" params={{ id: c.id }} className="text-primary text-sm">Ver</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}