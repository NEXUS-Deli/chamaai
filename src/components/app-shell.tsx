import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Users, ListChecks, Settings, LogOut, Flame, Menu, X, ChevronLeft, ChevronRight, Sun, Moon } from "lucide-react";
import { type ReactNode, useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBranding } from "@/lib/branding";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";

const items = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/campanhas", label: "Campanhas", icon: ListChecks },
  { to: "/leads", label: "Clientes/Leads", icon: Users },
  { to: "/configuracoes", label: "Conexões", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { branding } = useBranding();

  // No mobile: controla o drawer (aberto/fechado)
  // No desktop: controla se a sidebar está expandida ou recolhida
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();

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
        <div className="h-16 flex items-center justify-between gap-2 px-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2 overflow-hidden">
            {branding.logo_url ? (
              <img src={branding.logo_url} alt="logo" className="w-8 h-8 rounded-lg object-cover shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                <Flame className="w-4 h-4" />
              </div>
            )}
            <span className="font-semibold truncate">{branding.nome_produto}</span>
          </div>
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
        <div className={`h-16 flex items-center border-b border-sidebar-border shrink-0 ${desktopCollapsed ? "justify-center px-2" : "justify-between px-4"}`}>
          {!desktopCollapsed && (
            <div className="flex items-center gap-2 overflow-hidden">
              {branding.logo_url ? (
                <img src={branding.logo_url} alt="logo" className="w-8 h-8 rounded-lg object-cover shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                  <Flame className="w-4 h-4" />
                </div>
              )}
              <span className="font-semibold truncate">{branding.nome_produto}</span>
            </div>
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
          <div className="flex items-center gap-2 overflow-hidden">
            {branding.logo_url ? (
              <img src={branding.logo_url} alt="logo" className="w-6 h-6 rounded object-cover" />
            ) : (
              <div className="w-6 h-6 rounded bg-primary text-primary-foreground flex items-center justify-center">
                <Flame className="w-3 h-3" />
              </div>
            )}
            <span className="font-semibold text-sm truncate">{branding.nome_produto}</span>
          </div>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}