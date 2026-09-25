import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Trash2, Plus, Mail, Loader2, Save, CheckCircle2, Pencil } from "lucide-react";
import { toast } from "sonner";

interface EmailCredential {
  id: string;
  host: string;
  port: number;
  username: string;
  from_name: string;
  from_email: string;
  encryption: string | null;
}

export function EmailCredentialsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [credentials, setCredentials] = useState<EmailCredential[]>([]);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    host: "",
    port: "465",
    username: "",
    password: "",
    from_name: "",
    from_email: "",
    encryption: "ssl",
  });

  useEffect(() => {
    if (isOpen) {
      fetchCredentials();
    }
  }, [isOpen]);

  const fetchCredentials = async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    const { data, error } = await supabase
      .from("email_credentials")
      .select("id, host, port, username, from_name, from_email, encryption")
      .eq("usuario_id", u.user.id);

    if (error) {
      toast.error("Erro ao carregar credenciais: " + error.message);
    } else {
      setCredentials(data || []);
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta credencial?")) return;
    setLoading(true);
    const { error } = await supabase.from("email_credentials").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir: " + error.message);
    } else {
      toast.success("Credencial excluída!");
      setCredentials(credentials.filter(c => c.id !== id));
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!formData.host || !formData.port || !formData.username || !formData.password || !formData.from_email || !formData.from_name) {
      return toast.error("Preencha todos os campos obrigatórios.");
    }
    
    if (editingId) {
      setLoading(true);
      const { data, error } = await supabase
        .from("email_credentials")
        .update({
          host: formData.host.trim(),
          port: parseInt(formData.port),
          username: formData.username.trim(),
          password: formData.password,
          from_name: formData.from_name.trim(),
          from_email: formData.from_email.trim(),
          encryption: formData.encryption,
          atualizado_em: new Date().toISOString(),
        })
        .eq("id", editingId)
        .select("id, host, port, username, from_name, from_email, encryption")
        .single();

      if (error) {
        toast.error("Erro ao atualizar: " + error.message);
      } else if (data) {
        toast.success("Credencial atualizada com sucesso!");
        setCredentials(credentials.map(c => c.id === editingId ? data : c));
        setAdding(false);
        setEditingId(null);
        setFormData({
          host: "",
          port: "465",
          username: "",
          password: "",
          from_name: "",
          from_email: "",
          encryption: "ssl",
        });
      }
      setLoading(false);
      return;
    }

    if (credentials.length >= 10) {
      return toast.error("Você atingiu o limite máximo de 10 credenciais de e-mail.");
    }

    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    const { data, error } = await supabase
      .from("email_credentials")
      .insert({
        usuario_id: u.user.id,
        host: formData.host.trim(),
        port: parseInt(formData.port),
        username: formData.username.trim(),
        password: formData.password,
        from_name: formData.from_name.trim(),
        from_email: formData.from_email.trim(),
        encryption: formData.encryption,
      })
      .select("id, host, port, username, from_name, from_email, encryption")
      .single();

    if (error) {
      toast.error("Erro ao salvar: " + error.message);
    } else if (data) {
      toast.success("Credencial de e-mail salva com sucesso!");
      setCredentials([...credentials, data]);
      setAdding(false);
      setEditingId(null);
      setFormData({
        host: "",
        port: "465",
        username: "",
        password: "",
        from_name: "",
        from_email: "",
        encryption: "ssl",
      });
    }
    setLoading(false);
  };

  const handleEdit = async (cred: EmailCredential) => {
    // Busca a senha atual salva para preencher o formulário de edição
    setLoading(true);
    const { data } = await supabase
      .from("email_credentials")
      .select("password")
      .eq("id", cred.id)
      .single();
    setFormData({
      host: cred.host,
      port: String(cred.port),
      username: cred.username,
      password: data?.password ?? "",
      from_name: cred.from_name,
      from_email: cred.from_email,
      encryption: cred.encryption ?? "ssl",
    });
    setEditingId(cred.id);
    setAdding(true);
    setLoading(false);
  };

  const handleTestarConexao = async (dados: {
    host: string;
    port: string | number;
    username: string;
    password?: string;
    encryption?: string | null;
  }) => {
    if (!dados.host || !dados.username || !dados.password) {
      toast.error("Preencha o servidor, usuário e senha para testar a conexão.");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch("https://jaoxormsyftctpsegtza.supabase.co/functions/v1/testar-smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: dados.host.trim(),
          port: Number(dados.port),
          username: dados.username.trim(),
          password: dados.password,
          encryption: dados.encryption,
        }),
      });
      const result = await res.json();
      if (result.ok) {
        toast.success(result.message || "Conexão SMTP validada com sucesso!");
      } else {
        toast.error(result.error || "Falha na conexão SMTP.");
      }
    } catch (err: unknown) {
      toast.error("Erro ao testar: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />
            Credenciais de E-mail (SMTP)
          </DialogTitle>
          <DialogDescription>
            Configure seus servidores SMTP para realizar envios de E-mail Marketing. Limite de 10 credenciais.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!adding && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">{credentials.length}/10 credenciais configuradas</span>
              <Button onClick={() => setAdding(true)} disabled={credentials.length >= 10} size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Nova Credencial
              </Button>
            </div>
          )}

          {adding && (
            <Card className="p-4 border-primary bg-primary/5 space-y-4">
              <h3 className="font-semibold text-sm">
                {editingId ? "Editar credencial" : "Adicionar nova credencial"}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs">Servidor SMTP (Host)</label>
                  <Input 
                    placeholder="ex: smtp.gmail.com" 
                    value={formData.host}
                    onChange={(e) => setFormData({...formData, host: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs">Porta</label>
                  <Input 
                    type="number" 
                    placeholder="465" 
                    value={formData.port}
                    onChange={(e) => setFormData({...formData, port: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs">Nome do Remetente</label>
                  <Input 
                    placeholder="ex: Minha Empresa" 
                    value={formData.from_name}
                    onChange={(e) => setFormData({...formData, from_name: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs">E-mail do Remetente</label>
                  <Input 
                    type="email" 
                    placeholder="ex: contato@empresa.com" 
                    value={formData.from_email}
                    onChange={(e) => setFormData({...formData, from_email: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs">Usuário SMTP</label>
                  <Input 
                    placeholder="ex: contato@empresa.com" 
                    value={formData.username}
                    onChange={(e) => setFormData({...formData, username: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs">Senha SMTP</label>
                  <Input 
                    type="password" 
                    placeholder="********" 
                    value={formData.password}
                    onChange={(e) => setFormData({...formData, password: e.target.value})}
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-between items-center pt-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleTestarConexao(formData)} 
                  disabled={testing || loading}
                >
                  {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" />}
                  {testing ? "Testando..." : "Testar Conexão"}
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setEditingId(null); }}>Cancelar</Button>
                  <Button size="sm" onClick={handleSave} disabled={loading || testing}>
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    {editingId ? "Atualizar" : "Salvar"}
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {loading && !adding && (
            <div className="flex justify-center p-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          )}

          {!loading && credentials.length === 0 && !adding && (
            <div className="text-center p-8 bg-muted/50 rounded-lg border border-dashed">
              <Mail className="w-8 h-8 mx-auto text-muted-foreground mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">Nenhuma credencial de e-mail cadastrada.</p>
            </div>
          )}

          <div className="grid gap-3">
            {credentials.map(cred => (
              <Card key={cred.id} className="p-3 flex justify-between items-center bg-card">
                <div>
                  <p className="font-semibold text-sm">{cred.from_name} <span className="text-muted-foreground font-normal">({cred.from_email})</span></p>
                  <p className="text-xs text-muted-foreground font-mono mt-1">SMTP: {cred.host}:{cred.port}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(cred)} disabled={loading} title="Editar">
                    <Pencil className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(cred.id)} disabled={loading} title="Excluir">
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
