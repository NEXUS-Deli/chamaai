import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff, ArrowUpRight } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { LEMBRAR_KEY, SESSAO_KEY } from "@/lib/lembrar-sessao";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

// Central de Vendas (WhatsApp) — contas são criadas pela equipe comercial
const WHATSAPP_VENDAS = "5543999572256";
const linkWhatsApp = (mensagem: string) =>
  `https://wa.me/${WHATSAPP_VENDAS}?text=${encodeURIComponent(mensagem)}`;

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [lembrar, setLembrar] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  const handleLogin = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setLoading(false);
    if (error) {
      return toast.error(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message);
    }
    // "Lembrar de mim" desmarcado: a sessão termina quando o navegador for fechado
    try {
      localStorage.setItem(LEMBRAR_KEY, lembrar ? "1" : "0");
      sessionStorage.setItem(SESSAO_KEY, "1");
    } catch { /* armazenamento indisponível: mantém o comportamento padrão */ }
    toast.success("Bem-vindo!");
    navigate({ to: "/dashboard", replace: true });
  };

  return (
    <div className="min-h-screen bg-surface p-3 sm:p-8 lg:p-12 flex">
      <div className="flex-1 flex flex-col bg-card rounded-xl border shadow-sm overflow-hidden">
        {/* Barra superior com a logo */}
        <header className="h-16 sm:h-20 px-6 sm:px-10 flex items-center border-b shrink-0">
          <BrandLogo className="h-8 sm:h-9 w-auto max-w-[180px]" />
        </header>

        {/* Formulário centralizado */}
        <main className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">
            <h1 className="text-2xl font-bold">Login</h1>
            <p className="text-sm text-muted-foreground">Olá, bem-vindo de volta 👋</p>

            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium">E-mail</label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="Ex.: voce@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="senha" className="text-sm font-medium">Senha</label>
                <div className="relative">
                  <Input
                    id="senha"
                    type={mostrarSenha ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    placeholder="Digite sua senha"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarSenha((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-foreground"
                    aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {mostrarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <Checkbox checked={lembrar} onCheckedChange={(v) => setLembrar(v === true)} />
                  Lembrar de mim
                </label>
                <a
                  href={linkWhatsApp("Olá! Esqueci minha senha do Prospecta 360. Pode me ajudar?")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-brand hover:underline"
                >
                  Esqueceu a senha?
                </a>
              </div>

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entrar"}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground mt-6">
              Ainda não tem uma conta?{" "}
              <a
                href={linkWhatsApp("Olá! Quero contratar o Prospecta 360.")}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline"
              >
                Criar uma conta <ArrowUpRight className="w-4 h-4" />
              </a>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
