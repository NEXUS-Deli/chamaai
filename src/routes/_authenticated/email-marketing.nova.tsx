import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Mail,
  Upload,
  Loader2,
  ArrowLeft,
  Clock,
  Users,
  FileText,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/email-marketing/nova")({
  component: NovaEmailCampanha,
});

interface EmailCredential {
  id: string;
  from_name: string;
  from_email: string;
  host: string;
}

interface EmailTemplate {
  id: string;
  nome: string;
  assunto: string;
  conteudo_html: string;
}

function NovaEmailCampanha() {
  const navigate = useNavigate();

  const [nome, setNome] = useState("");
  const [assunto, setAssunto] = useState("");
  const [conteudoHtml, setConteudoHtml] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [delayMin, setDelayMin] = useState("30");
  const [delayMax, setDelayMax] = useState("60");
  const [horarioInicio, setHorarioInicio] = useState("08:00");
  const [horarioFim, setHorarioFim] = useState("22:00");
  const [agendadaPara, setAgendadaPara] = useState("");
  const [contatos, setContatos] = useState<{ email: string; nome?: string }[]>([]);
  const [csvText, setCsvText] = useState("");
  const [saving, setSaving] = useState(false);
  const [credentials, setCredentials] = useState<EmailCredential[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    fetchCredentials();
    fetchTemplates();
  }, []);

  const fetchCredentials = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data } = await supabase
      .from("email_credentials")
      .select("id, from_name, from_email, host")
      .eq("usuario_id", u.user.id);
    setCredentials(data || []);
  };

  const fetchTemplates = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data } = await supabase
      .from("email_templates")
      .select("id, nome, assunto, conteudo_html")
      .eq("usuario_id", u.user.id);
    setTemplates(data || []);
  };

  const handleTemplateSelect = (tid: string) => {
    setTemplateId(tid);
    const t = templates.find((t) => t.id === tid);
    if (t) {
      setAssunto(t.assunto);
      setConteudoHtml(t.conteudo_html);
    }
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
      parseCsv(text);
    };
    reader.readAsText(file);
  };

  const parseCsv = (text: string) => {
    const lines = text.trim().split("\n").slice(1); // skip header
    const parsed: { email: string; nome?: string }[] = [];
    for (const line of lines) {
      const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const email = cols[0];
      if (email && email.includes("@")) {
        parsed.push({ email, nome: cols[1] || undefined });
      }
    }
    setContatos(parsed);
    toast.success(`${parsed.length} contatos carregados`);
  };

  const handlePasteEmails = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCsvText(e.target.value);
    const lines = e.target.value.trim().split("\n");
    const parsed: { email: string; nome?: string }[] = [];
    for (const line of lines) {
      const email = line.trim().split(",")[0].trim();
      if (email && email.includes("@")) {
        parsed.push({ email });
      }
    }
    setContatos(parsed);
  };

  const handleSalvar = async () => {
    if (!nome.trim()) return toast.error("Informe o nome da campanha.");
    if (!credentialId) return toast.error("Selecione uma credencial de e-mail.");
    if (!assunto.trim()) return toast.error("Informe o assunto do e-mail.");
    if (!conteudoHtml.trim()) return toast.error("Escreva o conteúdo do e-mail.");
    if (contatos.length === 0) return toast.error("Importe ao menos um contato.");

    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Usuário não autenticado");

      const { data: camp, error: campError } = await supabase
        .from("campanhas")
        .insert({
          usuario_id: u.user.id,
          nome: nome.trim(),
          mensagem: assunto.trim(),
          tipo_campanha: "EMAIL",
          email_credential_id: credentialId,
          email_assunto: assunto.trim(),
          email_conteudo_html: conteudoHtml,
          delay_minimo: parseInt(delayMin),
          delay_maximo: parseInt(delayMax),
          delay_segundos: parseInt(delayMin),
          horario_inicio: horarioInicio,
          horario_fim: horarioFim,
          agendada_para: agendadaPara || null,
          total_contatos: contatos.length,
          status: agendadaPara ? "agendada" : "aguardando",
        })
        .select()
        .single();

      if (campError) throw campError;

      // Inserir contatos em lotes
      const BATCH = 200;
      for (let i = 0; i < contatos.length; i += BATCH) {
        const chunk = contatos.slice(i, i + BATCH).map((c) => ({
          campanha_id: camp.id,
          telefone: c.email, // reutilizamos o campo telefone para armazenar o email do contato
          nome: c.nome || null,
          status: "pendente",
        }));
        const { error } = await supabase.from("contatos_campanha").insert(chunk);
        if (error) throw error;
      }

      toast.success("Campanha criada com sucesso!");
      navigate({ to: "/email-marketing/$id", params: { id: camp.id } });
    } catch (err: unknown) {
      toast.error("Erro: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nova Campanha de E-mail</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure e dispare sua campanha de e-mail marketing</p>
      </div>

      {/* Credencial */}
      <Card className="p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4 text-primary" />
          Credencial de Envio
        </h2>
        {credentials.length === 0 ? (
          <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-4">
            Nenhuma credencial SMTP configurada. Acesse{" "}
            <a href="/configuracoes" className="text-primary underline">
              Conexões
            </a>{" "}
            e adicione uma credencial de e-mail primeiro.
          </div>
        ) : (
          <Select onValueChange={setCredentialId} value={credentialId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione a conta de envio..." />
            </SelectTrigger>
            <SelectContent>
              {credentials.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.from_name} — {c.from_email} ({c.host})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Card>

      {/* Nome da campanha */}
      <Card className="p-5 space-y-4">
        <h2 className="font-semibold">Identificação</h2>
        <div className="space-y-1">
          <Label>Nome da Campanha</Label>
          <Input
            placeholder="Ex: Promoção de Setembro"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </div>
      </Card>

      {/* Template + Conteúdo */}
      <Card className="p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          Conteúdo do E-mail
        </h2>

        {templates.length > 0 && (
          <div className="space-y-1">
            <Label>Usar Template Salvo (opcional)</Label>
            <Select onValueChange={handleTemplateSelect} value={templateId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um template para pré-preencher..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1">
          <Label>Assunto do E-mail *</Label>
          <Input
            placeholder="Ex: 🔥 Promoção imperdível para você!"
            value={assunto}
            onChange={(e) => setAssunto(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label>Conteúdo (HTML ou Texto) *</Label>
          <textarea
            className="w-full min-h-[220px] p-3 rounded-md border bg-background text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder={'<h1>Olá {{nome}}!</h1>\n<p>Temos uma oferta especial para você.</p>'}
            value={conteudoHtml}
            onChange={(e) => setConteudoHtml(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Use <code className="bg-muted px-1 rounded">{"{{nome}}"}</code> para personalizar com o nome do contato.
          </p>
        </div>

        {conteudoHtml && (
          <div>
            <button
              className="flex items-center gap-1 text-xs text-primary font-medium"
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showPreview ? "Ocultar pré-visualização" : "Pré-visualizar e-mail"}
            </button>
            {showPreview && (
              <div
                className="mt-3 p-4 border rounded-lg bg-white text-black text-sm max-h-80 overflow-auto"
                dangerouslySetInnerHTML={{ __html: conteudoHtml }}
              />
            )}
          </div>
        )}
      </Card>

      {/* Contatos */}
      <Card className="p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          Contatos ({contatos.length} carregados)
        </h2>

        <div className="space-y-1">
          <Label>Importar via CSV</Label>
          <p className="text-xs text-muted-foreground">
            O arquivo deve ter as colunas: <code className="bg-muted px-1 rounded">email,nome</code> (a primeira linha é o cabeçalho).
          </p>
          <div className="flex items-center gap-3">
            <label className="cursor-pointer flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed bg-muted/50 hover:bg-muted text-sm text-muted-foreground transition-colors">
              <Upload className="w-4 h-4" />
              Escolher arquivo CSV
              <input type="file" accept=".csv,.txt" className="hidden" onChange={handleCSVUpload} />
            </label>
          </div>
        </div>

        <div className="space-y-1">
          <Label>Ou cole os e-mails (um por linha)</Label>
          <textarea
            className="w-full min-h-[100px] p-3 rounded-md border bg-background text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder={"contato@empresa.com,João\ncliente@email.com,Maria"}
            value={csvText}
            onChange={handlePasteEmails}
          />
        </div>

        {contatos.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-lg">
            <Users className="w-4 h-4" />
            <span className="font-medium">{contatos.length} e-mails prontos para envio</span>
            <button onClick={() => { setContatos([]); setCsvText(""); }}>
              <X className="w-4 h-4 ml-auto text-muted-foreground hover:text-foreground" />
            </button>
          </div>
        )}
      </Card>

      {/* Configurações de disparo */}
      <Card className="p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          Configurações de Disparo
        </h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Delay mínimo entre envios (s)</Label>
            <Input type="number" min="5" value={delayMin} onChange={(e) => setDelayMin(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Delay máximo entre envios (s)</Label>
            <Input type="number" min="5" value={delayMax} onChange={(e) => setDelayMax(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Horário de início</Label>
            <Input type="time" value={horarioInicio} onChange={(e) => setHorarioInicio(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Horário de fim</Label>
            <Input type="time" value={horarioFim} onChange={(e) => setHorarioFim(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Agendar para (opcional)</Label>
          <Input
            type="datetime-local"
            value={agendadaPara}
            onChange={(e) => setAgendadaPara(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Deixe em branco para salvar como "Aguardando" e iniciar manualmente.
          </p>
        </div>
      </Card>

      <div className="flex gap-3 justify-end pb-8">
        <Button variant="outline" onClick={() => navigate({ to: "/email-marketing" })}>
          Cancelar
        </Button>
        <Button onClick={handleSalvar} disabled={saving} className="min-w-[160px]">
          {saving ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Mail className="w-4 h-4 mr-2" />
          )}
          {saving ? "Criando..." : "Criar Campanha"}
        </Button>
      </div>
    </div>
  );
}
