// Formulário do agente de IA — compartilhado entre "Criar agente" e "Editar agente".
// Provedor, modelo e chave da IA NÃO aparecem aqui: são definidos pelo sistema no servidor.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Timer, Mic, Image as ImageIcon, Clock, UserCog, Loader2, RefreshCw } from "lucide-react";
import { SELECAO_ATIVA } from "@/lib/selecao";

export const DIAS_SEMANA = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

export interface AgenteFormValues {
  system_prompt: string;
  buffer_segundos: number;
  responder_audio: boolean;
  responder_imagem: boolean;
  restringir_horario: boolean;
  dias_semana: number[];
  horario_inicio: string;
  horario_fim: string;
  mensagem_fora_horario: string;
  transferencia_ativa: boolean;
  transferencia_tipo: "numero" | "grupo";
  transferencia_numero: string;
  transferencia_grupo_id: string;
  transferencia_grupo_nome: string;
}

export const VALORES_PADRAO: AgenteFormValues = {
  system_prompt: "",
  buffer_segundos: 8,
  responder_audio: true,
  responder_imagem: true,
  restringir_horario: false,
  dias_semana: [1, 2, 3, 4, 5],
  horario_inicio: "09:00",
  horario_fim: "18:00",
  mensagem_fora_horario: "",
  transferencia_ativa: false,
  transferencia_tipo: "numero",
  transferencia_numero: "",
  transferencia_grupo_id: "",
  transferencia_grupo_nome: "",
};

/** Normaliza um telefone brasileiro para o formato com DDI (55 + DDD + número). */
function normalizarTelefone(valor: string): string {
  const digits = valor.replace(/\D/g, "");
  if (!digits) return "";
  return digits.length <= 11 ? `55${digits}` : digits;
}

/** Converte a linha do banco (ai_configuracoes) para os valores do formulário. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function valoresDoBanco(row: any): AgenteFormValues {
  const destino: string = row?.transferencia_destino ?? "";
  const ehGrupo = destino.endsWith("@g.us");
  const numeroAntigo: string = row?.transferencia_telefone ?? "";
  return {
    system_prompt: row?.system_prompt ?? "",
    buffer_segundos: row?.buffer_segundos ?? 8,
    responder_audio: row?.responder_audio ?? true,
    responder_imagem: row?.responder_imagem ?? true,
    restringir_horario: row?.restringir_horario ?? false,
    dias_semana: row?.dias_semana ?? [1, 2, 3, 4, 5],
    horario_inicio: row?.horario_inicio ?? "09:00",
    horario_fim: row?.horario_fim ?? "18:00",
    mensagem_fora_horario: row?.mensagem_fora_horario ?? "",
    transferencia_ativa: row?.transferencia_ativa ?? false,
    transferencia_tipo: ehGrupo ? "grupo" : "numero",
    transferencia_numero: ehGrupo ? "" : (destino ? destino.split("@")[0] : numeroAntigo),
    transferencia_grupo_id: ehGrupo ? destino : "",
    transferencia_grupo_nome: ehGrupo ? (row?.transferencia_destino_nome ?? "") : "",
  };
}

/** Converte os valores do formulário para as colunas de ai_configuracoes. */
export function valoresParaBanco(v: AgenteFormValues) {
  const numero = normalizarTelefone(v.transferencia_numero);
  const destino = !v.transferencia_ativa
    ? null
    : v.transferencia_tipo === "grupo"
      ? (v.transferencia_grupo_id || null)
      : (numero ? `${numero}@s.whatsapp.net` : null);
  return {
    system_prompt: v.system_prompt.trim(),
    buffer_segundos: Math.max(0, Math.min(45, Math.round(v.buffer_segundos))),
    responder_audio: v.responder_audio,
    responder_imagem: v.responder_imagem,
    restringir_horario: v.restringir_horario,
    dias_semana: v.dias_semana,
    horario_inicio: v.horario_inicio,
    horario_fim: v.horario_fim,
    mensagem_fora_horario: v.mensagem_fora_horario.trim() || null,
    transferencia_ativa: v.transferencia_ativa,
    transferencia_destino: destino,
    transferencia_destino_nome: v.transferencia_tipo === "grupo" ? (v.transferencia_grupo_nome || null) : null,
    transferencia_telefone: v.transferencia_tipo === "numero" ? (numero || null) : null,
  };
}

