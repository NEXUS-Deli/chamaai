import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/campanhas/")({
  component: CampanhasList,
});

function CampanhasList() {
  const queryClient = useQueryClient();
  const [campanhaToDelete, setCampanhaToDelete] = useState<string | null>(null);

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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("campanhas")
        .delete()
        .eq("id", id);
      
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success("Campanha excluída com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["campanhas"] });
      setCampanhaToDelete(null);
    },
    onError: (error: any) => {
      toast.error(`Erro ao excluir campanha: ${error.message}`);
      setCampanhaToDelete(null);
    },
  });

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Campanhas</h1>
          <p className="text-sm text-muted-foreground">Histórico de disparos</p>
        </div>
        <Link to="/campanhas/nova">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Nova campanha
          </Button>
        </Link>
      </div>
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead className="text-left text-muted-foreground border-b">
            <tr>
              <th className="px-4 sm:px-6 py-3">Nome</th>
              <th className="py-3">Status</th>
              <th className="py-3 hidden sm:table-cell">Contatos</th>
              <th className="py-3 hidden sm:table-cell">Enviadas</th>
              <th className="py-3">Data</th>
              <th className="text-right px-4 sm:px-6 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                <td className="px-4 sm:px-6 py-3 font-medium max-w-[150px] sm:max-w-none truncate">{c.nome}</td>
                <td className="py-3">
                  <span className="px-2 py-0.5 rounded bg-muted text-xs">
                    {c.status}
                  </span>
                </td>
                <td className="py-3 hidden sm:table-cell">{c.total_contatos}</td>
                <td className="py-3 hidden sm:table-cell">{c.enviadas}</td>
                <td className="py-3 whitespace-nowrap">{new Date(c.criada_em).toLocaleDateString("pt-BR")}</td>
                <td className="px-6 py-3">
                  <div className="flex items-center justify-end gap-3">
                    <Link
                      to="/campanhas/$id"
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
                      title="Excluir campanha"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!data?.length && (
              <tr>
                <td colSpan={6} className="p-12 text-center text-muted-foreground">
                  Sem campanhas ainda
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
            <AlertDialogTitle>Excluir Campanha</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza de que deseja excluir esta campanha? Essa ação removerá permanentemente a campanha e todos os seus contatos/históricos de disparo associados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() => {
                if (campanhaToDelete) {
                  deleteMutation.mutate(campanhaToDelete);
                }
              }}
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