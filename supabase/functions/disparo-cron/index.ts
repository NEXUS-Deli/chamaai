import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UAZAPI_BASE_URL = Deno.env.get('UAZAPI_BASE_URL') ?? 'https://nexus-360.uazapi.com'
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

// ── Utilities ──────────────────────────────────────────────────────────────

function formatarTelefone(phone: string): string {
  phone = phone.replace(/\D/g, '')
  if (phone.startsWith('55') && phone.length > 11) phone = phone.slice(2)
  const ddd = phone.slice(0, 2)
  let numero = phone.slice(2)
  if (numero.length === 8 && ['6', '7', '8', '9'].includes(numero[0])) numero = '9' + numero
  if (numero.length > 9) numero = numero.slice(-9)
  return ddd + numero
}

function estaNoHorario(inicio: string, fim: string): boolean {
  const agora = new Date()
  const horaBRT = (agora.getUTCHours() - 3 + 24) % 24
  const minBRT = agora.getUTCMinutes()
  const total = horaBRT * 60 + minBRT
  const [hI, mI] = inicio.split(':').map(Number)
  const [hF, mF] = fim.split(':').map(Number)
  const inicioMin = hI * 60 + mI
  // "00:00" como fim significa meia-noite = fim do dia
  const fimMin = (hF === 0 && mF === 0) ? 24 * 60 : hF * 60 + mF
  return total >= inicioMin && total <= fimMin
}

function randomEntre(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function escolherAleatorio<T>(arr: T[]): T | null {
  if (!arr?.length) return null
  return arr[Math.floor(Math.random() * arr.length)]
}

// ── uazapi Integration ─────────────────────────────────────────────────────

async function verificarWhatsApp(
  telefone: string,
  token: string,
): Promise<{ isInWhatsapp: boolean; jid?: string }> {
  try {
    const res = await fetch(`${UAZAPI_BASE_URL}/chat/check`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', token },
      body: JSON.stringify({ numbers: [telefone] }),
    })
    if (!res.ok) return { isInWhatsapp: false }
    const data = await res.json() as Array<{ query: string; isInWhatsapp: boolean; jid: string }>
    return data[0] ?? { isInWhatsapp: false }
  } catch {
    return { isInWhatsapp: false }
  }
}

// Returns messageId on success, null on failure
async function enviarTexto(jid: string, texto: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`${UAZAPI_BASE_URL}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', token },
      body: JSON.stringify({ number: jid, text: texto }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.key?.id ?? data?.id ?? null
  } catch { return null }
}

// Returns messageId on success, null on failure
async function enviarMidia(
  jid: string,
  url: string,
  tipo: string,
  nomeArquivo: string,
  legenda: string,
  token: string,
): Promise<string | null> {
  try {
    let type: string
    if (tipo.startsWith('image/')) type = 'image'
    else if (tipo.startsWith('video/')) type = 'video'
    else type = 'document'

    const body: Record<string, unknown> = { number: jid, type, file: url, text: legenda }
    if (type === 'document') body.docName = nomeArquivo

    const res = await fetch(`${UAZAPI_BASE_URL}/send/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', token },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.key?.id ?? data?.id ?? null
  } catch { return null }
}

// ── Types ──────────────────────────────────────────────────────────────────

interface InstanciaSelecionada { id: string; nome: string; token: string }
interface MidiaVariacao { url: string; tipo: string; nome: string }

interface Campanha {
  id: string
  mensagem: string
  mensagens_variacoes: string[]
  midias_variacoes: MidiaVariacao[]
  instancias_selecionadas: InstanciaSelecionada[]
  instancia_token: string | null
  horario_inicio: string
  horario_fim: string
  delay_minimo: number
  delay_maximo: number
  delay_mensagens: number
  midia_url: string | null
  midia_tipo: string | null
  midia_nome: string | null
}

