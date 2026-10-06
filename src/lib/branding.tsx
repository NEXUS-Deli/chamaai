// Provider de white-label: aplica nome e logo em runtime.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Branding {
  nome_produto: string;
  cor_primaria: string;
  logo_url: string;
}

const defaults: Branding = {
  nome_produto: "Prospecta 360",
  cor_primaria: "#FF5C00",
  logo_url: "", // vazio = usa a logo padrão Prospecta 360 (BrandLogo)
};

// "/logo.png" era o padrão antigo (logo anterior) e pode estar salvo no cache do navegador
// "Chama AI Delivery" era o nome padrão antigo (default da coluna no banco)
const normalizarNome = (nome: string | null | undefined) =>
  nome && nome !== "Chama AI Delivery" ? nome : "Prospecta 360";

const normalizarLogo = (url: string | null | undefined) => (url && url !== "/logo.png" ? url : "");

const Ctx = createContext<{ branding: Branding; refresh: () => void }>({
  branding: defaults,
  refresh: () => {},
});

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(() => {
    if (typeof window === "undefined") return defaults;
    try {
      const cached = localStorage.getItem("chama:branding");
      if (!cached) return defaults;
      const parsed = JSON.parse(cached) as Partial<Branding>;
      return {
        ...defaults,
        ...parsed,
        nome_produto: normalizarNome(parsed.nome_produto),
        logo_url: normalizarLogo(parsed.logo_url),
      };
    } catch {
      return defaults;
    }
  });

  const apply = (b: Branding) => {
    if (typeof document === "undefined") return;
    // Cores vêm exclusivamente do tema (src/styles.css); cor_primaria não é mais aplicada.
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
        nome_produto: normalizarNome(data.nome_produto),
        cor_primaria: data.cor_primaria || defaults.cor_primaria,
        logo_url: normalizarLogo(data.logo_url),
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