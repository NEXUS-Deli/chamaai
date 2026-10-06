// Núcleo compartilhado do agente de IA — usado por ai-agent-webhook (caminho
// rápido, por mensagem) e ai-agent-buffer-sweep (rede de segurança, por cron).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

export const UAZAPI_BASE_URL = Deno.env.get('UAZAPI_BASE_URL') ?? 'https://nexus-360.uazapi.com'

export type AIProvider = 'openai' | 'claude' | 'gemini' | 'groq'

// ── Configuração global da IA (fornecida pelo sistema) ──────────────────────
// A chave fica SOMENTE nos segredos das Edge Functions (Supabase → Edge Functions
// → Secrets). Nunca é gravada no banco nem enviada ao navegador. Provedor e
// modelo também são definidos aqui — o que estiver na linha do agente é ignorado.
const AI_OPENAI_API_KEY = (Deno.env.get('AI_OPENAI_API_KEY') ?? '').trim()
const AI_MODEL = (Deno.env.get('AI_MODEL') ?? '').trim() || 'gpt-4o-mini'

function intEnv(name: string, padrao: number): number {
  const n = Number(Deno.env.get(name))
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : padrao
}

/** Travas contra gasto descontrolado (ajustáveis por segredo, sem novo deploy). */
export const LIMITES = {
  respostasPorUsuarioDia: intEnv('AI_LIMITE_USUARIO_DIA', 300),
  respostasGlobalDia: intEnv('AI_LIMITE_GLOBAL_DIA', 3000),
  respostasPorContatoHora: intEnv('AI_LIMITE_CONTATO_HORA', 20),
  maxTokensResposta: 500,
  maxCaracteresEntrada: 4000,
  maxImagensPorLote: 2,
  maxTentativas: 3,
}

export function aiGlobalConfigurada(): boolean {
  return AI_OPENAI_API_KEY.length > 0
}

/** Aplica provedor/modelo/chave globais sobre a configuração do agente. */
function aplicarConfigGlobal(row: Record<string, unknown>): AIConfig {
  return {
    ...(row as unknown as AIConfig),
    provedor: 'openai',
    api_key: AI_OPENAI_API_KEY,
    modelo: AI_MODEL,
    openai_key_transcricao: AI_OPENAI_API_KEY,
  }
}

export interface AIConfig {
  provedor: AIProvider
  api_key: string
  modelo: string | null
  system_prompt: string | null
  buffer_segundos: number
  responder_audio: boolean
  responder_imagem: boolean
  openai_key_transcricao: string | null
  restringir_horario: boolean
  horario_inicio: string
  horario_fim: string
  dias_semana: number[]
  mensagem_fora_horario: string | null
  transferencia_ativa: boolean
  transferencia_telefone: string | null
  /** JID de número ou grupo que recebe o aviso de transferência */
  transferencia_destino: string | null
}

/** Marca que a IA inclui no final da resposta quando decide transferir para um humano — removida antes de qualquer envio/gravação. */
export const HANDOFF_MARKER = '[[TRANSFERIR_HUMANO]]'

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
  /** Quantas vezes o lote com este item já falhou (descartado ao atingir LIMITES.maxTentativas) */
  tentativas?: number
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

/** Checa se `at` cai dentro do horário/dias configurados do agente (BRT = UTC-3, mesmo cálculo usado em disparo-cron's estaNoHorario). */
export function isWithinBusinessHours(
  cfg: { horario_inicio: string; horario_fim: string; dias_semana: number[] },
  at: Date = new Date(),
): boolean {
  const horaBRT = (at.getUTCHours() - 3 + 24) % 24
  const minBRT = at.getUTCMinutes()
  const diaBRT = new Date(at.getTime() - 3 * 60 * 60 * 1000).getUTCDay()

  if (!cfg.dias_semana.includes(diaBRT)) return false

  const total = horaBRT * 60 + minBRT
  const [hI, mI] = cfg.horario_inicio.split(':').map(Number)
  const [hF, mF] = cfg.horario_fim.split(':').map(Number)
  const inicioMin = hI * 60 + mI
  const fimMin = (hF === 0 && mF === 0) ? 24 * 60 : hF * 60 + mF
  return total >= inicioMin && total <= fimMin
}

