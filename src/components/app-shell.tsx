import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Users, Send, ListChecks, Settings, LogOut, Flame } from "lucide-react";
import { type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBranding } from "@/lib/branding";
import { Button } from "@/components/ui/button";

const items = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/leads", label: "Meus Leads", icon: Users },
  { to: "/campanhas/nova", label: "Nova Campanha", icon: Send },
  { to: "/campanhas", label: "Campanhas", icon: ListChecks },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { branding } = useBranding();

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="h-screen flex bg-muted/30 overflow-hidden">
      <aside className="w-60 bg-sidebar border-r border-sidebar-border flex flex-col shrink-0">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-sidebar-border">
          {branding.logo_url ? (
            <img src={branding.logo_url} alt="logo" className="w-8 h-8 rounded-lg object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <Flame className="w-4 h-4" />
            </div>
          )}
          <span className="font-semibold truncate">{branding.nome_produto}</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {items.map((item) => {
            const active =
              item.to === "/campanhas"
                ? pathname === "/campanhas" || pathname.startsWith("/campanhas/") && !pathname.startsWith("/campanhas/nova")
                : pathname === item.to || pathname.startsWith(item.to + "/");
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={logout}>
            <LogOut className="w-4 h-4 mr-2" />
            Sair
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}