/** Retorna uma mensagem de erro, ou null se o formulário estiver válido. */
export function validarAgente(v: AgenteFormValues): string | null {
  if (v.system_prompt.trim().length < 20) return "Escreva o prompt do agente (mínimo de 20 caracteres).";
  if (v.restringir_horario && v.dias_semana.length === 0) return "Selecione ao menos um dia de funcionamento.";
  if (v.transferencia_ativa) {
    if (v.transferencia_tipo === "numero" && normalizarTelefone(v.transferencia_numero).length < 12)
      return "Informe o número de WhatsApp que receberá o aviso de transferência (com DDD).";
    if (v.transferencia_tipo === "grupo" && !v.transferencia_grupo_id)
      return "Selecione o grupo que receberá o aviso de transferência.";
  }
  return null;
}

export const PROMPT_EXEMPLO =
  "Você é a Ana, atendente virtual da [Nome da empresa]. Atenda com simpatia, de forma breve e natural, em português.\n\n" +
  "Sobre a empresa: [o que vende, horários, endereço, formas de pagamento, prazos de entrega].\n\n" +
  "Regras: responda só sobre a empresa; não invente preços ou informações; se não souber, ofereça falar com um atendente.";

function Secao({
  icon: Icon, titulo, descricao, acao, children,
}: {
  icon: React.ElementType;
  titulo: string;
  descricao?: string;
  acao?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{titulo}</p>
            {descricao && <p className="text-xs text-muted-foreground mt-0.5">{descricao}</p>}
          </div>
        </div>
        {acao && <div className="shrink-0">{acao}</div>}
      </div>
      {children && <div className="pl-7">{children}</div>}
    </div>
  );
}

interface Grupo { id: string; subject: string }

