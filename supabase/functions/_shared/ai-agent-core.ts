// Núcleo compartilhado do agente de IA — usado por ai-agent-webhook (caminho
// rápido, por mensagem) e ai-agent-buffer-sweep (rede de segurança, por cron).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

export const UAZAPI_BASE_URL = Deno.env.get('UAZAPI_BASE_URL') ?? 'https://nexus-360.uazapi.com'

export type AIProvider = 'openai' | 'claude' | 'gemini' | 'groq'

export interface AIConfig {
  provedor: AIProvider
  api_key: string
  modelo: string | null
  system_prompt: string | null
  buffer_segundos: number
  responder_audio: boolean
  responder_imagem: boolean
  openai_key_transcricao: string | null
}

export interface ConversaMessage {
  role: 'user' | 'assistant'
  mensagem: string
}

export type BufferItemTipo = 'texto' | 'audio' | 'imagem' | 'outro'

export interface BufferItem {
  tipo: BufferItemTipo
  texto?: string
  media_id?: string
  criado_em: string
}

export interface ContentPart {
  type: 'image'
  mimeType: string
  base64: string
}

interface ResolvedItem {
  texto: string
  imagem?: ContentPart
}

export interface InstanciaInfo {
  id: string
  usuario_id: string
  token: string
}

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: 'gpt-4o-mini',
  claude: 'claude-haiku-4-5-20251001',
  gemini: 'gemini-2.0-flash',
  groq: 'llama-3.1-8b-instant',
}

// Modelos com suporte a visão (análise de imagem) por provedor, restrito aos
// modelos hoje oferecidos em src/routes/_authenticated/atendimento-ia.tsx.
const VISION_MODELS: Record<AIProvider, Set<string> | 'all' | 'none'> = {
  openai: new Set(['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']),
  claude: 'all',
  gemini: 'all',
  groq: 'none',
}

export function isVisionCapable(provedor: AIProvider, modelo: string): boolean {
  const rule = VISION_MODELS[provedor]
  if (rule === 'all') return true
  if (rule === 'none') return false
  return rule.has(modelo)
}

// ── Utilidades gerais ───────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function jidToPhone(jid: string): string {
  return jid.replace(/@s\.whatsapp\.net$/, '').replace(/@c\.us$/, '').replace(/\D/g, '')
}

export function toJid(number: string): string {
  if (number.includes('@')) return number
  const clean = number.replace(/\D/g, '')
  return `${clean}@s.whatsapp.net`
}

export function splitMessage(text: string): string[] {
  const parts = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0)
  return parts.length > 1 ? parts : [text.trim()]
}

// ── uazapi: envio e download de mídia ───────────────────────────────────────

export async function sendText(jid: string, text: string, token: string): Promise<void> {
  try {
    await fetch(`${UAZAPI_BASE_URL}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', token },
      body: JSON.stringify({ number: jid, text }),
    })
  } catch (e) {
    console.error('[ai-agent-core] sendText error:', e)
  }
}

export async function sendComposing(jid: string, token: string): Promise<void> {
  try {
    await fetch(`${UAZAPI_BASE_URL}/chat/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({ number: jid, action: 'composing' }),
    })
  } catch { /* silently ignore */ }
}

interface DownloadMediaOptions {
  transcribe?: boolean
  openaiApiKey?: string | null
  returnBase64?: boolean
}

interface DownloadMediaResult {
  base64Data?: string
  mimetype?: string
  transcription?: string
}

