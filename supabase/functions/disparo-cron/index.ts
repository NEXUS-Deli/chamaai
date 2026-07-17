import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

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
): Promise<{ isInWhatsapp: boolean; jid?: string; erroApi?: boolean }> {
  try {
    const res = await fetch(`${UAZAPI_BASE_URL}/chat/check`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', token },
      body: JSON.stringify({ numbers: [telefone] }),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error(`[verificarWhatsApp] HTTP ${res.status} tel=${telefone}: ${errBody.slice(0, 300)}`)
      return { isInWhatsapp: false, erroApi: true }
    }
    const data = await res.json() as Array<{ query: string; isInWhatsapp: boolean; jid: string }>
    console.log(`[verificarWhatsApp] tel=${telefone} →`, JSON.stringify(data[0]))
    return data[0] ?? { isInWhatsapp: false }
  } catch (e) {
    console.error(`[verificarWhatsApp] exception tel=${telefone}:`, String(e))
    return { isInWhatsapp: false, erroApi: true }
  }
}

// nexus-360 retorna IDs no formato "PHONE:HEX" — normaliza para só o HEX
function normalizarMsgId(rawId: string | null | undefined): string | null {
  if (!rawId) return null
  return rawId.includes(':') ? (rawId.split(':').pop() ?? rawId) : rawId
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
    return normalizarMsgId(data?.key?.id ?? data?.id)
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
    return normalizarMsgId(data?.key?.id ?? data?.id)
  } catch { return null }
}

// ── Types ──────────────────────────────────────────────────────────────────

interface InstanciaSelecionada { id: string; nome: string; token: string }
interface MidiaVariacao { url: string; tipo: string; nome: string }

