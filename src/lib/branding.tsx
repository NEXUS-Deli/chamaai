// Provider de white-label: aplica cor primária, nome e logo em runtime.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Branding {
  nome_produto: string;
  cor_primaria: string;
  logo_url: string;
}

const defaults: Branding = {
  nome_produto: "Chama AI Delivery",
  cor_primaria: "#FF5C00",
  logo_url: "",
};

const Ctx = createContext<{ branding: Branding; refresh: () => void }>({
  branding: defaults,
  refresh: () => {},
});

function hexToOklch(hex: string): string {
  // Converte hex aprox para oklch via canvas color parsing (fallback simples)
  try {
    const m = hex.replace("#", "");
    if (m.length !== 6) return "oklch(0.68 0.22 40)";
    const r = parseInt(m.slice(0, 2), 16) / 255;
    const g = parseInt(m.slice(2, 4), 16) / 255;
    const b = parseInt(m.slice(4, 6), 16) / 255;
    // Aproximação: usa valor original via color-mix com black/white não dá controle ok.
    // Definimos --primary direto em rgb que oklch entende como cor; usamos `color` rgb.
    return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
  } catch {
    return "oklch(0.68 0.22 40)";
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(() => {
    if (typeof window === "undefined") return defaults;
    try {
      const cached = localStorage.getItem("chama:branding");
      return cached ? { ...defaults, ...JSON.parse(cached) } : defaults;
    } catch {
      return defaults;
    }
  });

  const apply = (b: Branding) => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--primary", hexToOklch(b.cor_primaria));
    document.documentElement.style.setProperty("--ring", hexToOklch(b.cor_primaria));
    document.documentElement.style.setProperty("--sidebar-primary", hexToOklch(b.cor_primaria));
    if (b.nome_produto) document.title = b.nome_produto;
  };

  const refresh = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data } = await supabase
      .from("configuracoes")
      .select("nome_produto,cor_primaria,logo_url")
      .eq("usuario_id", u.user.id)
      .maybeSingle();
    if (data) {
      const next = {
        nome_produto: data.nome_produto || defaults.nome_produto,
        cor_primaria: data.cor_primaria || defaults.cor_primaria,
        logo_url: data.logo_url || "",
      };
      setBranding(next);
      try {
        localStorage.setItem("chama:branding", JSON.stringify(next));
      } catch {
        /* noop */
      }
      apply(next);
    }
  };

  useEffect(() => {
    apply(branding);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Ctx.Provider value={{ branding, refresh }}>{children}</Ctx.Provider>;
}

export function useBranding() {
  return useContext(Ctx);
}