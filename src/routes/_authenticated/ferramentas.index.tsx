import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { PhoneCall, ArrowDownToLine, Users, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ferramentas/")({
  component: FerramentasPage,
});

const tools = [
  {
    id: "verificador",
    to: "/ferramentas/verificador",
    icon: PhoneCall,
    title: "Verificador de WhatsApp",
    description: "Valide números de telefone para saber se possuem WhatsApp ativo.",
    tag: "Ativo",
    tagColor: "bg-green-100 text-green-700",
  },
  {
    id: "importador",
    to: "/ferramentas/importador",
    icon: ArrowDownToLine,
    title: "Importador de Contatos",
    description: "Importe os contatos do WhatsApp diretamente para uma pasta dentro da Chama AI.",
    tag: "Ativo",
    tagColor: "bg-green-100 text-green-700",
  },
  {
    id: "extrator",
    to: "/ferramentas/extrator",
    icon: Users,
    title: "Extrator de Grupos",
    description: "Faça a extração de leads dos grupos do WhatsApp com a Chama AI.",
    tag: "Ativo",
    tagColor: "bg-green-100 text-green-700",
  },
];

function FerramentasPage() {
  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Ferramentas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Utilitários para gerenciar e otimizar suas conexões WhatsApp.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((tool) => (
          <Link key={tool.id} to={tool.to}>
            <Card className="p-6 h-full flex flex-col gap-4 hover:border-primary/50 hover:shadow-sm transition-all group cursor-pointer">
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <tool.icon className="w-5 h-5 text-primary" />
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tool.tagColor}`}>
                  {tool.tag}
                </span>
              </div>
              <div className="flex-1 space-y-1">
                <h3 className="font-semibold text-sm">{tool.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{tool.description}</p>
              </div>
              <div className="flex items-center gap-1 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                Acessar <ArrowRight className="w-3 h-3" />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