interface Campanha {
  id: string
  usuario_id: string
  nome: string
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
  aguardando_confirmacao: boolean
  agendada_para: string | null
  recorrente: boolean
  recorrencia_intervalo_dias: number | null
  recorrencia_dias_excluidos: number[]
  pasta_ids: string[] | null
  serie_recorrencia_id: string | null
  instancia_whatsapp: string | null
  instancia_nome: string | null
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

// "enviadas" conta enviado + entregue + lido (mensagens que saíram com sucesso, independente do status atual)
async function recalcularContadores(supabase: SupabaseClient, campanhaId: string): Promise<{ enviadas: number; erros: number }> {
  const [{ count: enviadas }, { count: erroCount }, { count: invalidos }] = await Promise.all([
    supabase.from('contatos_campanha').select('id', { count: 'exact', head: true })
      .eq('campanha_id', campanhaId).in('status', ['enviado', 'entregue', 'lido']),
    supabase.from('contatos_campanha').select('id', { count: 'exact', head: true })
      .eq('campanha_id', campanhaId).eq('status', 'erro'),
    supabase.from('contatos_campanha').select('id', { count: 'exact', head: true })
      .eq('campanha_id', campanhaId).eq('status', 'invalido'),
  ])
  return { enviadas: enviadas ?? 0, erros: (erroCount ?? 0) + (invalidos ?? 0) }
}

// ── Recorrência ────────────────────────────────────────────────────────────

// Dia da semana em horário de Brasília (mesma conversão -3h usada em estaNoHorario)
function diaSemanaBRT(date: Date): number {
  return new Date(date.getTime() - 3 * 60 * 60 * 1000).getUTCDay()
}

// Soma o intervalo em dias e avança dia a dia até achar um dia da semana não excluído.
// Retorna null se todos os dias estiverem excluídos (config inválida) ou não achar em 14 tentativas.
function proximaDataRecorrencia(baseISO: string, intervaloDias: number, diasExcluidos: number[]): Date | null {
  const excluidos = new Set(diasExcluidos)
  if (excluidos.size >= 7) return null

  let candidata = new Date(new Date(baseISO).getTime() + intervaloDias * 24 * 60 * 60 * 1000)
  let tentativas = 0
  while (excluidos.has(diaSemanaBRT(candidata)) && tentativas < 14) {
    candidata = new Date(candidata.getTime() + 24 * 60 * 60 * 1000)
    tentativas++
  }
  return excluidos.has(diaSemanaBRT(candidata)) ? null : candidata
}

// Ao concluir uma campanha recorrente, cria a próxima execução: repuxa os
// contatos atuais das pastas de origem e clona mensagem/mídia/config.
async function agendarProximaRecorrencia(supabase: SupabaseClient, campanha: Campanha): Promise<void> {
  if (!campanha.recorrente || !campanha.recorrencia_intervalo_dias) return

  if (!campanha.pasta_ids?.length) {
    console.warn(`[disparo-cron] campanha ${campanha.id} recorrente sem pasta_ids — não é possível repetir`)
    return
  }

  const base = campanha.agendada_para ?? new Date().toISOString()
  const proxima = proximaDataRecorrencia(base, campanha.recorrencia_intervalo_dias, campanha.recorrencia_dias_excluidos ?? [])

  if (!proxima) {
    await supabase.from('notificacoes').insert({
      usuario_id: campanha.usuario_id,
      titulo: `Recorrência interrompida: "${campanha.nome}"`,
      mensagem: 'Não foi possível calcular a próxima data (todos os dias da semana estão excluídos ou config inválida). Ajuste a configuração de recorrência.',
      tipo: 'erro',
      link: `/campanhas/${campanha.id}`,
    })
    return
  }

  const { data: leads } = await supabase
    .from('leads')
    .select('telefone, nome, empresa')
    .in('pasta_id', campanha.pasta_ids)

  const contatosUnicos = Array.from(
    new Map(((leads ?? []) as { telefone: string; nome: string | null; empresa: string | null }[])
      .map(l => [l.telefone, l])).values()
  )

  const { data: novaCampanha, error } = await supabase
    .from('campanhas')
    .insert({
      usuario_id: campanha.usuario_id,
      nome: campanha.nome,
      mensagem: campanha.mensagem,
      mensagens_variacoes: campanha.mensagens_variacoes,
      midias_variacoes: campanha.midias_variacoes,
      instancias_selecionadas: campanha.instancias_selecionadas,
      instancia_whatsapp: campanha.instancia_whatsapp,
      instancia_nome: campanha.instancia_nome,
      instancia_token: campanha.instancia_token,
      delay_minimo: campanha.delay_minimo,
      delay_maximo: campanha.delay_maximo,
      delay_mensagens: campanha.delay_mensagens,
      horario_inicio: campanha.horario_inicio,
      horario_fim: campanha.horario_fim,
      midia_url: campanha.midia_url,
      midia_nome: campanha.midia_nome,
      midia_tipo: campanha.midia_tipo,
      total_contatos: contatosUnicos.length,
      status: 'agendada',
      agendada_para: proxima.toISOString(),
      recorrente: true,
      recorrencia_intervalo_dias: campanha.recorrencia_intervalo_dias,
      recorrencia_dias_excluidos: campanha.recorrencia_dias_excluidos,
      pasta_ids: campanha.pasta_ids,
      serie_recorrencia_id: campanha.serie_recorrencia_id ?? campanha.id,
    })
    .select()
    .single()

  if (error || !novaCampanha) {
    console.error(`[disparo-cron] falha ao criar próxima execução recorrente da campanha ${campanha.id}:`, error)
    return
  }

  if (contatosUnicos.length > 0) {
    await supabase.from('contatos_campanha').insert(
      contatosUnicos.map(c => ({ campanha_id: novaCampanha.id, telefone: c.telefone, nome: c.nome, empresa: c.empresa }))
    )
  }

  await supabase.from('notificacoes').insert({
    usuario_id: campanha.usuario_id,
    titulo: `Próxima execução agendada: "${campanha.nome}"`,
    mensagem: `Repetição automática agendada para ${proxima.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}, com ${contatosUnicos.length} contato(s).`,
    tipo: 'info',
    link: `/campanhas/${novaCampanha.id}`,
  })

  console.log(`[disparo-cron] recorrência: próxima execução da campanha "${campanha.nome}" agendada para ${proxima.toISOString()} com ${contatosUnicos.length} contato(s)`)
}

// ── Main Engine ────────────────────────────────────────────────────────────

async function processarDisparo() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const erros: string[] = []
  let processadas = 0

