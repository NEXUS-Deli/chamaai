import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Users, LogOut, Flame, Menu, X, ChevronLeft, ChevronRight, Sun, Moon, Wrench, Clapperboard, FileText, Send, ShieldCheck, Bot } from "lucide-react";
import { type ReactNode, useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBranding } from "@/lib/branding";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notification-bell";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

const items = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/campanhas", label: "Disparo de Mensagem", icon: Send },
  { to: "/stories", label: "Stories do WhatsApp", icon: Clapperboard },
  { to: "/leads", label: "Clientes/Leads", icon: Users },
  { to: "/templates", label: "Templates", icon: FileText },
  { to: "/configuracoes", label: "Conexões", icon: WhatsAppIcon },
  { to: "/ferramentas/verificador", label: "Ferramentas", icon: Wrench },
];

// Atendimento com IA ainda está em desenvolvimento — visível só para admins
// (ver também o gate de acesso direto por URL em atendimento-ia.tsx)

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { branding } = useBranding();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: u }) => {
      if (!u.user) return;
      (supabase as any)
        .from("admins")
        .select("user_id")
        .eq("user_id", u.user.id)
        .maybeSingle()
        .then(({ data }: { data: unknown }) => setIsAdmin(!!data));
    });
  }, []);

  // Fecha o drawer ao mudar de rota no mobile
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Fecha o drawer ao redimensionar para desktop
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileOpen(false);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const NavLinks = ({ collapsed = false }: { collapsed?: boolean }) => (
    <nav className="flex-1 p-3 space-y-1">
      {items.map((item) => {
        const active =
          item.to === "/campanhas"
            ? pathname === "/campanhas" || (pathname.startsWith("/campanhas/") && !pathname.startsWith("/campanhas/nova"))
            : item.to === "/ferramentas/verificador"
            ? pathname.startsWith("/ferramentas")
            : pathname === item.to || pathname.startsWith(item.to + "/");
        return (
          <Link
            key={item.to}
            to={item.to}
            title={collapsed ? item.label : undefined}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              collapsed ? "justify-center px-2" : ""
            } ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent"
            }`}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}

      {isAdmin && (
        <Link
          to="/atendimento-ia"
          title={collapsed ? "Atendimento com IA" : undefined}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 mt-2 border-t border-sidebar-border pt-3 ${
            collapsed ? "justify-center px-2" : ""
          } ${
            pathname === "/atendimento-ia" || pathname.startsWith("/atendimento-ia/")
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent"
          }`}
        >
          <Bot className="w-4 h-4 shrink-0" />
          {!collapsed && <span className="truncate">Atendimento com IA</span>}
        </Link>
      )}

      {isAdmin && (
        <Link
          to="/admin"
          title={collapsed ? "Admin" : undefined}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
            collapsed ? "justify-center px-2" : ""
          } ${
            pathname === "/admin"
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent"
          }`}
        >
          <ShieldCheck className="w-4 h-4 shrink-0" />
          {!collapsed && <span className="truncate">Admin</span>}
        </Link>
      )}
    </nav>
  );

  return (
    <div className="h-screen flex bg-muted/30 overflow-hidden">

      {/* ── OVERLAY MOBILE ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── SIDEBAR MOBILE (drawer) ── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-64 bg-sidebar border-r border-sidebar-border flex flex-col
          transition-transform duration-300 ease-in-out
          md:hidden
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Header do drawer mobile */}
        <div className="h-20 flex items-center justify-between gap-2 px-4 border-b border-sidebar-border">
          <img src={branding.logo_url || "/logo.png"} alt={branding.nome_produto} className="h-14 w-auto object-contain max-w-[180px]" />
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => setMobileOpen(false)}
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <NavLinks collapsed={false} />

        <div className="p-3 border-t border-sidebar-border space-y-1">
          <NotificationBell collapsed={false} />
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={toggleTheme}>
            {theme === "dark" ? <Sun className="w-4 h-4 mr-2" /> : <Moon className="w-4 h-4 mr-2" />}
            {theme === "dark" ? "Modo claro" : "Modo escuro"}
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={logout}>
            <LogOut className="w-4 h-4 mr-2" />
            Sair
          </Button>
        </div>
      </aside>

      {/* ── SIDEBAR DESKTOP (colapsável) ── */}
      <aside
        className={`
          hidden md:flex flex-col shrink-0 bg-sidebar border-r border-sidebar-border
          transition-all duration-300 ease-in-out
          ${desktopCollapsed ? "w-16" : "w-60"}
        `}
      >
        {/* Header desktop */}
        <div className={`h-20 flex items-center border-b border-sidebar-border shrink-0 ${desktopCollapsed ? "justify-center px-2" : "justify-between px-4"}`}>
          {!desktopCollapsed && (
            <img src={branding.logo_url || "/logo.png"} alt={branding.nome_produto} className="h-14 w-auto object-contain max-w-[180px]" />
          )}
          {desktopCollapsed && (
            <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <Flame className="w-4 h-4" />
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={`shrink-0 ${desktopCollapsed ? "hidden" : ""}`}
            onClick={() => setDesktopCollapsed(true)}
            title="Recolher menu"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </div>

        <NavLinks collapsed={desktopCollapsed} />

        <div className="p-3 border-t border-sidebar-border flex flex-col gap-1">
          {desktopCollapsed ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="w-full"
                onClick={() => setDesktopCollapsed(false)}
                title="Expandir menu"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <NotificationBell collapsed={true} />
              <Button
                variant="ghost"
                size="icon"
                className="w-full"
                onClick={toggleTheme}
                title={theme === "dark" ? "Modo claro" : "Modo escuro"}
              >
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              <Button variant="ghost" size="icon" className="w-full" onClick={logout} title="Sair">
                <LogOut className="w-4 h-4" />
              </Button>
            </>
          ) : (
            <>
              <NotificationBell collapsed={false} />
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={toggleTheme}>
                {theme === "dark" ? <Sun className="w-4 h-4 mr-2" /> : <Moon className="w-4 h-4 mr-2" />}
                {theme === "dark" ? "Modo claro" : "Modo escuro"}
              </Button>
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={logout}>
                <LogOut className="w-4 h-4 mr-2" />
                Sair
              </Button>
            </>
          )}
        </div>
      </aside>

      {/* ── CONTEÚDO PRINCIPAL ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar mobile com botão de menu */}
        <header className="md:hidden h-14 flex items-center gap-3 px-4 bg-sidebar border-b border-sidebar-border shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </Button>
          <img src={branding.logo_url || "/logo.png"} alt={branding.nome_produto} className="h-10 w-auto object-contain max-w-[140px]" />
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}