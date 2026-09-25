import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Trash2, Plus, Mail, Loader2, Save } from "lucide-react";
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
  const [adding, setAdding] = useState(false);
  
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
        host: formData.host,
        port: parseInt(formData.port),
        username: formData.username,
        password: formData.password,
        from_name: formData.from_name,
        from_email: formData.from_email,
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
              <h3 className="font-semibold text-sm">Adicionar nova credencial</h3>
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
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancelar</Button>
                <Button size="sm" onClick={handleSave} disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Salvar
                </Button>
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
                <Button variant="ghost" size="icon" onClick={() => handleDelete(cred.id)} disabled={loading}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </Card>
            ))}
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
