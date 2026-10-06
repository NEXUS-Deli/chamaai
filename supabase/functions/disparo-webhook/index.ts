import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// uazapi ACK status values (Baileys/WhatsApp protocol)
// 1 = PENDING, 2 = SERVER_ACK, 3 = DELIVERY_ACK (entregue), 4 = READ (lido), 5 = PLAYED
const STATUS_ENTREGUE = 3
const STATUS_LIDO = 4

const STATUS_BROADCAST = 'status@broadcast'

// ── Atendimento com IA ───────────────────────────────────────────────────────
// A UAZAPI envia os eventos de cada instância para UMA única URL (este webhook).
// Mensagens recebidas por instâncias com agente de IA ativo são repassadas ao
// ai-agent-webhook. Falhas aqui nunca interrompem o rastreamento de entrega.
const AI_AGENT_WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/ai-agent-webhook`

async function encaminharParaAgenteIA(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  body: Record<string, unknown>,
  rawText: string,
): Promise<void> {
  try {
    const msg = body?.message as Record<string, unknown> | undefined
    if (!msg || typeof msg !== 'object') return
    // Ignora mensagens enviadas pelo próprio número e mensagens de grupo
    if (msg.fromMe === true || msg.isGroup === true || String(msg.chatid ?? '').includes('@g.us')) return

    const token = typeof body?.token === 'string' ? body.token : ''
    if (!token) return

    const { data: inst } = await supabase.from('instancias').select('id').eq('token', token).maybeSingle()
    if (!inst) return
    const { data: cfg } = await supabase.from('ai_configuracoes').select('ativo').eq('instancia_id', inst.id).maybeSingle()
    if (!cfg?.ativo) return

    const resp = await fetch(AI_AGENT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawText,
      signal: AbortSignal.timeout(10000),
    })
    console.log(`[disparo-webhook] 🤖 mensagem repassada ao agente de IA (instância ${inst.id}) → HTTP ${resp.status}`)
  } catch (e) {
    console.error('[disparo-webhook] falha ao repassar mensagem ao agente de IA:', String(e))
  }
}

// Normaliza o JID de quem visualizou: remove o sufixo de dispositivo (":12") e mantém o servidor.
// Ex.: "5511999999999:12@s.whatsapp.net" → "5511999999999@s.whatsapp.net"
function normalizarJid(jid: unknown): string {
  if (typeof jid !== 'string' || !jid) return ''
  const [user, server] = jid.split('@')
  const semDevice = user.split(':')[0]
  return server ? `${semDevice}@${server}` : semDevice
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let rawText = ''
  try {
    rawText = await req.text()
    const body = JSON.parse(rawText)

    // Log completo para diagnóstico
    console.log('[disparo-webhook] PAYLOAD:', JSON.stringify(body).slice(0, 3000))

    // nexus-360.uazapi.com envia: { BaseUrl, EventType: "messages_update", event: { Chat, ID, ACK, ... } }
    // Outros formatos: { event: "string", data: [...] }
    const eventType: string =
      (typeof body?.EventType === 'string' ? body.EventType : null) ??
      (typeof body?.eventType === 'string' ? body.eventType : null) ??
      (typeof body?.event === 'string' ? body.event : null) ??
      (typeof body?.type === 'string' ? body.type : null) ??
      ''
    console.log(`[disparo-webhook] eventType="${eventType}"`)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Mensagem recebida → agente de IA (se a instância tiver um agente ativo)
    if (eventType.toLowerCase() === 'messages') {
      await encaminharParaAgenteIA(supabase, body, rawText)
    }

    // Monta fila unificada { msgId, numStatus } independente do formato
    // isStatus: recibo de story (Chat = status@broadcast); viewer: quem visualizou
    interface MsgUpdate { msgId: string; numStatus: number; isStatus?: boolean; viewer?: string }
    const queue: MsgUpdate[] = []

    // ── Formato nexus-360.uazapi.com ──────────────────────────────────────
    // { EventType: "messages_update", event: { MessageIDs: [...], Type: "Delivered"|"Read" }, state: "Delivered" }
    // Nota: nexus-360 envia IsFromMe=false para TODOS os eventos (inclusive mensagens enviadas por nós).
    // A filtragem é feita pelo lookup de mensagem_id no banco — só mensagens da campanha terão match.
    if (body?.event && typeof body.event === 'object' && !Array.isArray(body.event)) {
      const ev = body.event as Record<string, unknown>
      const msgIds: string[] = Array.isArray(ev?.MessageIDs)
        ? (ev.MessageIDs as string[]).filter(Boolean)
        : ev?.ID ? [String(ev.ID)] : ev?.id ? [String(ev.id)] : []

      const typeStr = String(ev?.Type ?? body?.state ?? '')
      const numStatus =
        typeStr === 'Delivered' ? STATUS_ENTREGUE
        : (typeStr === 'Read' || typeStr === 'Played') ? STATUS_LIDO
        : 0

      const chat = String(ev?.Chat ?? '')
      const isStatus = chat.startsWith(STATUS_BROADCAST)
      const viewer = normalizarJid(ev?.Sender ?? ev?.MessageSender ?? (isStatus ? '' : ev?.Chat))

      console.log(`[disparo-webhook] nexus360 msgIds=${JSON.stringify(msgIds)} type="${typeStr}" numStatus=${numStatus} chat="${chat}" viewer="${viewer}"`)
      for (const msgId of msgIds) {
        if (msgId && numStatus >= STATUS_ENTREGUE) queue.push({ msgId, numStatus, isStatus, viewer })
      }
    }

    // ── Formato Baileys / genérico ────────────────────────────────────────
    // { data: [{ key: { id }, update: { status: 3 } }] }
    const rawUpdates: unknown[] = Array.isArray(body?.data) ? body.data
      : body?.data ? [body.data]
      : Array.isArray(body?.messages) ? body.messages
      : Array.isArray(body) ? body : []

    for (const upd of rawUpdates) {
      const u = upd as Record<string, unknown>
      const msgId: string | undefined =
        ((u?.key as Record<string, unknown>)?.id as string) ??
        (u?.msgId as string) ?? (u?.ID as string) ?? (u?.id as string)
      const rawStatus =
        (u?.update as Record<string, unknown>)?.status ??
        u?.ACK ?? u?.ack ?? u?.status
      const numStatus = typeof rawStatus === 'number' ? rawStatus
        : rawStatus === 'DELIVERY_ACK' || rawStatus === 'delivered' ? STATUS_ENTREGUE
        : rawStatus === 'READ' || rawStatus === 'read' ? STATUS_LIDO
        : rawStatus === 'PLAYED' ? STATUS_LIDO : 0
      const key = u?.key as Record<string, unknown> | undefined
      const isStatus = String(key?.remoteJid ?? '').startsWith(STATUS_BROADCAST)
      const viewer = normalizarJid(key?.participant ?? u?.participant ?? (isStatus ? '' : key?.remoteJid))
      if (msgId && numStatus >= STATUS_ENTREGUE) queue.push({ msgId, numStatus, isStatus, viewer })
    }

    console.log(`[disparo-webhook] queue=${JSON.stringify(queue)}`)

    // Registra visualização de story. Nunca lança erro: falha aqui não pode afetar o fluxo de campanhas.
    const registrarVisualizacaoStory = async (msgId: string, viewer: string | undefined): Promise<boolean> => {
      if (!viewer) {
        console.log(`[disparo-webhook] story msgId=${msgId} sem identificação do visualizador`)
        return false
      }
      try {
        const { data, error } = await supabase.rpc('registrar_visualizacao_story', {
          p_mensagem_id: msgId,
          p_visualizador: viewer,
        })
        if (error) {
          console.error(`[disparo-webhook] erro ao registrar visualização msgId=${msgId}:`, error.message)
          return false
        }
        if (data === true) console.log(`[disparo-webhook] 👁 story ${msgId} visualizado por ${viewer}`)
        return data === true
      } catch (e) {
        console.error(`[disparo-webhook] exceção ao registrar visualização msgId=${msgId}:`, String(e))
        return false
      }
    }

    let processados = 0
    let visualizacoes = 0
    for (const { msgId, numStatus, isStatus, viewer } of queue) {

      // Recibos de story (status@broadcast) nunca pertencem a campanhas
      if (isStatus) {
        if (numStatus >= STATUS_LIDO && await registrarVisualizacaoStory(msgId, viewer)) visualizacoes++
        continue
      }

      let { data: contato } = await supabase
        .from('contatos_campanha')
        .select('id, campanha_id, status')
        .eq('mensagem_id', msgId)
        .maybeSingle()

      // Fallback: registros antigos salvos no formato "PHONE:HEX" pelo nexus-360
      if (!contato) {
        const { data: fallback } = await supabase
          .from('contatos_campanha')
          .select('id, campanha_id, status')
          .like('mensagem_id', `%:${msgId}`)
          .maybeSingle()
        contato = fallback ?? null
      }

      if (!contato) {
        console.log(`[disparo-webhook] contato não encontrado para msgId=${msgId}`)
        // Formato sem "Chat": pode ser recibo de story — tenta registrar a visualização
        if (numStatus >= STATUS_LIDO && await registrarVisualizacaoStory(msgId, viewer)) visualizacoes++
        continue
      }
      if (contato.status === 'lido') continue

      const novoStatus = numStatus >= STATUS_LIDO ? 'lido' : 'entregue'
      if (contato.status === 'entregue' && novoStatus === 'entregue') continue

      await supabase
        .from('contatos_campanha')
        .update({ status: novoStatus })
        .eq('id', contato.id)

      if (contato.status === 'enviado') {
        await supabase.rpc('incrementar_entregues', { p_campanha_id: contato.campanha_id })
      }
      if (novoStatus === 'lido') {
        await supabase.rpc('incrementar_lidos', { p_campanha_id: contato.campanha_id })
      }

      console.log(`[disparo-webhook] ✅ ${msgId} → ${novoStatus}`)
      processados++
    }

    console.log(`[disparo-webhook] concluído processados=${processados} visualizacoes=${visualizacoes}`)
    return new Response(JSON.stringify({ ok: true, processados, visualizacoes }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('[disparo-webhook] error:', e, 'raw:', rawText.slice(0, 500))
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
