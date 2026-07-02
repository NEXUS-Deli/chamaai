import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Trash2, QrCode, PowerOff, Smartphone, RefreshCw, CheckCircle2, WifiOff, AlertTriangle, Radio, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { canAddConnection } from "@/lib/plans";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  component: ConfigPage,
});

interface Instancia {
  id: string;
  nome: string;
  instancia: string;
  token: string;
  status: string;
  webhook_configurado: boolean;
}

// Chama a Edge Function uazapi-proxy para ações na UAZAPI
async function callProxy(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('uazapi-proxy', {
    body: { action, payload }
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

// Extrai o QR code de uma resposta da UAZAPI (tenta vários campos)
function extractQrCode(data: Record<string, unknown>): string | null {
  // Tenta campos comuns na resposta
  const candidates = [
    data?.qrcode,
    (data?.instance as Record<string, unknown>)?.qrcode,
    data?.base64,
    (data?.instance as Record<string, unknown>)?.base64,
    data?.qr,
    (data?.instance as Record<string, unknown>)?.qr,
  ];
  for (const c of candidates) {
    if (c && typeof c === 'string' && c.length > 20) return c as string;
  }
  return null;
}

// Extrai o status de conexão de uma resposta da UAZAPI
function extractStatus(data: Record<string, unknown>): string | null {
  // Se data.status for um objeto e tiver a propriedade connected ou loggedIn
  if (data?.status && typeof data.status === 'object') {
    const sObj = data.status as Record<string, unknown>;
    if (sObj.connected === true || sObj.loggedIn === true) {
      return 'connected';
    }
  }

  // Se data.status for diretamente uma string
  if (data?.status && typeof data.status === 'string') {
    return data.status;
  }

  // Se estiver em data.instance.status
  if (data?.instance && typeof data.instance === 'object') {
    const instObj = data.instance as Record<string, unknown>;
    if (typeof instObj.status === 'string') {
      return instObj.status;
    }
  }

  return null;
}

function ConfigPage() {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [novaInstanciaNome, setNovaInstanciaNome] = useState("");
  // Mapa de status dinâmico por instância: 'connected' | 'connecting' | 'disconnected'
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  // Informações do plano atual: null = carregando, "no_plan" = sem plano
  const [planInfo, setPlanInfo] = useState<{ name: string; limit: number } | null | "no_plan">(null);

  // Connection Modal States
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [activeInstancia, setActiveInstancia] = useState<Instancia | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<"idle" | "loading" | "awaiting_scan" | "connected" | "error">("idle");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [loadingWebhook, setLoadingWebhook] = useState<string | null>(null);

  // Interval Refs
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchInstancias();
    fetchPlanInfo();
    return () => {
      stopPolling();
      if (statusPollingRef.current) clearInterval(statusPollingRef.current);
    };
  }, []);

  const fetchPlanInfo = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("user_plans")
      .select("plans(name, max_connections)")
      .eq("user_id", u.user.id)
      .eq("active", true)
      .maybeSingle();
    if (error || !data) { setPlanInfo("no_plan"); return; }
    const plan = data.plans as { name: string; max_connections: number } | null;
    if (!plan) { setPlanInfo("no_plan"); return; }
    setPlanInfo({ name: plan.name, limit: plan.max_connections });
  };

  const fetchInstancias = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data, error } = await (supabase as any)
      .from("instancias")
      .select("id, nome, instancia, token, criada_em, status, webhook_configurado")
      .eq("usuario_id", u.user.id)
      .order("criada_em", { ascending: false });

    if (error) {
      // Fallback sem colunas novas se cache desatualizado
      if (error.message?.includes("status") || error.message?.includes("webhook") || error.code === "42703") {
        const { data: fallbackData, error: fallbackError } = await supabase
          .from("instancias")
          .select("id, nome, instancia, token, criada_em")
          .eq("usuario_id", u.user.id)
          .order("criada_em", { ascending: false });
        if (fallbackError) {
          console.error("Erro ao buscar instâncias:", fallbackError);
          toast.error("Erro ao buscar instâncias: " + fallbackError.message);
          return;
        }
        if (fallbackData) {
          const filteredFallback = fallbackData
            .filter(i => i.instancia !== 'r1b5f62949ba437')
            .map(i => ({ ...i, status: 'disconnected', webhook_configurado: false }));
          setInstancias(filteredFallback as Instancia[]);
        }
        return;
      }
      console.error("Erro ao buscar instâncias:", error);
      toast.error("Erro ao buscar instâncias: " + error.message);
      return;
    }
    // Normaliza: garante que colunas sempre existem e filtra a fixa
    if (data) {
      const filteredData = (data as any[])
        .filter((i: any) => i.instancia !== 'r1b5f62949ba437')
        .map((i: any) => ({
          ...i,
          status: i.status || 'disconnected',
          webhook_configurado: i.webhook_configurado ?? false,
        }));
      setInstancias(filteredData as Instancia[]);
      // Inicia busca de status dinâmico para todas as instâncias
      fetchAllStatuses(filteredData as Instancia[]);
      // Re-verifica a cada 30s
      if (statusPollingRef.current) clearInterval(statusPollingRef.current);
      statusPollingRef.current = setInterval(() => fetchAllStatuses(filteredData as Instancia[]), 30000);
    }
  };

  // Busca o status real da UAZAPI para todas as instâncias em paralelo
  const fetchAllStatuses = async (lista: Instancia[]) => {
    if (!lista || lista.length === 0) return;
    const results = await Promise.allSettled(
      lista.map(async (inst) => {
        try {
          const data = await callProxy('instance_status', { token: inst.token });
          const raw = extractStatus(data as Record<string, unknown>);
          // Normaliza: 'open' e 'connected' → 'connected', 'connecting'/'qrReadSuccess' → 'connecting'
          let normalized = 'disconnected';
          if (raw === 'open' || raw === 'connected') normalized = 'connected';
          else if (raw === 'connecting' || raw === 'qrReadSuccess' || raw === 'qrRead') normalized = 'connecting';
          return { id: inst.id, status: normalized };
        } catch {
          return { id: inst.id, status: 'disconnected' };
        }
      })
    );
    const newMap: Record<string, string> = {};
    for (const r of results) {
      if (r.status === 'fulfilled') {
        newMap[r.value.id] = r.value.status;
      }
    }
    setStatusMap(prev => ({ ...prev, ...newMap }));
  };


  const addInstancia = async () => {
    if (!novaInstanciaNome.trim()) return toast.error("O nome da instância é obrigatório");
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Usuário não autenticado");

      // Verifica limite de conexões do plano antes de chamar a UAZAPI
      const limitCheck = await canAddConnection(u.user.id);
      if (!limitCheck.allowed) {
        throw new Error(
          `Limite de conexões atingido para o seu plano (${limitCheck.current}/${limitCheck.limit}). ` +
          `Faça upgrade para adicionar mais números.`
        );
      }

      // Chama a Edge Function para criar a instância (esconde o admin token)
      const functionData = await callProxy('create_instance', { name: novaInstanciaNome.trim() });

      // A UAZAPI retorna token e instance.id (ou id direto)
      const uazapiToken = functionData?.token || functionData?.instance?.token;
      const uazapiId = functionData?.instance?.id || functionData?.id || functionData?.instance?.instanceId;

      if (!uazapiToken) throw new Error("Token não retornado pela UAZAPI. Verifique a resposta.");
      if (!uazapiId) throw new Error("ID da instância não retornado pela UAZAPI.");

      // Salva no Supabase — tenta com status primeiro, cai sem status se cache desatualizado
      let dbData: Instancia | null = null;
      const insertBase = {
        usuario_id: u.user.id,
        nome: novaInstanciaNome.trim(),
        instancia: uazapiId,
        token: uazapiToken,
      };
      const { data: d1, error: e1 } = await supabase.from("instancias")
        .insert({ ...insertBase, status: 'disconnected' }).select().single();
      if (e1 && (e1.message?.includes("status") || e1.code === "42703")) {
        // Cache desatualizado: insere sem status
        const { data: d2, error: e2 } = await supabase.from("instancias")
          .insert(insertBase).select().single();
        if (e2) throw new Error(e2.message);
        dbData = { ...(d2 as object), status: 'disconnected' } as Instancia;
      } else if (e1) {
        throw new Error(e1.message);
      } else {
        dbData = { ...(d1 as object), status: 'disconnected' } as Instancia;
      }

      // Configura webhook automaticamente para rastreamento de entrega
      let webhookOk = false;
      try {
        const webhookResult = await callProxy('set_webhook', { token: uazapiToken, instanceId: uazapiId });
        webhookOk = webhookResult?.ok === true;
        if (webhookOk && dbData) {
          await (supabase as any).from("instancias").update({ webhook_configurado: true }).eq("id", dbData.id);
          dbData = { ...dbData, webhook_configurado: true };
        }
      } catch {
        console.warn('Webhook não configurado automaticamente');
      }

      setInstancias([dbData, ...instancias]);
      setNovaInstanciaNome("");
      toast.success("Instância criada com sucesso!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao criar instância";
      toast.error(msg);
      console.error("Erro ao criar instância:", err);
    } finally {
      setLoading(false);
    }
  };


  const configurarWebhook = async (inst: Instancia) => {
    setLoadingWebhook(inst.id);
    try {
      const result = await callProxy('set_webhook', { token: inst.token, instanceId: inst.instancia });
      if (result?.ok) {
        await (supabase as any).from("instancias").update({ webhook_configurado: true }).eq("id", inst.id);
        setInstancias(prev => prev.map(i => i.id === inst.id ? { ...i, webhook_configurado: true } : i));
        toast.success("Rastreamento de entrega ativado com sucesso!");
      } else {
        console.error("[webhook] Todos os endpoints falharam:", result?.erros);
        toast.error("Não foi possível ativar o rastreamento. Verifique o console (F12) para detalhes.");
      }
    } catch (e) {
      console.error("[webhook] Erro:", e);
      toast.error("Erro ao configurar rastreamento.");
    } finally {
      setLoadingWebhook(null);
    }
  };

  const removerInstancia = async (inst: Instancia) => {
    if (!confirm(`Tem certeza que deseja excluir "${inst.nome}"? Esta ação é irreversível.`)) return;
    setLoading(true);

    // 1. Remove da UAZAPI PRIMEIRO — operação obrigatória para manter sincronismo
    try {
      await callProxy('delete_instance', { instanceId: inst.instancia, token: inst.token });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido ao deletar na UAZAPI";

      // Se a instância simplesmente não existe mais na UAZAPI, trata como sucesso
      // (pode ter sido removida manualmente no painel da UAZAPI)
      const jaRemovida =
        msg.toLowerCase().includes("not found") ||
        msg.toLowerCase().includes("404") ||
        msg.toLowerCase().includes("não encontrada") ||
        msg.toLowerCase().includes("instance not found") ||
        msg.toLowerCase().includes("invalid token") ||
        msg.toLowerCase().includes("unauthorized");

      if (!jaRemovida) {
        // Erro real: bloqueia exclusão local para manter sincronismo
        setLoading(false);
        toast.error(`Não foi possível remover a instância na UAZAPI: ${msg}. Por segurança, o registro local não foi excluído.`);
        console.error("Erro ao deletar na UAZAPI:", err);
        return;
      }

      // Instância já não existe na UAZAPI — prossegue com exclusão local
      console.warn("Instância não encontrada na UAZAPI (já removida). Prosseguindo com exclusão local.");
    }

    // 2. Remove do banco Supabase somente após sucesso (ou não-existência) na UAZAPI
    const { error } = await supabase.from("instancias").delete().eq("id", inst.id);
    setLoading(false);
    if (error) return toast.error("Erro ao remover do banco: " + error.message);
    setInstancias(instancias.filter(i => i.id !== inst.id));
    toast.success("Instância excluída com sucesso!");
  };


  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const checkStatus = useCallback(async (token: string) => {
    try {
      const data = await callProxy('instance_status', { token });
      const status = extractStatus(data as Record<string, unknown>);
      const qr = extractQrCode(data as Record<string, unknown>);

      if (status === 'connected' || status === 'open') {
        setConnectStatus('connected');
        setQrCode(null);
        stopPolling();
        toast.success("WhatsApp conectado com sucesso! ✅");
        // Atualiza status no banco e no mapa dinâmico
        if (activeInstancia) {
          supabase.from("instancias").update({ status: 'connected' }).eq("id", activeInstancia.id)
            .then(({ error }) => { if (error) console.warn("Não foi possível salvar status:", error.message); });
          setInstancias(prev => prev.map(i => i.id === activeInstancia?.id ? { ...i, status: 'connected' } : i));
          setStatusMap(prev => ({ ...prev, [activeInstancia.id]: 'connected' }));
        }
      } else if (qr) {
        setQrCode(qr);
        setConnectStatus('awaiting_scan');
      }
    } catch (error) {
      console.error("Erro no polling de status", error);
    }
  }, [activeInstancia]);


  const openConnectModal = async (inst: Instancia) => {
    // Limpa estado anterior
    stopPolling();
    setActiveInstancia(inst);
    setQrCode(null);
    setConnectError(null);
    setConnectStatus("loading");
    setConnectModalOpen(true);

    try {
      // Solicita conexão via Edge Function (evita CORS)
      const data = await callProxy('connect_instance', { token: inst.token });
      const qr = extractQrCode(data as Record<string, unknown>);
      const status = extractStatus(data as Record<string, unknown>);

      if (status === 'connected' || status === 'open') {
        // Já estava conectado
        setConnectStatus('connected');
        return;
      }

      if (qr) {
        setQrCode(qr);
        setConnectStatus('awaiting_scan');
      } else {
        // QR não retornado imediatamente — inicia polling para obtê-lo
        setConnectStatus('awaiting_scan');
      }

      // Inicia polling a cada 3s para verificar conexão/pegar QR atualizado
      pollingRef.current = setInterval(() => checkStatus(inst.token), 3000);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro ao conectar";
      setConnectError(msg);
      setConnectStatus("error");
      toast.error(msg);
    }
  };

  const handleDisconnect = async (inst: Instancia) => {
    if (!confirm("Deseja realmente desconectar este WhatsApp?")) return;
    try {
      await callProxy('disconnect_instance', { token: inst.token });
      // Atualiza local imediatamente
      setInstancias(prev => prev.map(i => i.id === inst.id ? { ...i, status: 'disconnected' } : i));
      // Persiste no banco silenciosamente (falha se cache desatualizado, não bloqueia UX)
      supabase.from("instancias").update({ status: 'disconnected' }).eq("id", inst.id)
        .then(({ error }) => { if (error) console.warn("Não foi possível salvar status:", error.message); });
      toast.success("Instância desconectada!");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro ao desconectar";
      toast.error(msg);
    }
  };

  const closeModal = () => {
    stopPolling();
    setConnectModalOpen(false);
    setQrCode(null);
    setConnectStatus("idle");
    setConnectError(null);
  };

  const statusBadge = (instId: string, fallback: string) => {
    // Usa o status dinâmico se disponível, senão usa o do banco
    const status = statusMap[instId] ?? fallback;
    if (status === 'connected') return (
      <span className="flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        Conectado
      </span>
    );
    if (status === 'connecting') return (
      <span className="flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
        Conectando...
      </span>
    );
    return (
      <span className="flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
        Desconectado
      </span>
    );
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchInstancias();
    setRefreshing(false);
  };

  return (
    <div className="p-4 sm:p-8 w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Gerenciar WhatsApp</h1>
          <p className="text-sm text-muted-foreground">Crie novas instâncias e conecte seus números de WhatsApp usando a UAZAPI.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Atualizando...' : 'Atualizar'}
        </Button>
      </div>

      {/* Banner de plano */}
      {planInfo === "no_plan" && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-700 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Nenhum plano ativo encontrado. Entre em contato com o suporte para ativar o seu plano.</span>
        </div>
      )}
      {planInfo && planInfo !== "no_plan" && (() => {
        const atLimit = instancias.length >= planInfo.limit;
        const pct = Math.min(100, Math.round((instancias.length / planInfo.limit) * 100));
        return (
          <div className="flex items-center justify-between gap-4 rounded-lg border bg-card px-5 py-3">
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="text-xs font-semibold">
                Plano {planInfo.name}
              </Badge>
              <span className={`text-sm font-medium ${atLimit ? "text-destructive" : "text-muted-foreground"}`}>
                {instancias.length}/{planInfo.limit} conexões utilizadas
              </span>
            </div>
            <div className="flex items-center gap-2 min-w-[120px]">
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${atLimit ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
            </div>
          </div>
        );
      })()}

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Nova Instância</h2>
        {planInfo && planInfo !== "no_plan" && instancias.length >= planInfo.limit && (
          <p className="text-sm text-destructive flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Você atingiu o limite do seu plano. Faça upgrade para adicionar mais números.
          </p>
        )}
        <div className="flex gap-2">
          <Input
            placeholder="Nome da Instância (ex: WhatsApp Comercial)"
            value={novaInstanciaNome}
            onChange={e => setNovaInstanciaNome(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addInstancia()}
            disabled={planInfo !== null && planInfo !== "no_plan" && instancias.length >= planInfo.limit}
          />
          <Button
            onClick={addInstancia}
            disabled={
              loading ||
              !novaInstanciaNome.trim() ||
              (planInfo !== null && planInfo !== "no_plan" && instancias.length >= planInfo.limit)
            }
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Criar Instância
          </Button>
        </div>
      </Card>

      <div className="space-y-4">
        <h2 className="font-semibold">Minhas Instâncias</h2>
        {instancias.length === 0 && (
          <p className="text-sm text-muted-foreground p-4 bg-muted rounded-md text-center">
            Nenhuma instância cadastrada. Crie uma acima para começar.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {instancias.map((inst) => {
            const isWebhookLoading = loadingWebhook === inst.id;
            return (
              <Card key={inst.id} className="p-4 flex flex-col gap-3">
                <div className="flex justify-between items-start">
                  <div className="min-w-0">
                    <h3 className="font-bold text-lg flex items-center gap-2 truncate">
                      <Smartphone className="w-4 h-4 text-primary shrink-0" />
                      <span className="truncate">{inst.nome}</span>
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                      {inst.instancia}
                    </p>
                    <div className="mt-1.5">{statusBadge(inst.id, inst.status)}</div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removerInstancia(inst)} disabled={loading} className="shrink-0">
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>

                {/* Rastreamento de entrega */}
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/50 border">
                  {inst.webhook_configurado ? (
                    <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 font-medium">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      Rastreamento de entrega ativo
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-yellow-700 dark:text-yellow-400 font-medium">
                      <Radio className="w-3.5 h-3.5 shrink-0" />
                      Rastreamento inativo
                    </div>
                  )}
                  {!inst.webhook_configurado && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs px-2 shrink-0"
                      onClick={() => configurarWebhook(inst)}
                      disabled={isWebhookLoading}
                    >
                      {isWebhookLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Ativar"}
                    </Button>
                  )}
                  {inst.webhook_configurado && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs px-2 shrink-0 text-muted-foreground"
                      onClick={() => configurarWebhook(inst)}
                      disabled={isWebhookLoading}
                    >
                      {isWebhookLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Reconfigurar"}
                    </Button>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button variant="default" className="flex-1 text-xs" onClick={() => openConnectModal(inst)}>
                    <QrCode className="w-4 h-4 mr-2" />
                    Conectar
                  </Button>
                  <Button variant="outline" className="flex-1 text-xs" onClick={() => handleDisconnect(inst)}>
                    <PowerOff className="w-4 h-4 mr-2" />
                    Desconectar
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <Dialog open={connectModalOpen} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="sm:max-w-md text-center">
          <DialogHeader>
            <DialogTitle>Conectar {activeInstancia?.nome}</DialogTitle>
            <DialogDescription>
              Abra o WhatsApp no seu celular, vá em Aparelhos Conectados e leia o QR Code abaixo.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center min-h-[300px] p-6 bg-muted/50 rounded-md">
            {connectStatus === 'connected' ? (
              <div className="text-primary flex flex-col items-center">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-xl font-bold text-green-600">Conectado!</h3>
                <p className="text-sm mt-2 text-center text-muted-foreground">Sua instância está pronta para enviar campanhas.</p>
              </div>
            ) : connectStatus === 'error' ? (
              <div className="flex flex-col items-center text-destructive gap-3">
                <WifiOff className="w-10 h-10" />
                <p className="font-semibold">Falha ao conectar</p>
                <p className="text-sm text-muted-foreground">{connectError}</p>
                <Button size="sm" variant="outline" onClick={() => activeInstancia && openConnectModal(activeInstancia)}>
                  <RefreshCw className="w-4 h-4 mr-2" /> Tentar novamente
                </Button>
              </div>
            ) : qrCode ? (
              <div className="space-y-4">
                <img
                  src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                  alt="QR Code WhatsApp"
                  className="w-64 h-64 mx-auto rounded-md shadow-sm border bg-white p-2"
                />
                <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
                  <RefreshCw className="w-3 h-3 animate-spin text-primary" />
                  Aguardando leitura do QR Code...
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin mb-4 text-primary" />
                <p>Gerando QR Code...</p>
                <p className="text-xs mt-2 opacity-60">Aguarde alguns segundos</p>
              </div>
            )}
          </div>
          <Button onClick={closeModal} variant="outline" className="w-full">
            {connectStatus === 'connected' ? 'Fechar' : 'Cancelar'}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}