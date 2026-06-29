import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Mail, Lock, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

const SLIDES = [
  {
    img: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=1400&q=80",
    title: "Pizzas Irresistíveis",
    desc: "Recupere aquele cliente de pizza de domingo automaticamente com ofertas irresistíveis direto no WhatsApp.",
    tags: ["Mais pedidos", "Mais clientes", "Mais vendas"],
  },
  {
    img: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=1400&q=80",
    title: "Hambúrgueres Artesanais",
    desc: "Dispare promoções de fim de semana e lote sua hamburgueria toda sexta-feira com um único clique.",
    tags: ["Fidelização", "Retenção", "Crescimento"],
  },
  {
    img: "https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=1400&q=80",
    title: "Sushi & Japonesa",
    desc: "Comunique novidades do cardápio e combos exclusivos diretamente no WhatsApp dos seus clientes.",
    tags: ["Cardápio digital", "Combos", "Promoções"],
  },
  {
    img: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1400&q=80",
    title: "Churrascaria & Grill",
    desc: "Aumente o ticket médio com disparos segmentados antes do fim de semana para sua base de clientes.",
    tags: ["Ticket médio", "Engajamento", "WhatsApp"],
  },
];

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail]     = useState("");
  const [senha, setSenha]     = useState("");
  const [loading, setLoading] = useState(false);
  const [slide, setSlide]     = useState(0);

  useEffect(() => {
    const t = setInterval(() => setSlide((s) => (s + 1) % SLIDES.length), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Bem-vindo!");
    navigate({ to: "/dashboard", replace: true });
  };

  return (
    <div className="min-h-screen flex bg-background">

      {/* ── ESQUERDA: carrossel de imagens (oculto em mobile) ── */}
      <div className="hidden lg:block relative shrink-0" style={{ width: "65%" }}>

        {SLIDES.map((s, i) => (
          <div
            key={i}
            className={`absolute inset-0 transition-opacity duration-1000 ${
              i === slide ? "opacity-100" : "opacity-0"
            }`}
          >
            <img
              src={s.img}
              alt={s.title}
              className="w-full h-full object-cover"
              loading={i === 0 ? "eager" : "lazy"}
            />
          </div>
        ))}

        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/10 pointer-events-none" />

        <div className="absolute bottom-0 left-0 right-0 px-12 pb-12">
          <div className="flex gap-2 mb-6">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setSlide(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === slide ? "w-7 bg-primary" : "w-2 bg-white/35 hover:bg-white/60"
                }`}
              />
            ))}
          </div>

          <div className="relative h-44">
            {SLIDES.map((s, i) => (
              <div
                key={i}
                className={`absolute top-0 left-0 w-full transition-opacity duration-700 ${
                  i === slide ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
              >
                <h2 className="text-4xl font-bold text-white mb-3 leading-tight">{s.title}</h2>
                <p className="text-base text-white/75 mb-5 max-w-md leading-relaxed">{s.desc}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {s.tags.map((t, ti) => (
                    <span key={t} className="flex items-center gap-1.5">
                      {ti > 0 && <span className="text-white/30 text-sm">·</span>}
                      <span className="text-sm font-semibold text-white/80">{t}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── DIREITA: formulário de login ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">

          <div className="flex justify-center mb-8">
            <img src="/logo.png" alt="Chama AI Delivery" className="h-20 w-auto object-contain" />
          </div>

          <div className="mb-7 text-center">
            <h1 className="text-2xl font-bold">Dispare, venda e cresça.</h1>
            <p className="text-sm text-muted-foreground mt-1">Faça login abaixo com as suas credenciais</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                E-mail
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="email"
                  required
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Senha
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full gap-2 h-11 text-base rounded-xl"
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <><span>Entrar na Plataforma</span><ArrowRight className="w-4 h-4" /></>
              }
            </Button>
          </form>

        </div>
      </div>
    </div>
  );
}
