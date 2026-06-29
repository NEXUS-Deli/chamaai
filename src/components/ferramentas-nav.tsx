import { Link } from "@tanstack/react-router";
import { PhoneCall, ArrowDownToLine, Users, Ban } from "lucide-react";

const links = [
  { id: "verificador", label: "Verificador",        icon: PhoneCall,       to: "/ferramentas/verificador" },
  { id: "importador",  label: "Importador",         icon: ArrowDownToLine, to: "/ferramentas/importador" },
  { id: "extrator",    label: "Extrator de Grupos", icon: Users,           to: "/ferramentas/extrator" },
  { id: "blacklist",   label: "Lista de Bloqueio",  icon: Ban,             to: "/ferramentas/blacklist" },
] as const;

export type FerramentaId = (typeof links)[number]["id"];

export function FerramentasNav({ active }: { active: FerramentaId }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {links.map((link) => (
        <Link
          key={link.id}
          to={link.to}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
            active === link.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <link.icon className="w-4 h-4" />
          {link.label}
        </Link>
      ))}
    </div>
  );
}
