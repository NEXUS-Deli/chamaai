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

  try {
    const body = await req.json()
    const event = body?.event ?? body?.type ?? ''

    // Handles: messages.update (delivery/read ACK)
    if (!event.includes('messages') && !event.includes('message')) {
      return new Response(JSON.stringify({ ok: true, skipped: event }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Normalize to array — uazapi sends either an array or a single object
    const updates: unknown[] = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : []

    let entregues = 0
    for (const update of updates) {
      const u = update as Record<string, unknown>

      // Extract messageId — two common formats
      const msgId: string | undefined =
        (u?.key as Record<string, unknown>)?.id as string ??
        u?.msgId as string ??
        u?.id as string

      // Extract status — numeric or string
      const rawStatus =
        (u?.update as Record<string, unknown>)?.status ??
        u?.ACK ??
        u?.status

      const numStatus = typeof rawStatus === 'number'
        ? rawStatus
        : rawStatus === 'DELIVERY_ACK' ? STATUS_ENTREGUE
        : rawStatus === 'READ' ? STATUS_LIDO
        : rawStatus === 'PLAYED' ? STATUS_LIDO
        : 0

      if (!msgId || numStatus < STATUS_ENTREGUE) continue

      // Find contact by messageId
      const { data: contato } = await supabase
        .from('contatos_campanha')
        .select('id, campanha_id, status')
        .eq('mensagem_id', msgId)
        .maybeSingle()

      if (!contato || contato.status === 'entregue' || contato.status === 'lido') continue

      const novoStatus = numStatus >= STATUS_LIDO ? 'lido' : 'entregue'

      await supabase
        .from('contatos_campanha')
        .update({ status: novoStatus })
        .eq('id', contato.id)

      // Increment entregues counter on campaign
      await supabase.rpc('incrementar_entregues', { p_campanha_id: contato.campanha_id })

      entregues++
    }

    console.log(`[disparo-webhook] event=${event} entregues=${entregues}`)
    return new Response(JSON.stringify({ ok: true, entregues }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('[disparo-webhook] error:', e)
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