export function AgenteFormFields({
  values, onChange, instanciaToken,
}: {
  values: AgenteFormValues;
  onChange: (v: AgenteFormValues) => void;
  /** Token da instância selecionada — usado para listar os grupos do WhatsApp */
  instanciaToken?: string | null;
}) {
  const set = <K extends keyof AgenteFormValues>(k: K, val: AgenteFormValues[K]) => onChange({ ...values, [k]: val });

  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [carregandoGrupos, setCarregandoGrupos] = useState(false);
  const [erroGrupos, setErroGrupos] = useState<string | null>(null);

  const carregarGrupos = async () => {
    if (!instanciaToken) return;
    setCarregandoGrupos(true);
    setErroGrupos(null);
    try {
      const { data, error } = await supabase.functions.invoke("uazapi-proxy", {
        body: { action: "get_groups", payload: { token: instanciaToken } },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setGrupos(Array.isArray(data) ? data : []);
    } catch (e) {
      setErroGrupos(e instanceof Error ? e.message : "Não foi possível carregar os grupos");
    } finally {
      setCarregandoGrupos(false);
    }
  };

  // Carrega os grupos ao escolher "Grupo" (e quando a instância muda)
  useEffect(() => {
    if (values.transferencia_ativa && values.transferencia_tipo === "grupo") carregarGrupos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.transferencia_ativa, values.transferencia_tipo, instanciaToken]);

  const toggleDia = (d: number) =>
    set("dias_semana", values.dias_semana.includes(d)
      ? values.dias_semana.filter(x => x !== d)
      : [...values.dias_semana, d].sort());

  // Mantém o grupo salvo visível na lista mesmo antes de carregar
  const opcoesGrupo = values.transferencia_grupo_id && !grupos.some(g => g.id === values.transferencia_grupo_id)
    ? [{ id: values.transferencia_grupo_id, subject: values.transferencia_grupo_nome || "Grupo selecionado" }, ...grupos]
    : grupos;

  return (
    <div className="divide-y">
      {/* Prompt */}
      <Secao
        icon={Bot}
        titulo="Prompt do agente"
        descricao="Explique quem é o agente, o que a empresa faz e como ele deve atender. Quanto mais detalhes, melhores as respostas."
      >
        <Textarea
          rows={8}
          value={values.system_prompt}
          onChange={e => set("system_prompt", e.target.value)}
          placeholder={PROMPT_EXEMPLO}
          className="text-sm"
        />
      </Secao>

      {/* Agrupamento */}
      <Secao
        icon={Timer}
        titulo="Tempo de agrupamento de mensagens"
        descricao="Quando o cliente manda várias mensagens seguidas, o agente espera esse tempo de silêncio e responde tudo de uma vez. Use 0 para responder na hora."
      >
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={45}
            value={values.buffer_segundos}
            onChange={e => {
              const n = Number(e.target.value);
              set("buffer_segundos", Number.isFinite(n) ? Math.max(0, Math.min(45, n)) : 0);
            }}
            className="w-24 text-sm"
          />
          <span className="text-sm text-muted-foreground">segundos (máx. 45)</span>
        </div>
      </Secao>

      {/* Áudio */}
      <Secao
        icon={Mic}
        titulo="Entender áudios"
        descricao="Transcreve as mensagens de voz do cliente para o agente responder."
        acao={<Switch checked={values.responder_audio} onCheckedChange={v => set("responder_audio", v)} />}
      />

      {/* Imagem */}
      <Secao
        icon={ImageIcon}
        titulo="Analisar imagens"
        descricao="Permite ao agente ver e comentar as imagens enviadas pelo cliente."
        acao={<Switch checked={values.responder_imagem} onCheckedChange={v => set("responder_imagem", v)} />}
      />

      {/* Horário comercial */}
      <Secao
        icon={Clock}
        titulo="Restringir a horário comercial"
        descricao="Fora do horário, o agente não responde — só envia a mensagem automática abaixo (no máximo uma vez a cada 12h por contato)."
        acao={<Switch checked={values.restringir_horario} onCheckedChange={v => set("restringir_horario", v)} />}
      >
        {values.restringir_horario && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Dias de funcionamento</Label>
              <div className="flex flex-wrap gap-1.5">
                {DIAS_SEMANA.map(d => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDia(d.value)}
                    className={`relative px-2.5 py-1 rounded-md text-xs transition-colors ${
                      values.dias_semana.includes(d.value)
                        ? SELECAO_ATIVA
                        : "border text-muted-foreground font-medium hover:text-foreground"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 grid-cols-2 max-w-xs">
              <div className="space-y-1.5">
                <Label className="text-xs">Início</Label>
                <Input type="time" value={values.horario_inicio} onChange={e => set("horario_inicio", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Fim</Label>
                <Input type="time" value={values.horario_fim} onChange={e => set("horario_fim", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mensagem fora do horário (opcional)</Label>
              <Textarea
                rows={2}
                placeholder="Nosso atendimento funciona de segunda a sexta, das 9h às 18h. Responderemos assim que possível!"
                value={values.mensagem_fora_horario}
                onChange={e => set("mensagem_fora_horario", e.target.value)}
                className="text-sm"
              />
            </div>
          </div>
        )}
      </Secao>

      {/* Transferência para humano */}
      <Secao
        icon={UserCog}
        titulo="Permitir transferência para humano"
        descricao="Quando o cliente pedir um atendente (ou o agente não souber resolver), a IA para de responder esse contato e envia um aviso no WhatsApp."
        acao={<Switch checked={values.transferencia_ativa} onCheckedChange={v => set("transferencia_ativa", v)} />}
      >
        {values.transferencia_ativa && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Enviar o aviso para</Label>
              <div className="flex gap-1 rounded-lg border bg-muted/40 p-1 w-fit">
                {(["numero", "grupo"] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set("transferencia_tipo", t)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      values.transferencia_tipo === t ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t === "numero" ? "Um número" : "Um grupo"}
                  </button>
                ))}
              </div>
            </div>

            {values.transferencia_tipo === "numero" ? (
              <div className="space-y-1.5 max-w-xs">
                <Label className="text-xs">Número de WhatsApp (com DDD)</Label>
                <Input
                  placeholder="Ex: 11999990000"
                  value={values.transferencia_numero}
                  onChange={e => set("transferencia_numero", e.target.value)}
                  className="text-sm"
                />
              </div>
            ) : (
              <div className="space-y-1.5 max-w-md">
                <Label className="text-xs">Grupo do WhatsApp</Label>
                {!instanciaToken ? (
                  <p className="text-xs text-muted-foreground">Selecione o WhatsApp do agente para listar os grupos.</p>
                ) : (
                  <div className="flex items-center gap-2">
                    <Select
                      value={values.transferencia_grupo_id}
                      onValueChange={id => onChange({
                        ...values,
                        transferencia_grupo_id: id,
                        transferencia_grupo_nome: opcoesGrupo.find(g => g.id === id)?.subject ?? "",
                      })}
                    >
                      <SelectTrigger className="text-sm">
                        <SelectValue placeholder={carregandoGrupos ? "Carregando grupos..." : "Selecione um grupo"} />
                      </SelectTrigger>
                      <SelectContent>
                        {opcoesGrupo.map(g => <SelectItem key={g.id} value={g.id}>{g.subject}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      onClick={carregarGrupos}
                      title="Recarregar grupos"
                      className="shrink-0 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                    >
                      {carregandoGrupos ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    </button>
                  </div>
                )}
                {erroGrupos && <p className="text-xs text-danger">{erroGrupos}</p>}
                {!carregandoGrupos && !erroGrupos && instanciaToken && grupos.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum grupo encontrado neste WhatsApp.</p>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              O aviso sai do próprio WhatsApp do agente, com o contato do cliente e a última mensagem. Para a IA voltar a atender esse cliente, remova-o de "Contatos Excluídos".
            </p>
          </div>
        )}
      </Secao>
    </div>
  );
}