interface ContatoCampanha {
  id: string
  campanha_id: string
  telefone: string
  nome: string | null
  empresa: string | null
  status: string
  next_send_at: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

function aplicarVariaveis(mensagem: string, contato: ContatoCampanha): string {
  return mensagem
    .replace(/\{nome\}/g, contato.nome ?? '')
    .replace(/\{empresa\}/g, contato.empresa ?? '')
    .replace(/\{telefone\}/g, contato.telefone)
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// ── Main Engine ────────────────────────────────────────────────────────────

async function processarDisparo() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const erros: string[] = []
  let processadas = 0

  // Ativa campanhas agendadas cujo horário chegou
  const agora = new Date().toISOString()
  const { data: agendadas } = await supabase
    .from('campanhas')
    .select('id')
    .eq('status', 'agendada')
    .lte('agendada_para', agora)

  for (const c of agendadas ?? []) {
    await supabase.from('campanhas').update({ status: 'em_andamento' }).eq('id', c.id)
    const { data: primeiro } = await supabase
      .from('contatos_campanha')
      .select('id')
      .eq('campanha_id', c.id)
      .eq('status', 'pendente')
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (primeiro) {
      await supabase.from('contatos_campanha').update({ next_send_at: agora }).eq('id', primeiro.id)
    }
  }

  // Busca campanhas ativas
  const { data: campanhas } = await supabase
    .from('campanhas')
    .select('*')
    .eq('status', 'em_andamento')

  if (!campanhas?.length) return { processadas, erros }

  for (const c of campanhas) {
    try {
      const campanha = c as unknown as Campanha
      campanha.instancias_selecionadas = (c.instancias_selecionadas as unknown as InstanciaSelecionada[]) ?? []
      campanha.mensagens_variacoes = (c.mensagens_variacoes as unknown as string[]) ?? []
      campanha.midias_variacoes = (c.midias_variacoes as unknown as MidiaVariacao[]) ?? []

      if (!estaNoHorario(campanha.horario_inicio ?? '08:00', campanha.horario_fim ?? '22:00')) {
        continue
      }

      // Processa contatos elegíveis por até 50 segundos desta invocação
      const limite = Date.now() + 50_000

      while (Date.now() < limite) {
        const { data: contatos } = await supabase
          .from('contatos_campanha')
          .select('*')
          .eq('campanha_id', campanha.id)
          .eq('status', 'pendente')
          .or(`next_send_at.is.null,next_send_at.lte.${new Date().toISOString()}`)
          .order('next_send_at', { ascending: true, nullsFirst: true })
          .limit(1)

        const contato = contatos?.[0] as ContatoCampanha | undefined
        if (!contato) break

        // Seleciona instância aleatória
        const instancias = campanha.instancias_selecionadas
        const instancia = instancias.length > 0
          ? escolherAleatorio(instancias)
          : campanha.instancia_token
          ? { id: '', nome: '', token: campanha.instancia_token }
          : null

        if (!instancia) {
          await supabase.from('contatos_campanha').update({ status: 'erro' }).eq('id', contato.id)
          break
        }

        // Valida WhatsApp
        const telefone = formatarTelefone(contato.telefone)
        const verificacao = await verificarWhatsApp(telefone, instancia.token)

        if (!verificacao.isInWhatsapp) {
          await supabase
            .from('contatos_campanha')
            .update({ status: 'invalido', wpp_valido: false })
            .eq('id', contato.id)
        } else {
          const jid = verificacao.jid ?? `${telefone}@s.whatsapp.net`

          // Seleciona mensagem aleatória
          const variacoes = campanha.mensagens_variacoes
          const mensagemBase = variacoes.length > 0
            ? (escolherAleatorio(variacoes) ?? campanha.mensagem)
            : campanha.mensagem
          const mensagemFinal = aplicarVariaveis(mensagemBase, contato)

          // Seleciona mídia aleatória (midias_variacoes tem prioridade; fallback para midia_url legado)
          const todasMidias: MidiaVariacao[] = campanha.midias_variacoes?.length > 0
            ? campanha.midias_variacoes
            : (campanha.midia_url && campanha.midia_tipo)
            ? [{ url: campanha.midia_url, tipo: campanha.midia_tipo, nome: campanha.midia_nome ?? 'arquivo' }]
            : []
          const midia = todasMidias.length > 0 ? escolherAleatorio(todasMidias) : null

          // Envia mídia (com legenda) ou apenas texto
          let mensagemId: string | null = null
          if (midia) {
            mensagemId = await enviarMidia(jid, midia.url, midia.tipo, midia.nome, mensagemFinal, instancia.token)
            if (!mensagemId) {
              // Mídia falhou — envia só texto como fallback
              mensagemId = await enviarTexto(jid, mensagemFinal, instancia.token)
            }
            // Mídia enviada com sucesso: legenda já está embutida, não envia texto separado
          } else {
            mensagemId = await enviarTexto(jid, mensagemFinal, instancia.token)
          }

          await supabase
            .from('contatos_campanha')
            .update({
              status: 'enviado',
              mensagem_id: mensagemId,
              instancia_usada: instancia.nome || instancia.token.slice(0, 8),
              mensagem_enviada: mensagemFinal,
              wpp_valido: true,
            })
            .eq('id', contato.id)
        }

        // Agenda o próximo contato com delay aleatório
        const { data: proximo } = await supabase
          .from('contatos_campanha')
          .select('id')
          .eq('campanha_id', campanha.id)
          .eq('status', 'pendente')
          .neq('id', contato.id)
          .is('next_send_at', null)
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (!proximo) {
          const { count } = await supabase
            .from('contatos_campanha')
            .select('id', { count: 'exact', head: true })
            .eq('campanha_id', campanha.id)
            .eq('status', 'pendente')
          if ((count ?? 0) === 0) {
            await supabase.from('campanhas').update({ status: 'concluida' }).eq('id', campanha.id)
          }
          break
        }

        const delaySeg = randomEntre(campanha.delay_minimo ?? 5, campanha.delay_maximo ?? 15)
        const nextSendAt = new Date(Date.now() + delaySeg * 1000).toISOString()
        await supabase.from('contatos_campanha').update({ next_send_at: nextSendAt }).eq('id', proximo.id)

        const espera = new Date(nextSendAt).getTime() - Date.now()
        if (espera > 0) {
          if (Date.now() + espera > limite) break
          await sleep(espera)
        }
      }

      // Atualiza contadores da campanha
      const [{ count: enviadas }, { count: erroCount }, { count: invalidos }] = await Promise.all([
        supabase.from('contatos_campanha').select('id', { count: 'exact', head: true })
          .eq('campanha_id', campanha.id).eq('status', 'enviado'),
        supabase.from('contatos_campanha').select('id', { count: 'exact', head: true })
          .eq('campanha_id', campanha.id).eq('status', 'erro'),
        supabase.from('contatos_campanha').select('id', { count: 'exact', head: true })
          .eq('campanha_id', campanha.id).eq('status', 'invalido'),
      ])
      await supabase
        .from('campanhas')
        .update({ enviadas: enviadas ?? 0, erros: (erroCount ?? 0) + (invalidos ?? 0) })
        .eq('id', campanha.id)

      processadas++
    } catch (e) {
      erros.push(`campanha ${c.id}: ${String(e)}`)
    }
  }

  return { processadas, erros }
}

// ── HTTP Handler ───────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (CRON_SECRET) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  try {
    const resultado = await processarDisparo()
    console.log('[disparo-cron]', resultado)
    return new Response(JSON.stringify({ ok: true, ...resultado }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('[disparo-cron] fatal error:', e)
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
