import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// uazapi ACK status values (Baileys/WhatsApp protocol)
// 1 = PENDING, 2 = SERVER_ACK, 3 = DELIVERY_ACK (entregue), 4 = READ (lido), 5 = PLAYED
const STATUS_ENTREGUE = 3
const STATUS_LIDO = 4

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

    // Monta fila unificada { msgId, numStatus } independente do formato
    interface MsgUpdate { msgId: string; numStatus: number }
    const queue: MsgUpdate[] = []

    // ── Formato nexus-360.uazapi.com ──────────────────────────────────────
    // { EventType: "messages_update", event: { MessageIDs: [...], Type: "Delivered"|"Read" }, state: "Delivered" }
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

      console.log(`[disparo-webhook] nexus360 msgIds=${JSON.stringify(msgIds)} type="${typeStr}" numStatus=${numStatus}`)
      for (const msgId of msgIds) {
        if (msgId && numStatus >= STATUS_ENTREGUE) queue.push({ msgId, numStatus })
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
      if (msgId && numStatus >= STATUS_ENTREGUE) queue.push({ msgId, numStatus })
    }

    console.log(`[disparo-webhook] queue=${JSON.stringify(queue)}`)

    let processados = 0
    for (const { msgId, numStatus } of queue) {

      const { data: contato } = await supabase
        .from('contatos_campanha')
        .select('id, campanha_id, status')
        .eq('mensagem_id', msgId)
        .maybeSingle()

      if (!contato) {
        console.log(`[disparo-webhook] contato não encontrado para msgId=${msgId}`)
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

    console.log(`[disparo-webhook] concluído processados=${processados}`)
    return new Response(JSON.stringify({ ok: true, processados }), {
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