async function downloadMedia(
  messageId: string,
  token: string,
  opts: DownloadMediaOptions = {},
): Promise<DownloadMediaResult | null> {
  try {
    const body: Record<string, unknown> = {
      id: messageId,
      return_link: false,
      return_base64: opts.returnBase64 ?? false,
    }
    if (opts.transcribe) {
      body.transcribe = true
      body.generate_mp3 = false
      if (opts.openaiApiKey) body.openai_apikey = opts.openaiApiKey
    }
    const res = await fetch(`${UAZAPI_BASE_URL}/message/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', token },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.error(`[ai-agent-core] downloadMedia ${res.status}: ${(await res.text()).slice(0, 300)}`)
      return null
    }
    return await res.json()
  } catch (e) {
    console.error('[ai-agent-core] downloadMedia error:', e)
    return null
  }
}

// ── Buffer de mensagens (debounce sem cron de segundos) ─────────────────────

/**
 * Upsert atômico no Postgres: anexa o item ao array cumulativo e assume o
 * lock_token mais recente. Cada mensagem recebida chama isso; depois da
 * janela de buffer, só quem ainda detém o lock_token mais recente processa
 * o lote inteiro (ver claimBuffer).
 */
export async function appendToBuffer(
  supabase: SupabaseClient,
  instanciaId: string,
  numero: string,
  item: BufferItem,
  token: string,
): Promise<void> {
  const { error } = await supabase.rpc('ai_buffer_append', {
    p_instancia_id: instanciaId,
    p_numero: numero,
    p_item: item,
    p_token: token,
  })
  if (error) console.error('[ai-agent-core] appendToBuffer error:', error)
}

/**
 * Tenta reivindicar o buffer: só sucede (retorna os itens) se `lock_token`
 * ainda for exatamente `token` no momento do UPDATE — compare-and-swap
 * atômico garantido pelo Postgres. Se outra mensagem chegou nesse meio
 * tempo (lock_token mudou), retorna null e essa invocação desiste.
 */
export async function claimBuffer(
  supabase: SupabaseClient,
  instanciaId: string,
  numero: string,
  token: string,
): Promise<BufferItem[] | null> {
  const { data, error } = await supabase
    .from('ai_buffer')
    .update({ mensagens: [], lock_token: null })
    .eq('instancia_id', instanciaId)
    .eq('numero', numero)
    .eq('lock_token', token)
    .select('mensagens')
    .maybeSingle()

  if (error) {
    console.error('[ai-agent-core] claimBuffer error:', error)
    return null
  }
  if (!data) return null
  return (data.mensagens ?? []) as BufferItem[]
}

// ── Resolução de itens do buffer (texto / áudio transcrito / imagem) ───────

async function resolveBufferItem(item: BufferItem, aiConfig: AIConfig, token: string): Promise<ResolvedItem> {
  if (item.tipo === 'texto') {
    return { texto: item.texto ?? '' }
  }

  if (item.tipo === 'audio') {
    if (!aiConfig.responder_audio || !item.media_id) {
      return { texto: '[O contato enviou um áudio, mas a transcrição de áudio está desativada nas configurações do agente.]' }
    }
    const openaiKey = aiConfig.provedor === 'openai' ? aiConfig.api_key : aiConfig.openai_key_transcricao
    if (!openaiKey) {
      return { texto: '[O contato enviou um áudio, mas não há uma chave OpenAI configurada para transcrição. Peça, de forma natural, para ele escrever a mensagem.]' }
    }
    const result = await downloadMedia(item.media_id, token, { transcribe: true, openaiApiKey: openaiKey })
    if (!result?.transcription) {
      return { texto: '[O contato enviou um áudio, mas não foi possível transcrevê-lo agora. Peça, de forma natural, para ele escrever a mensagem ou tentar enviar o áudio novamente.]' }
    }
    return { texto: `[Mensagem de voz transcrita]: ${result.transcription}` }
  }

  if (item.tipo === 'imagem') {
    if (!aiConfig.responder_imagem || !item.media_id) {
      return { texto: '[O contato enviou uma imagem, mas a análise de imagens está desativada nas configurações do agente.]' }
    }
    const modelo = aiConfig.modelo || DEFAULT_MODELS[aiConfig.provedor]
    if (!isVisionCapable(aiConfig.provedor, modelo)) {
      return { texto: '[O contato enviou uma imagem, mas o modelo de IA configurado atualmente não suporta análise de imagens.]' }
    }
    const result = await downloadMedia(item.media_id, token, { returnBase64: true })
    if (!result?.base64Data || !result.mimetype) {
      return { texto: '[O contato enviou uma imagem, mas não foi possível baixá-la para análise agora.]' }
    }
    return {
      texto: '[O contato enviou uma imagem — veja o conteúdo anexado]',
      imagem: { type: 'image', mimeType: result.mimetype, base64: result.base64Data },
    }
  }

  // vídeo, documento, figurinha, localização, contato, ou qualquer outro tipo
  // ainda não suportado automaticamente — reconhece o recebimento sem travar
  return { texto: '[O contato enviou um arquivo de mídia (vídeo, documento ou outro tipo) que ainda não pode ser analisado automaticamente. Responda de forma natural, reconhecendo o recebimento e pedindo mais contexto se fizer sentido.]' }
}

// ── Chamada ao provedor de IA (multimodal: texto + imagens do turno atual) ─

export async function callAI(
  config: AIConfig,
  history: ConversaMessage[],
  currentText: string,
  currentImages: ContentPart[],
): Promise<string> {
  const model = config.modelo || DEFAULT_MODELS[config.provedor] || DEFAULT_MODELS.openai
  const systemPrompt = config.system_prompt || 'Você é um assistente útil do WhatsApp. Responda de forma breve e natural em português.'
  const historyMessages = history.map(h => ({ role: h.role, content: h.mensagem }))

  if (config.provedor === 'claude') {
    // deno-lint-ignore no-explicit-any
    const contentBlocks: any[] = [{ type: 'text', text: currentText }]
    for (const img of currentImages) {
      contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } })
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.api_key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [...historyMessages, { role: 'user', content: contentBlocks }],
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`)
    }
    const data = await res.json()
    return data.content[0].text
  }

  if (config.provedor === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.api_key}`
    // deno-lint-ignore no-explicit-any
    const currentParts: any[] = [{ text: currentText }]
    for (const img of currentImages) {
      currentParts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } })
    }
    const geminiContents = [
      ...history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.mensagem }],
      })),
      { role: 'user', parts: currentParts },
    ]
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: geminiContents,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Gemini API ${res.status}: ${err.slice(0, 200)}`)
    }
    const data = await res.json()
    return data.candidates[0].content.parts[0].text
  }

  // OpenAI e Groq (API compatível)
  const baseUrl = config.provedor === 'groq'
    ? 'https://api.groq.com/openai/v1'
    : 'https://api.openai.com/v1'

  const userContent = currentImages.length > 0
    ? [
        { type: 'text', text: currentText },
        ...currentImages.map(img => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } })),
      ]
    : currentText

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
        { role: 'user', content: userContent },
      ],
      max_tokens: 1000,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`${config.provedor} API ${res.status}: ${err.slice(0, 200)}`)
  }
  const data = await res.json()
  return data.choices[0].message.content
}