  // Recupera contatos travados em 'enviando' (a invocação que reivindicou o envio
  // falhou/crashou no meio do caminho) há mais de 2 minutos — sem isso, a campanha
  // ficaria esperando por esse contato pra sempre, já que ele não é mais 'pendente'.
  const doisMinutosAtras = new Date(Date.now() - 2 * 60 * 1000).toISOString()
  await supabase
    .from('contatos_campanha')
    .update({ status: 'pendente', next_send_at: new Date().toISOString() })
    .eq('status', 'enviando')
    .lt('atualizado_em', doisMinutosAtras)

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

  // Retoma automaticamente campanhas que estavam aguardando (horário fechou mas agora abriu de novo).
  // O comportamento correto é RETOMAR — o usuário cancela manualmente se não quiser continuar.
  const { data: aguardando } = await supabase
    .from('campanhas')
    .select('id, nome, usuario_id, horario_inicio, horario_fim')
    .eq('status', 'em_andamento')
    .eq('aguardando_confirmacao', true)

  for (const c of aguardando ?? []) {
    if (!estaNoHorario(c.horario_inicio ?? '08:00', c.horario_fim ?? '22:00')) continue

    // Horário abriu → limpa o flag para a campanha retomar normalmente
    await supabase
      .from('notificacoes')
      .update({ acao_respondida: true, lida: true })
      .eq('usuario_id', c.usuario_id)
      .eq('acao_tipo', 'confirmar_horario')
      .eq('acao_respondida', false)
      .filter('acao_dados->>campanha_id', 'eq', c.id)

    await supabase
      .from('campanhas')
      .update({ aguardando_confirmacao: false })
      .eq('id', c.id)
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
        // Calcula o próximo horario_inicio em UTC (BRT + 3h)
        const agora = new Date()
        const inicioBRT = campanha.horario_inicio ?? '08:00'
        const [hI, mI] = inicioBRT.split(':').map(Number)
        const horaBRT = (agora.getUTCHours() - 3 + 24) % 24
        const minBRT = agora.getUTCMinutes()
        const totalAgora = horaBRT * 60 + minBRT
        const totalInicio = hI * 60 + mI

        const proximo = new Date(agora)
        proximo.setUTCHours((hI + 3) % 24, mI, 0, 0)
        if (totalAgora >= totalInicio) {
          proximo.setUTCDate(proximo.getUTCDate() + 1)
        }

        // Reagenda contatos vencidos para o próximo horario_inicio e captura quantos foram movidos
        const { data: reschedulados } = await supabase
          .from('contatos_campanha')
          .update({ next_send_at: proximo.toISOString() })
          .eq('campanha_id', campanha.id)
          .eq('status', 'pendente')
          .not('next_send_at', 'is', null)
          .lt('next_send_at', agora.toISOString())
          .select('id')

        // Se acabamos de reagendar contatos E não há notificação pendente → cria a notificação
        const foiReschedulado = (reschedulados?.length ?? 0) > 0
        if (foiReschedulado && !campanha.aguardando_confirmacao) {
          const { count: totalPendentes } = await supabase
            .from('contatos_campanha')
            .select('id', { count: 'exact', head: true })
            .eq('campanha_id', campanha.id)
            .eq('status', 'pendente')

          await supabase.from('notificacoes').insert({
            usuario_id: campanha.usuario_id,
            titulo: `Campanha pausada: "${campanha.nome}"`,
            mensagem: `${totalPendentes ?? reschedulados!.length} contato(s) não foram enviados até ${campanha.horario_fim ?? '22:00'}. A campanha retomará automaticamente amanhã às ${inicioBRT}. Cancele se não quiser continuar.`,
            tipo: 'aviso',
            link: `/campanhas/${campanha.id}`,
            acao_tipo: 'confirmar_horario',
            acao_dados: {
              campanha_id: campanha.id,
              campanha_nome: campanha.nome,
              pendentes: totalPendentes ?? reschedulados!.length,
              horario_inicio: inicioBRT,
            },
          })

          await supabase
            .from('campanhas')
            .update({ aguardando_confirmacao: true })
            .eq('id', campanha.id)
        }

        continue
      }

      // Se nenhum contato está agendado (ex: campanha retomada ou migração do bug antigo),
      // agenda o primeiro pendente com null para agora
      const { count: agendados } = await supabase
        .from('contatos_campanha')
        .select('id', { count: 'exact', head: true })
        .eq('campanha_id', campanha.id)
        .eq('status', 'pendente')
        .not('next_send_at', 'is', null)

