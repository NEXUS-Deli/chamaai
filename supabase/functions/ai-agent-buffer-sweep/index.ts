import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleClaimedBuffer } from "../_shared/ai-agent-core.ts"

// Rede de segurança do buffer do agente de IA.
// Cenário coberto: a invocação vencedora da corrida do buffer (ver
// ai-agent-webhook) morre — timeout, erro de rede, crash — depois de anexar
// sua mensagem mas antes de completar o processamento, e o contato não manda
// nenhuma mensagem nova depois disso. Sem esta varredura, esse buffer ficaria
// travado (lock_token preenchido) para sempre. Agendado a cada 1 minuto via
// pg_cron (ver supabase/migrations/20260714_ai_agent_buffer_e_midia.sql).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Só considera "travado" um buffer parado há mais tempo que o maior
// buffer_segundos permitido (45s) somado a uma margem generosa para o
// processamento (transcrição/visão/chamada de IA/envio).
const LIMIAR_TRAVADO_MS = 2 * 60 * 1000

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  try {
    const limiar = new Date(Date.now() - LIMIAR_TRAVADO_MS).toISOString()

    const { data: travados, error } = await supabase
      .from('ai_buffer')
      .select('instancia_id, numero, lock_token')
      .not('lock_token', 'is', null)
      .lt('atualizado_em', limiar)
      .limit(50)

    if (error) throw error

    let processados = 0
    for (const row of travados ?? []) {
      if (!row.lock_token) continue
      console.log(`[ai-agent-buffer-sweep] reprocessando buffer travado instancia=${row.instancia_id} numero=${row.numero}`)
      await handleClaimedBuffer(supabase, row.instancia_id, row.numero, row.lock_token)
      processados++
    }

    console.log(`[ai-agent-buffer-sweep] concluído, ${processados} buffer(s) travado(s) verificado(s)`)
    return new Response(JSON.stringify({ ok: true, processados }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('[ai-agent-buffer-sweep] error:', e)
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