// ── Processamento de um lote já reivindicado do buffer ──────────────────────

export async function processarLote(
  supabase: SupabaseClient,
  instancia: InstanciaInfo,
  fromJid: string,
  fromPhone: string,
  aiConfig: AIConfig,
  items: BufferItem[],
): Promise<void> {
  if (items.length === 0) return

  try {
    const resolved: ResolvedItem[] = []
    for (const item of items) {
      resolved.push(await resolveBufferItem(item, aiConfig, instancia.token))
    }

    const combinedText = resolved.map(r => r.texto).filter(Boolean).join('\n')
    const images = resolved.flatMap(r => r.imagem ? [r.imagem] : [])

    const { data: historico } = await supabase
      .from('ai_conversas')
      .select('role, mensagem')
      .eq('instancia_id', instancia.id)
      .eq('numero', fromPhone)
      .order('criado_em', { ascending: false })
      .limit(20)

    const history: ConversaMessage[] = ((historico ?? []) as ConversaMessage[]).reverse()

    await supabase.from('ai_conversas').insert({
      usuario_id: instancia.usuario_id,
      instancia_id: instancia.id,
      numero: fromPhone,
      role: 'user',
      mensagem: combinedText,
    })

    await sendComposing(fromJid, instancia.token)

    const aiResponse = await callAI(aiConfig, history, combinedText, images)
    console.log(`[ai-agent-core] AI response (${aiConfig.provedor}): ${aiResponse.slice(0, 200)}`)

    const parts = splitMessage(aiResponse)
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        await sleep(800)
        await sendComposing(fromJid, instancia.token)
        await sleep(600)
      }
      await sendText(fromJid, parts[i], instancia.token)
    }

    await supabase.from('ai_conversas').insert({
      usuario_id: instancia.usuario_id,
      instancia_id: instancia.id,
      numero: fromPhone,
      role: 'assistant',
      mensagem: aiResponse,
    })

    const { data: oldMsgs } = await supabase
      .from('ai_conversas')
      .select('id')
      .eq('instancia_id', instancia.id)
      .eq('numero', fromPhone)
      .order('criado_em', { ascending: false })
      .range(40, 500)

    if (oldMsgs && oldMsgs.length > 0) {
      await supabase.from('ai_conversas').delete().in('id', (oldMsgs as { id: string }[]).map(m => m.id))
    }

    console.log(`[ai-agent-core] ✅ respondido para ${fromPhone} (${parts.length} parte(s), ${items.length} msg(s) no lote)`)
  } catch (e) {
    console.error(`[ai-agent-core] erro processando lote de ${fromPhone}, reinserindo no buffer para nova tentativa:`, e)
    const retryToken = crypto.randomUUID()
    for (const item of items) {
      await appendToBuffer(supabase, instancia.id, fromPhone, item, retryToken)
    }
  }
}