      if ((agendados ?? 0) === 0) {
        const { data: primeiro } = await supabase
          .from('contatos_campanha')
          .select('id')
          .eq('campanha_id', campanha.id)
          .eq('status', 'pendente')
          .is('next_send_at', null)
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (primeiro) {
          await supabase
            .from('contatos_campanha')
            .update({ next_send_at: new Date().toISOString() })
            .eq('id', primeiro.id)
        }
      }

      // Processa NO MÁXIMO um contato "vencido" por invocação — sem sleep.
      // O próprio pg_cron roda a cada 5s (ver migration da recorrência) e cuida do
      // ritmo entre envios: assim o delay_minimo/delay_maximo sorteado é sempre a
      // única coisa que determina o espaçamento real, sem depender de a invocação
      // ter "orçamento" sobrando pra dormir até lá.
      const { data: contatos } = await supabase
        .from('contatos_campanha')
        .select('*')
        .eq('campanha_id', campanha.id)
        .eq('status', 'pendente')
        .not('next_send_at', 'is', null)
        .lte('next_send_at', new Date().toISOString())
        .order('next_send_at', { ascending: true })
        .limit(1)

      const contato = contatos?.[0] as ContatoCampanha | undefined

      if (contato) {
        // Reivindicação atômica (CAS): só segue se ESTA invocação conseguir marcar o
        // contato como 'enviando' partindo de 'pendente'. Se outra invocação (tick
        // seguinte do cron, caso esta demore mais que 5s) já pegou, desiste em silêncio.
        const { data: reivindicado } = await supabase
          .from('contatos_campanha')
          .update({ status: 'enviando' })
          .eq('id', contato.id)
          .eq('status', 'pendente')
          .select('id')
          .maybeSingle()

        if (reivindicado) {
          // Seleciona instância aleatória
          const instancias = campanha.instancias_selecionadas
          const instancia = instancias.length > 0
            ? escolherAleatorio(instancias)
            : campanha.instancia_token
            ? { id: '', nome: '', token: campanha.instancia_token }
            : null

          if (!instancia) {
            await supabase.from('contatos_campanha').update({ status: 'erro' }).eq('id', contato.id)
          } else {
            // Valida WhatsApp
            const telefone = formatarTelefone(contato.telefone)
            console.log(`[disparo-cron] verificando tel=${telefone} (original=${contato.telefone})`)
            const verificacao = await verificarWhatsApp(telefone, instancia.token)

            if (verificacao.erroApi) {
              // Erro de API (token inválido, instância desconectada, etc.) — não marca como inválido
              console.error(`[disparo-cron] erro de API ao verificar ${telefone} — campanha ${campanha.id}`)
              await supabase.from('contatos_campanha').update({ status: 'erro' }).eq('id', contato.id)
            } else if (!verificacao.isInWhatsapp) {
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
          }

          // Agenda o próximo contato ainda não agendado com um novo delay aleatório
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

          if (proximo) {
            const delaySeg = randomEntre(campanha.delay_minimo ?? 5, campanha.delay_maximo ?? 15)
            const nextSendAt = new Date(Date.now() + delaySeg * 1000).toISOString()
            await supabase.from('contatos_campanha').update({ next_send_at: nextSendAt }).eq('id', proximo.id)
          } else {
            const { count } = await supabase
              .from('contatos_campanha')
              .select('id', { count: 'exact', head: true })
              .eq('campanha_id', campanha.id)
              .eq('status', 'pendente')
            if ((count ?? 0) === 0) {
              // Grava status E contadores reais numa única atualização — a trigger que gera
              // a notificação de "campanha concluída" lê os valores desta mesma linha, então
              // precisa vê-los já corretos (não zerados) no momento em que status vira concluida.
              const contadoresFinais = await recalcularContadores(supabase, campanha.id)
              await supabase.from('campanhas').update({ status: 'concluida', ...contadoresFinais }).eq('id', campanha.id)
              await agendarProximaRecorrencia(supabase, campanha)
            }
          }
        }
      }

      // Atualiza contadores da campanha (métricas ao vivo, sempre leve — no máximo
      // um contato muda de status por invocação agora)
      await supabase
        .from('campanhas')
        .update(await recalcularContadores(supabase, campanha.id))
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
