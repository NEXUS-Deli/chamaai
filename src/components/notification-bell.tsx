import { useState, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Bell, CheckCheck, Info, CheckCircle2, XCircle, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Notificacao {
  id: string;
  titulo: string;
  mensagem: string | null;
  tipo: "info" | "sucesso" | "erro" | "aviso";
  lida: boolean;
  link: string | null;
  criado_em: string;
}

const TIPO_CONFIG = {
  info:    { icon: Info,         color: "text-blue-500",  bg: "bg-blue-50 dark:bg-blue-950/30" },
  sucesso: { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-50 dark:bg-green-950/30" },
  erro:    { icon: XCircle,      color: "text-destructive", bg: "bg-red-50 dark:bg-red-950/30" },
  aviso:   { icon: AlertTriangle, color: "text-yellow-500", bg: "bg-yellow-50 dark:bg-yellow-950/30" },
};

export function NotificationBell({ collapsed = false }: { collapsed?: boolean }) {
  const [notifs, setNotifs] = useState<Notificacao[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data } = await (supabase as any)
      .from("notificacoes")
      .select("id,titulo,mensagem,tipo,lida,link,criado_em")
      .eq("usuario_id", u.user.id)
      .order("criado_em", { ascending: false })
      .limit(30);
    setNotifs((data ?? []) as Notificacao[]);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const naoLidas = notifs.filter((n) => !n.lida).length;

  const marcarTodasLidas = async () => {
    const ids = notifs.filter((n) => !n.lida).map((n) => n.id);
    if (!ids.length) return;
    await (supabase as any).from("notificacoes").update({ lida: true }).in("id", ids);
    setNotifs((prev) => prev.map((n) => ({ ...n, lida: true })));
  };

  const marcarLida = async (id: string) => {
    await (supabase as any).from("notificacoes").update({ lida: true }).eq("id", id);
    setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, lida: true } : n));
  };

  const excluir = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await (supabase as any).from("notificacoes").delete().eq("id", id);
    setNotifs((prev) => prev.filter((n) => n.id !== id));
  };

  const clicarNotif = (n: Notificacao) => {
    marcarLida(n.id);
    if (n.link) {
      setOpen(false);
      navigate({ to: n.link as any });
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Notificações"
        className={`relative flex items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent text-sidebar-foreground ${
          collapsed ? "w-10 h-10" : "w-full h-9 gap-3 px-3"
        }`}
      >
        <div className="relative shrink-0">
          <Bell className="w-4 h-4" />
          {naoLidas > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-destructive text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
              {naoLidas > 9 ? "9+" : naoLidas}
            </span>
          )}
        </div>
        {!collapsed && <span className="text-sm font-medium flex-1 text-left">Notificações</span>}
        {!collapsed && naoLidas > 0 && (
          <span className="text-xs font-semibold bg-destructive text-white rounded-full px-1.5 py-0.5 leading-none">
            {naoLidas}
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute z-50 bg-card border rounded-xl shadow-xl w-80 max-h-[480px] flex flex-col ${
          collapsed ? "left-12 bottom-0" : "left-full ml-2 bottom-0"
        }`}>
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <span className="text-sm font-semibold">Notificações</span>
            <div className="flex items-center gap-1">
              {naoLidas > 0 && (
                <Button variant="ghost" size="sm" onClick={marcarTodasLidas} className="h-7 text-xs gap-1">
                  <CheckCheck className="w-3 h-3" /> Marcar todas lidas
                </Button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {notifs.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-20" />
                Nenhuma notificação
              </div>
            ) : (
              notifs.map((n) => {
                const cfg = TIPO_CONFIG[n.tipo] ?? TIPO_CONFIG.info;
                const Icon = cfg.icon;
                return (
                  <div
                    key={n.id}
                    onClick={() => clicarNotif(n)}
                    className={`flex items-start gap-3 px-4 py-3 border-b last:border-0 cursor-pointer transition-colors hover:bg-muted/30 ${
                      !n.lida ? cfg.bg : ""
                    }`}
                  >
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.color}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm leading-snug ${!n.lida ? "font-semibold" : ""}`}>{n.titulo}</p>
                      {n.mensagem && (
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{n.mensagem}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(n.criado_em).toLocaleString("pt-BR", {
                          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <button
                      onClick={(e) => excluir(n.id, e)}
                      className="shrink-0 opacity-0 hover:opacity-100 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                      title="Remover"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
