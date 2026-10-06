import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { PhoneCall, ArrowDownToLine, Users, Ban } from "lucide-react";

const links = [
  {
    id: "verificador",
    label: "Verificador",
    icon: PhoneCall,
    to: "/ferramentas/verificador",
    desc: "Valide números de telefone para saber se possuem WhatsApp ativo.",
  },
  {
    id: "importador",
    label: "Importador",
    icon: ArrowDownToLine,
    to: "/ferramentas/importador",
    desc: "Importe os contatos do WhatsApp diretamente para uma pasta dentro do Prospecta 360.",
  },
  {
    id: "extrator",
    label: "Extrator de Grupos",
    icon: Users,
    to: "/ferramentas/extrator",
    desc: "Faça a extração de leads dos grupos do WhatsApp com o Prospecta 360.",
  },
  {
    id: "blacklist",
    label: "Lista de Bloqueio",
    icon: Ban,
    to: "/ferramentas/blacklist",
    desc: "Números bloqueados nunca receberão mensagens das suas campanhas.",
  },
] as const;

export type FerramentaId = (typeof links)[number]["id"];

export function FerramentasNav({ active }: { active: FerramentaId }) {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b">
      {links.map((link) => {
        const isActive = active === link.id;
        return (
          <Link
            key={link.id}
            to={link.to}
            className={`-mb-px flex items-center gap-2 px-3 py-2.5 border-b-2 text-sm font-medium whitespace-nowrap transition-colors ${
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border-strong"
            }`}
          >
            <link.icon className={`w-4 h-4 ${isActive ? "text-brand" : ""}`} />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Cabeçalho comum das páginas de Ferramentas: título, abas e descrição da ferramenta ativa. */
export function FerramentasHeader({ active, actions }: { active: FerramentaId; actions?: ReactNode }) {
  const current = links.find((l) => l.id === active);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Ferramentas Úteis</h1>
        <p className="text-sm text-muted-foreground">
          Verifique números de WhatsApp, Importe Contatos, Extraia Contatos de Grupos e Bloqueie números para evitar disparo
        </p>
      </div>
      <FerramentasNav active={active} />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">{current?.desc}</p>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
    </div>
  );
}
