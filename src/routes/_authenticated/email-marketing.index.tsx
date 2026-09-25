import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Mail } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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

export const Route = createFileRoute("/_authenticated/email-marketing/")({
  component: EmailMarketingList,
});

const STATUS_LABEL: Record<string, string> = {
  aguardando: "Aguardando",
  agendada: "Agendada",
  em_andamento: "Em andamento",
  pausada: "Pausada",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

const STATUS_COLOR: Record<string, string> = {
  aguardando: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  agendada: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  em_andamento: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  pausada: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  concluida: "bg-muted text-muted-foreground",
  cancelada: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

function EmailMarketingList() {
  const queryClient = useQueryClient();
  const [campanhaToDelete, setCampanhaToDelete] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["email-campanhas"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data } = await supabase
        .from("campanhas")
        .select("id,nome,status,total_contatos,enviadas,erros,criada_em")
        .eq("usuario_id", u.user.id)
        .eq("tipo_campanha", "EMAIL")
        .order("criada_em", { ascending: false });
      return data ?? [];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("campanhas").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Campanha excluída com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["email-campanhas"] });
      setCampanhaToDelete(null);
    },
    onError: (error: Error) => {
      toast.error(`Erro ao excluir: ${error.message}`);
      setCampanhaToDelete(null);
    },
  });

  return (
    <div className="p-8 w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="w-6 h-6 text-primary" />
            E-mail Marketing
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie seus disparos de e-mail em massa
          </p>
        </div>
        <Link to="/email-marketing/nova">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Nova campanha
          </Button>
        </Link>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead className="text-left text-muted-foreground border-b bg-muted/30">
              <tr>
                <th className="px-4 sm:px-6 py-3">Nome</th>
                <th className="py-3">Status</th>
                <th className="py-3 hidden sm:table-cell">Contatos</th>
                <th className="py-3 hidden sm:table-cell">Enviadas</th>
                <th className="py-3 hidden sm:table-cell">Erros</th>
                <th className="py-3">Data</th>
                <th className="text-right px-4 sm:px-6 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-muted-foreground">
                    Carregando campanhas...
                  </td>
                </tr>
              )}
              {!isLoading && (data ?? []).map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                  <td className="px-4 sm:px-6 py-3 font-medium max-w-[160px] truncate">{c.nome}</td>
                  <td className="py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[c.status] ?? "bg-muted"}`}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="py-3 hidden sm:table-cell">{c.total_contatos ?? 0}</td>
                  <td className="py-3 hidden sm:table-cell">{c.enviadas ?? 0}</td>
                  <td className="py-3 hidden sm:table-cell text-destructive">{c.erros ?? 0}</td>
                  <td className="py-3 whitespace-nowrap text-muted-foreground text-xs">
                    {new Date(c.criada_em).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-4 sm:px-6 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        to="/email-marketing/$id"
                        params={{ id: c.id }}
                        className="text-primary hover:underline text-sm font-medium"
                      >
                        Ver
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setCampanhaToDelete(c.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && !data?.length && (
                <tr>
                  <td colSpan={7} className="p-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Mail className="w-10 h-10 opacity-30" />
                      <p className="font-medium">Nenhuma campanha de e-mail criada ainda</p>
                      <p className="text-sm">Clique em "Nova campanha" para começar.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <AlertDialog
        open={!!campanhaToDelete}
        onOpenChange={(open) => !open && setCampanhaToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Campanha de E-mail</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza? Esta ação irá excluir permanentemente a campanha e todos os seus registros de envio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() => { if (campanhaToDelete) deleteMutation.mutate(campanhaToDelete); }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