/**
 * Ponto de entrada único para "tentei reivindicar este buffer e, se eu
 * vencer, processo o lote inteiro" — usado tanto pelo ai-agent-webhook
 * (depois do sleep da janela de buffer) quanto pelo ai-agent-buffer-sweep
 * (rede de segurança para buffers travados).
 */
export async function handleClaimedBuffer(
  supabase: SupabaseClient,
  instanciaId: string,
  numero: string,
  lockToken: string,
): Promise<void> {
  const items = await claimBuffer(supabase, instanciaId, numero, lockToken)
  if (!items || items.length === 0) return

  const { data: instancia } = await supabase
    .from('instancias')
    .select('id, usuario_id, token')
    .eq('id', instanciaId)
    .maybeSingle()

  if (!instancia?.token) {
    console.error(`[ai-agent-core] instância ${instanciaId} sem token utilizável; descartando lote de ${numero}`)
    return
  }

  const { data: aiInst } = await supabase
    .from('ai_instancias')
    .select('ativo')
    .eq('instancia_id', instanciaId)
    .maybeSingle()
  if (!aiInst?.ativo) return

  const { data: excluido } = await supabase
    .from('ai_contatos_excluidos')
    .select('id')
    .eq('instancia_id', instanciaId)
    .eq('telefone', numero)
    .maybeSingle()
  if (excluido) return

  const { data: aiConfigRow } = await supabase
    .from('ai_configuracoes')
    .select('provedor, api_key, modelo, system_prompt, buffer_segundos, responder_audio, responder_imagem, openai_key_transcricao')
    .eq('usuario_id', instancia.usuario_id)
    .maybeSingle()
  if (!aiConfigRow?.api_key) return

  await processarLote(
    supabase,
    { id: instancia.id, usuario_id: instancia.usuario_id, token: instancia.token },
    toJid(numero),
    numero,
    aiConfigRow as AIConfig,
    items,
  )
}