// ── uazapi: envio e download de mídia ───────────────────────────────────────

interface SendTextOptions {
  /** Marca o chat inteiro como lido (remove o contador de não lidas) */
  readchat?: boolean
  /** Marca as últimas mensagens recebidas do contato como lidas (double-check azul) */
  readmessages?: boolean
}

export async function sendText(jid: string, text: string, token: string, opts: SendTextOptions = {}): Promise<void> {
  try {
    const body: Record<string, unknown> = { number: jid, text }
    if (opts.readchat) body.readchat = true
    if (opts.readmessages) body.readmessages = true
    await fetch(`${UAZAPI_BASE_URL}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', token },
      body: JSON.stringify(body),
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
  // Via RPC (não .update().select() direto): UPDATE...RETURNING sempre
  // devolve o valor DEPOIS da alteração — como aqui "mensagens" é zerado na
  // mesma instrução, .update().select() sempre devolveria array vazio. A
  // função ai_buffer_claim captura o valor de antes via CTE (ver migration
  // 20260722_ai_buffer_claim_fix.sql).
  const { data, error } = await supabase.rpc('ai_buffer_claim', {
    p_instancia_id: instanciaId,
    p_numero: numero,
    p_token: token,
  })

  if (error) {
    console.error('[ai-agent-core] claimBuffer error:', error)
    return null
  }
  if (data === null) return null
  return (data ?? []) as BufferItem[]
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
      // Instrução direta: um texto entre colchetes ("[enviou uma imagem]") fazia o modelo
      // achar que a imagem não tinha chegado e responder "não consigo visualizar".
      texto: 'O cliente enviou a imagem anexada a esta mensagem. Analise o que aparece nela e responda com base no conteúdo da imagem.',
      imagem: { type: 'image', mimeType: result.mimetype, base64: result.base64Data },
    }
  }

  // vídeo, documento, figurinha, localização, contato, ou qualquer outro tipo
  // ainda não suportado automaticamente — reconhece o recebimento sem travar
  return { texto: '[O contato enviou um arquivo de mídia (vídeo, documento ou outro tipo) que ainda não pode ser analisado automaticamente. Responda de forma natural, reconhecendo o recebimento e pedindo mais contexto se fizer sentido.]' }
}

// ── Chamada ao provedor de IA (multimodal: texto + imagens do turno atual) ─

export interface AIResult {
  texto: string
  tokensEntrada: number
  tokensSaida: number
}

export async function callAI(
  config: AIConfig,
  history: ConversaMessage[],
  currentText: string,
  currentImages: ContentPart[],
): Promise<AIResult> {
  const model = config.modelo || DEFAULT_MODELS[config.provedor] || DEFAULT_MODELS.openai
  let systemPrompt = config.system_prompt || 'Você é um assistente útil do WhatsApp. Responda de forma breve e natural em português.'
  if (config.transferencia_ativa) {
    systemPrompt += `\n\nSe o cliente pedir para falar com um atendente humano, ou se a situação estiver além do que você consegue resolver, termine sua resposta incluindo exatamente a marca ${HANDOFF_MARKER} (o cliente nunca vê essa marca — ela é removida automaticamente antes do envio).`
  }
  if (currentImages.length > 0) {
    systemPrompt += '\n\nVocê CONSEGUE ver as imagens enviadas pelo cliente: elas chegam anexadas à mensagem dele. Analise o conteúdo visual (objetos, textos, documentos, produtos, prints) e responda com base no que vê. Nunca diga que não consegue ver ou abrir imagens — mesmo que tenha dito isso antes nesta conversa.'
  }
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
        max_tokens: LIMITES.maxTokensResposta,
        system: systemPrompt,
        messages: [...historyMessages, { role: 'user', content: contentBlocks }],
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`)
    }
    const data = await res.json()
    return { texto: data.content[0].text, tokensEntrada: data.usage?.input_tokens ?? 0, tokensSaida: data.usage?.output_tokens ?? 0 }
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
        generationConfig: { maxOutputTokens: LIMITES.maxTokensResposta },
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Gemini API ${res.status}: ${err.slice(0, 200)}`)
    }
    const data = await res.json()
    return {
      texto: data.candidates[0].content.parts[0].text,
      tokensEntrada: data.usageMetadata?.promptTokenCount ?? 0,
      tokensSaida: data.usageMetadata?.candidatesTokenCount ?? 0,
    }
  }

  // OpenAI e Groq (API compatível)
  const baseUrl = config.provedor === 'groq'
    ? 'https://api.groq.com/openai/v1'
    : 'https://api.openai.com/v1'

  const userContent = currentImages.length > 0
    ? [
        { type: 'text', text: currentText },
        // detail "low": imagem analisada em 512px — custo fixo, cerca de 13x menor que "auto"/"high"
        ...currentImages.map(img => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: 'low' } })),
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
      max_tokens: LIMITES.maxTokensResposta,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`${config.provedor} API ${res.status}: ${err.slice(0, 200)}`)
  }
  const data = await res.json()
  const texto = data.choices?.[0]?.message?.content
  if (typeof texto !== 'string' || !texto.trim()) throw new Error(`${config.provedor} API: resposta vazia`)
  return { texto, tokensEntrada: data.usage?.prompt_tokens ?? 0, tokensSaida: data.usage?.completion_tokens ?? 0 }
}

// ── Fora do horário comercial configurado: caminho leve, sem IA ─────────────

async function handleOutsideHours(
  supabase: SupabaseClient,
  instancia: InstanciaInfo,
  fromJid: string,
  fromPhone: string,
  aiConfig: AIConfig,
  items: BufferItem[],
): Promise<void> {
  const combinedText = items
    .map(i => i.tipo === 'texto' ? (i.texto ?? '') : `[${i.tipo}]`)
    .filter(Boolean)
    .join('\n')

  await supabase.from('ai_conversas').insert({
    usuario_id: instancia.usuario_id,
    instancia_id: instancia.id,
    numero: fromPhone,
    role: 'user',
    mensagem: combinedText || '[mensagem fora do horário comercial]',
  })

  // Envia a mensagem automática no máximo uma vez a cada 12h por contato (evita repetir a cada mensagem)
  const dozeHorasAtras = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  const { count: avisosRecentes } = await supabase
    .from('ai_conversas')
    .select('id', { count: 'exact', head: true })
    .eq('instancia_id', instancia.id)
    .eq('numero', fromPhone)
    .eq('role', 'assistant')
    .eq('mensagem', aiConfig.mensagem_fora_horario ?? '')
    .gte('criado_em', dozeHorasAtras)

  if (aiConfig.mensagem_fora_horario?.trim() && (avisosRecentes ?? 0) === 0) {
    await sendText(fromJid, aiConfig.mensagem_fora_horario, instancia.token, { readchat: true, readmessages: true })
    await supabase.from('ai_conversas').insert({
      usuario_id: instancia.usuario_id,
      instancia_id: instancia.id,
      numero: fromPhone,
      role: 'assistant',
      mensagem: aiConfig.mensagem_fora_horario,
    })
  }

  console.log(`[ai-agent-core] fora do horário comercial configurado — ${fromPhone} não foi processado pela IA`)
}

// ── Transferência para atendimento humano ───────────────────────────────────

async function handleHandoff(
  supabase: SupabaseClient,
  instancia: InstanciaInfo,
  fromPhone: string,
  aiConfig: AIConfig,
  ultimaMensagem: string,
): Promise<void> {
  // A IA para de responder este contato até um humano removê-lo da lista de
  // Contatos Excluídos (já existente na página do agente).
  await supabase.from('ai_contatos_excluidos').upsert({
    usuario_id: instancia.usuario_id,
    instancia_id: instancia.id,
    telefone: fromPhone,
    nome: 'Transferido para atendimento humano',
  }, { onConflict: 'instancia_id,telefone' })

  const resumo = ultimaMensagem.slice(0, 200)
  const aviso = `🔔 *Lead aguardando atendimento humano*\n\n` +
    `Contato: +${fromPhone}\n` +
    `Conversar: https://wa.me/${fromPhone}\n` +
    `Última mensagem: "${resumo}"\n\n` +
    `A IA parou de responder este contato. Para reativar, remova-o de "Contatos Excluídos" no Atendimento com IA.`

  // Destino escolhido na tela (número ou grupo); "transferencia_telefone" é o formato antigo
  const destino = aiConfig.transferencia_destino
    || (aiConfig.transferencia_telefone ? toJid(aiConfig.transferencia_telefone) : null)
  if (destino) {
    await sendText(destino, aviso, instancia.token)
  } else {
    console.warn(`[ai-agent-core] transferência de ${fromPhone} sem destino configurado — só notificação no painel`)
  }

  await supabase.from('notificacoes').insert({
    usuario_id: instancia.usuario_id,
    titulo: 'Cliente pediu atendimento humano',
    mensagem: `${fromPhone}: "${resumo}"`,
    tipo: 'aviso',
    link: `/atendimento-ia/${instancia.id}`,
  })
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
    // Trava 1: limite de respostas por contato por hora (evita loop com outro robô / abuso)
    const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count: respostasUltimaHora } = await supabase
      .from('ai_conversas')
      .select('id', { count: 'exact', head: true })
      .eq('instancia_id', instancia.id)
      .eq('numero', fromPhone)
      .eq('role', 'assistant')
      .gte('criado_em', umaHoraAtras)
    if ((respostasUltimaHora ?? 0) >= LIMITES.respostasPorContatoHora) {
      console.warn(`[ai-agent-core] limite por contato atingido (${respostasUltimaHora}/h) para ${fromPhone} — lote ignorado`)
      return
    }

    // Trava 2: cota diária por usuário + teto global (atômico no banco)
    const { data: cota, error: cotaErr } = await supabase.rpc('ai_consumir_cota', {
      p_usuario_id: instancia.usuario_id,
      p_limite_usuario: LIMITES.respostasPorUsuarioDia,
      p_limite_global: LIMITES.respostasGlobalDia,
    })
    if (cotaErr) throw new Error(`ai_consumir_cota: ${cotaErr.message}`)
    if (cota !== 'ok') {
      console.warn(`[ai-agent-core] cota "${cota}" atingida (usuário ${instancia.usuario_id}) — ${fromPhone} não respondido`)
      const { data: primeiroAviso } = await supabase.rpc('ai_marcar_aviso_limite', { p_usuario_id: instancia.usuario_id })
      if (primeiroAviso === true) {
        await supabase.from('notificacoes').insert({
          usuario_id: instancia.usuario_id,
          titulo: 'Limite diário do Atendimento com IA atingido',
          mensagem: cota === 'limite_usuario'
            ? `O agente respondeu ${LIMITES.respostasPorUsuarioDia} mensagens hoje e pausou até amanhã.`
            : 'O agente foi pausado temporariamente pelo limite do sistema e volta amanhã.',
          tipo: 'aviso',
          link: '/atendimento-ia',
        })
      }
      return
    }

    const resolved: ResolvedItem[] = []
    for (const item of items) {
      resolved.push(await resolveBufferItem(item, aiConfig, instancia.token))
    }

    // Trava 3: tamanho da entrada e quantidade de imagens por chamada
    const combinedText = resolved.map(r => r.texto).filter(Boolean).join('\n').slice(0, LIMITES.maxCaracteresEntrada)
    const images = resolved.flatMap(r => r.imagem ? [r.imagem] : []).slice(0, LIMITES.maxImagensPorLote)

    const { data: historico } = await supabase
      .from('ai_conversas')
      .select('role, mensagem')
      .eq('instancia_id', instancia.id)
      .eq('numero', fromPhone)
      .order('criado_em', { ascending: false })
      .limit(20)

    const history: ConversaMessage[] = ((historico ?? []) as ConversaMessage[]).reverse()

    await sendComposing(fromJid, instancia.token)

    const ai = await callAI(aiConfig, history, combinedText, images)
    const aiResponse = ai.texto
    console.log(`[ai-agent-core] AI response (${aiConfig.provedor}/${aiConfig.modelo}, ${ai.tokensEntrada}+${ai.tokensSaida} tokens): ${aiResponse.slice(0, 200)}`)
    await supabase.rpc('ai_registrar_tokens', {
      p_usuario_id: instancia.usuario_id,
      p_entrada: ai.tokensEntrada,
      p_saida: ai.tokensSaida,
    })

    // Grava a mensagem do contato só depois da IA responder (evita duplicar no histórico em caso de nova tentativa)
    await supabase.from('ai_conversas').insert({
      usuario_id: instancia.usuario_id,
      instancia_id: instancia.id,
      numero: fromPhone,
      role: 'user',
      mensagem: combinedText,
    })

    const wantsHandoff = aiConfig.transferencia_ativa && aiResponse.includes(HANDOFF_MARKER)
    const respostaFinal = aiResponse.split(HANDOFF_MARKER).join('').trim()
      || (wantsHandoff ? 'Vou te transferir para um atendente, aguarde um instante.' : aiResponse)

    const parts = splitMessage(respostaFinal)
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        await sleep(800)
        await sendComposing(fromJid, instancia.token)
        await sleep(600)
      }
      // Marca o chat e as últimas mensagens do contato como lidas junto com a
      // primeira parte da resposta — só precisa acontecer uma vez por lote,
      // deixa a conversa com o double-check azul como um atendimento humano real.
      await sendText(fromJid, parts[i], instancia.token, i === 0 ? { readchat: true, readmessages: true } : undefined)
    }

    await supabase.from('ai_conversas').insert({
      usuario_id: instancia.usuario_id,
      instancia_id: instancia.id,
      numero: fromPhone,
      role: 'assistant',
      mensagem: respostaFinal,
    })

    if (wantsHandoff) {
      await handleHandoff(supabase, instancia, fromPhone, aiConfig, combinedText)
    }

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
    // Reinsere para nova tentativa, até LIMITES.maxTentativas (evita repetir para sempre, ex.: chave inválida)
    const retentaveis = items
      .map(item => ({ ...item, tentativas: (item.tentativas ?? 0) + 1 }))
      .filter(item => item.tentativas < LIMITES.maxTentativas)
    console.error(`[ai-agent-core] erro processando lote de ${fromPhone} — ${retentaveis.length}/${items.length} item(ns) reinserido(s) para nova tentativa:`, e)
    const retryToken = crypto.randomUUID()
    for (const item of retentaveis) {
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

  const { data: excluido } = await supabase
    .from('ai_contatos_excluidos')
    .select('id')
    .eq('instancia_id', instanciaId)
    .eq('telefone', numero)
    .maybeSingle()
  if (excluido) return

  const { data: aiConfigRow } = await supabase
    .from('ai_configuracoes')
    .select('ativo, system_prompt, buffer_segundos, responder_audio, responder_imagem, restringir_horario, horario_inicio, horario_fim, dias_semana, mensagem_fora_horario, transferencia_ativa, transferencia_telefone, transferencia_destino')
    .eq('instancia_id', instanciaId)
    .maybeSingle()
  if (!aiConfigRow?.ativo) return

  if (!aiGlobalConfigurada()) {
    console.error('[ai-agent-core] segredo AI_OPENAI_API_KEY não configurado — agente não pode responder')
    return
  }
  const aiConfig = aplicarConfigGlobal(aiConfigRow)

  if (aiConfig.restringir_horario && !isWithinBusinessHours(aiConfig)) {
    await handleOutsideHours(supabase, { id: instancia.id, usuario_id: instancia.usuario_id, token: instancia.token }, toJid(numero), numero, aiConfig, items)
    return
  }

  await processarLote(
    supabase,
    { id: instancia.id, usuario_id: instancia.usuario_id, token: instancia.token },
    toJid(numero),
    numero,
    aiConfig,
    items,
  )
}
