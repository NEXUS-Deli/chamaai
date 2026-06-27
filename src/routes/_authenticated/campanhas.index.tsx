import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/campanhas/")({
  component: CampanhasList,
});

function CampanhasList() {
  const { data } = useQuery({
    queryKey: ["campanhas"],
    queryFn: async () => {
      const { data } = await supabase
        .from("campanhas")
        .select("id,nome,status,total_contatos,enviadas,criada_em")
        .order("criada_em", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Campanhas</h1>
          <p className="text-sm text-muted-foreground">Histórico de disparos</p>
        </div>
        <Link to="/campanhas/nova"><Button><Plus className="w-4 h-4 mr-2" />Nova campanha</Button></Link>
      </div>
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground border-b">
            <tr><th className="px-6 py-3">Nome</th><th>Status</th><th>Contatos</th><th>Enviadas</th><th>Data</th><th></th></tr>
          </thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="px-6 py-3 font-medium">{c.nome}</td>
                <td><span className="px-2 py-0.5 rounded bg-muted text-xs">{c.status}</span></td>
                <td>{c.total_contatos}</td>
                <td>{c.enviadas}</td>
                <td>{new Date(c.criada_em).toLocaleDateString("pt-BR")}</td>
                <td><Link to="/campanhas/$id" params={{ id: c.id }} className="text-primary">Ver</Link></td>
              </tr>
            ))}
            {!data?.length && <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">Sem campanhas ainda</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}