import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  AIConfig,
  BufferItem,
  BufferItemTipo,
  appendToBuffer,
  handleClaimedBuffer,
  jidToPhone,
  sleep,
  toJid,
} from "../_shared/ai-agent-core.ts"

// Background tasks (Supabase Edge Runtime) — permite responder 200 ao
// webhook imediatamente e continuar processando depois, sem segurar a
// conexão do webhook (e sem risco de a uazapi reenviar por timeout).
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const ok = (extra?: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: true, ...extra }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  let rawText = ''
  try {
    rawText = await req.text()
    const body = JSON.parse(rawText)

    console.log('[ai-agent-webhook] PAYLOAD:', JSON.stringify(body).slice(0, 2000))

    // Extrai o tipo do evento (suporte a múltiplos formatos UAZAPI)
    const eventType: string = (
      (typeof body?.EventType === 'string' ? body.EventType : null) ??
      (typeof body?.eventType === 'string' ? body.eventType : null) ??
      (typeof body?.event === 'string' ? body.event : null) ??
      (typeof body?.type === 'string' ? body.type : null) ??
      ''
    ).toLowerCase()

    console.log(`[ai-agent-webhook] eventType="${eventType}"`)

    // Apenas processa eventos de mensagem recebida
    if (eventType !== 'messages' && eventType !== 'message') {
      return ok({ skipped: `not a messages event: ${eventType}` })
    }

    // Extrai dados da mensagem — nexus-360 manda o evento "messages" com o
    // objeto da mensagem em "message" (irmão de "EventType"/"chat"), confirmado
    // em produção via Monitor de Eventos. "event" fica como fallback defensivo
    // para outras variantes do uazapi que aninhem os dados diferente.
    const msg = body?.message && typeof body.message === 'object' && !Array.isArray(body.message)
      ? body.message as Record<string, unknown>
      : (body?.event && typeof body.event === 'object' && !Array.isArray(body.event)
        ? body.event as Record<string, unknown>
        : null)

    if (!msg) {
      return ok({ skipped: 'no message object' })
    }

    // Ignora mensagens enviadas por nós mesmos (ex: resposta manual no app da
    // uazapi) — sem isso, o webhook trataria nossa própria mensagem como se
    // fosse do contato e a IA responderia a si mesma.
    const fromMe: boolean = Boolean(msg?.fromMe ?? msg?.FromMe ?? false)
    if (fromMe) return ok({ skipped: 'message sent by us' })

    const fromRaw: string = String(msg?.chatid ?? msg?.ChatId ?? msg?.From ?? msg?.from ?? msg?.RemoteJid ?? msg?.remoteJid ?? '').trim()
    const isGroup: boolean = Boolean(msg?.isGroup ?? msg?.IsGroup) || Boolean(msg?.groupName) || fromRaw.includes('@g.us')
    // "type" no nexus-360 vem sempre "media" pra áudio/imagem/vídeo (não serve
    // pra diferenciar) — quem diferencia de verdade é "mediaType"
    // ("ptt"/"image"/"video"/…), confirmado com payloads reais; "messageType"
    // ("AudioMessage"/"ImageMessage"/…) fica como próximo fallback, e "type"
    // só entra por último (cobre o caso de texto, onde "media" nem existe).
    const rawType: string = String(msg?.mediaType ?? msg?.messageType ?? msg?.Type ?? msg?.type ?? msg?.MType ?? msg?.mtype ?? '').toLowerCase()
    // "content" vira OBJETO (URL/mimetype/mediaKey/…) em mensagens de mídia —
    // só usa como texto quando for string, senão messageBody viraria "[object Object]".
    const rawContent = msg?.content
    const messageBody: string = String(
      msg?.text ?? msg?.Text ?? (typeof rawContent === 'string' ? rawContent : '') ?? msg?.Body ?? msg?.body ?? ''
    ).trim()
    // Id da mensagem, necessário para baixar áudio/imagem via /message/download.
    // "messageid" é o id "puro" da mensagem no protocolo WhatsApp (confirmado em
    // payloads reais de áudio/imagem/vídeo); "id" no nexus-360 vem como
    // "OWNER:messageid" (uso interno deles) — por isso messageid tem prioridade.
    const mediaId: string = String(msg?.messageid ?? msg?.id ?? msg?.Id ?? msg?.ID ?? msg?.MessageID ?? '').trim()

    console.log(`[ai-agent-webhook] from="${fromRaw}" isGroup=${isGroup} type="${rawType}" body="${messageBody.slice(0, 100)}" mediaId="${mediaId}"`)

    if (isGroup) return ok({ skipped: 'group message' })

    // Classifica o tipo da mensagem
    let tipo: BufferItemTipo
    if (!rawType || rawType.includes('text') || rawType.includes('conversation') || rawType.includes('extendedtext')) {
      tipo = 'texto'
    } else if (rawType.includes('audio') || rawType.includes('ptt') || rawType.includes('voice')) {
      tipo = 'audio'
    } else if (rawType.includes('image') || rawType.includes('sticker')) {
      tipo = 'imagem'
    } else {
      tipo = 'outro'
    }

    if (tipo === 'texto' && !messageBody) return ok({ skipped: 'empty message body' })
    if ((tipo === 'audio' || tipo === 'imagem') && !mediaId) {
      console.log(`[ai-agent-webhook] tipo="${tipo}" sem id de mídia identificável, payload bruto da mensagem:`, JSON.stringify(msg).slice(0, 1000))
      return ok({ skipped: `media type "${tipo}" without identifiable message id` })
    }

    // Token da instância vem como query param
    const reqUrl = new URL(req.url)
    const token = reqUrl.searchParams.get('token')
    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing token' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Busca a instância pelo token
    const { data: instancia } = await supabase
      .from('instancias')
      .select('id, usuario_id, token')
      .eq('token', token)
      .maybeSingle()

    if (!instancia) {
      console.log(`[ai-agent-webhook] instância não encontrada para token=${token.slice(0, 10)}...`)
      return ok({ skipped: 'instance not found' })
    }

    const fromJid = toJid(fromRaw)
    const fromPhone = jidToPhone(fromJid)

    // Verifica se o contato está excluído
    const { data: excluido } = await supabase
      .from('ai_contatos_excluidos')
      .select('id')
      .eq('instancia_id', instancia.id)
      .eq('telefone', fromPhone)
      .maybeSingle()

    if (excluido) {
      return ok({ skipped: 'contact excluded' })
    }

    // Busca o agente de IA desta instância
    const { data: aiConfig } = await supabase
      .from('ai_configuracoes')
      .select('ativo, provedor, api_key, modelo, system_prompt, buffer_segundos, responder_audio, responder_imagem, openai_key_transcricao')
      .eq('instancia_id', instancia.id)
      .maybeSingle()

    if (!aiConfig?.ativo) {
      return ok({ skipped: 'AI not enabled for instance' })
    }

    if (!aiConfig?.api_key) {
      console.log(`[ai-agent-webhook] AI config sem chave de API para instância ${instancia.id}`)
      return ok({ skipped: 'AI config not found or missing API key' })
    }

    // Monta o item do buffer para esta mensagem
    const item: BufferItem = tipo === 'texto'
      ? { tipo, texto: messageBody, criado_em: new Date().toISOString() }
      : { tipo, media_id: mediaId || undefined, criado_em: new Date().toISOString() }

    const myToken = crypto.randomUUID()
    await appendToBuffer(supabase, instancia.id, fromPhone, item, myToken)

    const bufferSegundos = Math.max(0, Math.min(45, (aiConfig as AIConfig).buffer_segundos ?? 8))

    // Responde ao webhook imediatamente — o processamento (esperar a janela
    // de buffer, decidir quem responde, chamar a IA, enviar) continua em
    // background e não bloqueia a resposta HTTP.
    EdgeRuntime.waitUntil((async () => {
      try {
        if (bufferSegundos > 0) {
          await sleep(bufferSegundos * 1000)
        }
        await handleClaimedBuffer(supabase, instancia.id, fromPhone, myToken)
      } catch (e) {
        console.error('[ai-agent-webhook] erro no processamento em background:', e)
      }
    })())

    return ok({ buffered: true, tipo })

  } catch (e) {
    console.error('[ai-agent-webhook] error:', e, 'raw:', rawText.slice(0, 500))
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
