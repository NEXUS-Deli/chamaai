import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const UAZAPI_BASE_URL = Deno.env.get("UAZAPI_BASE_URL") || "https://conectanegocios.uazapi.com"

// Formato "número WhatsApp" pedido pela doc do /send/status (ex: "5511999999999",
// SEMPRE com o código do país "55").
function paraNumeroWhatsapp(phone: string): string {
  let digits = phone.replace(/\D/g, '')
  if (!digits) return ''
  if (!digits.startsWith('55')) digits = '55' + digits
  const local = digits.slice(2)
  const ddd = local.slice(0, 2)
  let numero = local.slice(2)
  if (numero.length === 8 && ['6', '7', '8', '9'].includes(numero[0])) numero = '9' + numero
  if (numero.length > 9) numero = numero.slice(-9)
  return `55${ddd}${numero}`
}

// Busca contatos direto da agenda do WhatsApp da instância conectada na UAZAPI
async function buscarContatosDaInstancia(baseUrl: string, token: string): Promise<string[]> {
  const telefones = new Set<string>()
  const scopes = ['address_book', 'chats']

  for (const scope of scopes) {
    try {
      const url = `${baseUrl}/contacts?contactScope=${scope}&page=1&limit=2000`
      const resp = await fetch(url, {
        method: "GET",
        headers: { "Accept": "application/json", "token": token },
      })
      if (!resp.ok) continue
      const data = await resp.json().catch(() => null)
      const list = Array.isArray(data) ? data : data?.contacts || data?.data || []
      for (const item of list) {
        const jid = String(item?.jid || item?.id || item?.number || '')
        if (jid.includes('@g.us') || jid.includes('@broadcast')) continue
        const num = jid.split('@')[0].replace(/\D/g, '')
        if (num.length >= 8) {
          const wppNum = paraNumeroWhatsapp(num)
          if (wppNum) telefones.add(wppNum)
        }
      }
    } catch (e) {
      console.warn(`[stories-cron] Falha ao buscar contatos da instância (${scope}):`, e)
    }
  }

  return Array.from(telefones)
}

// Busca todos os leads do usuário salvos no banco de dados (paginado)
async function buscarDestinatariosLeads(
  supabase: ReturnType<typeof createClient>,
  usuarioId: string,
): Promise<string[]> {
  const BATCH = 1000
  let from = 0
  const telefones = new Set<string>()

  while (true) {
    const { data } = await supabase
      .from("leads")
      .select("telefone")
      .eq("usuario_id", usuarioId)
      .range(from, from + BATCH - 1)

    const batch = (data ?? []) as { telefone: string }[]
    for (const l of batch) {
      if (l.telefone) {
        const wppNum = paraNumeroWhatsapp(l.telefone)
        if (wppNum) telefones.add(wppNum)
      }
    }
    if (batch.length < BATCH) break
    from += BATCH
  }

  return Array.from(telefones)
}

serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Busca agendamentos pendentes cujo horário já passou
  const { data: agendamentos, error } = await supabase
    .from("stories_agendamentos")
    .select("*")
    .eq("status", "pendente")
    .lte("agendado_para", new Date().toISOString())
    .limit(10)

  if (error) {
    console.error("[stories-cron] Erro ao buscar agendamentos:", error.message)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  if (!agendamentos?.length) {
    return new Response(JSON.stringify({ ok: true, processados: 0 }), { status: 200 })
  }

  console.log(`[stories-cron] ${agendamentos.length} agendamento(s) para processar`)

  for (const ag of agendamentos) {
    // Marca como enviando
    await supabase
      .from("stories_agendamentos")
      .update({ status: "enviando" })
      .eq("id", ag.id)

    const resultados: Record<string, unknown>[] = []
    let totalErros = 0

    // Busca tokens das instâncias selecionadas
    const { data: instancias } = await supabase
      .from("instancias")
      .select("id, nome, token")
      .in("id", ag.instancias_ids)
      .eq("usuario_id", ag.usuario_id)

    if (!instancias?.length) {
      await supabase
        .from("stories_agendamentos")
        .update({ status: "erro", resultado: { erro: "Nenhuma instância encontrada" } })
        .eq("id", ag.id)
      continue
    }

    // Monta payload base para o Uazapi
    const payloadBase: Record<string, unknown> = { type: ag.tipo }

    if (ag.tipo === "text") {
      payloadBase.text = ag.texto ?? ""
      if (ag.background_color) payloadBase.background_color = ag.background_color
      if (ag.font !== null && ag.font !== undefined) payloadBase.font = ag.font
    } else {
      // image ou video
      if (ag.file_base64) {
        payloadBase.file = ag.file_base64
      } else if (ag.file_url) {
        payloadBase.file = ag.file_url
      }
      if (ag.mimetype) payloadBase.mimetype = ag.mimetype
      if (ag.legenda) payloadBase.text = ag.legenda
    }

    // Configurações de público e destinatários
    const metaConfig = (ag.resultado as Record<string, unknown>) || {}
    const publicoAlvo = String(metaConfig.publico_alvo || "whatsapp")
    const recipientsPreSalvos = Array.isArray(metaConfig.recipients) ? (metaConfig.recipients as string[]) : []

    // Envia para cada instância selecionada
    for (const inst of instancias) {
      try {
        const payloadInst = { ...payloadBase }
        const listaDestinatarios = new Set<string>()

        // 1. Destinatários pré-salvos no agendamento
        for (const r of recipientsPreSalvos) {
          const w = paraNumeroWhatsapp(r)
          if (w) listaDestinatarios.add(w)
        }

        // 2. Se público envolve agenda do WhatsApp (padrão)
        if (publicoAlvo === "whatsapp" || publicoAlvo === "ambos" || listaDestinatarios.size === 0) {
          console.log(`[stories-cron] Buscando contatos da agenda da instância ${inst.nome}...`)
          const contatosInst = await buscarContatosDaInstancia(UAZAPI_BASE_URL, inst.token)
          for (const c of contatosInst) listaDestinatarios.add(c)
        }

        // 3. Se público envolve leads salvos no sistema
        if (publicoAlvo === "leads" || publicoAlvo === "ambos") {
          const leads = await buscarDestinatariosLeads(supabase, ag.usuario_id)
          for (const l of leads) listaDestinatarios.add(l)
        }

        const recipientsFinal = Array.from(listaDestinatarios)
        if (recipientsFinal.length > 0) {
          payloadInst.recipients = recipientsFinal
        }

        const maxRec = Math.max(Number(ag.max_recipients) || 2000, recipientsFinal.length || 100)
        payloadInst.max_recipients = maxRec

        console.log(`[stories-cron] Enviando status para ${inst.nome} com ${recipientsFinal.length} destinatários (max: ${maxRec})`)

        const resp = await fetch(`${UAZAPI_BASE_URL}/send/status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "token": inst.token,
          },
          body: JSON.stringify(payloadInst),
        })

        const respData = await resp.json().catch(() => ({}))
        const debugInfo = (respData as Record<string, unknown>)?.debug

        if (!resp.ok) {
          const msg = (respData as Record<string, string>)?.error || `HTTP ${resp.status}`
          console.error(`[stories-cron] Erro na instância ${inst.nome}: ${msg}`, debugInfo ?? "")
          resultados.push({ instancia: inst.nome, ok: false, erro: msg, debug: debugInfo, destinatarios: recipientsFinal.length })
          totalErros++
        } else {
          console.log(`[stories-cron] OK: ${inst.nome} (enviado para ${recipientsFinal.length} contatos)`)
          resultados.push({ instancia: inst.nome, ok: true, debug: debugInfo, destinatarios: recipientsFinal.length })
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[stories-cron] Exceção na instância ${inst.nome}: ${msg}`)
        resultados.push({ instancia: inst.nome, ok: false, erro: msg })
        totalErros++
      }
    }

    const novoStatus = totalErros === instancias.length ? "erro" : "enviado"
    await supabase
      .from("stories_agendamentos")
      .update({
        status: novoStatus,
        resultado: {
          instancias: resultados,
          publico_alvo: publicoAlvo,
          total_destinatarios: resultados.reduce((acc, r: any) => Math.max(acc, r.destinatarios || 0), 0)
        }
      })
      .eq("id", ag.id)

    // Notificação interna
    const tituloNotif = novoStatus === "enviado"
      ? `Story enviado: ${ag.titulo}`
      : `Erro ao enviar story: ${ag.titulo}`
    const tipoNotif = novoStatus === "enviado" ? "sucesso" : "erro"
    await supabase.from("notificacoes").insert({
      usuario_id: ag.usuario_id,
      titulo: tituloNotif,
      mensagem: `${instancias.length} instância(s) • ${totalErros} erro(s)`,
      tipo: tipoNotif,
      link: "/stories",
    })

    // Recorrência: se enviado com sucesso, cria próxima execução
    if (novoStatus === "enviado" && ag.recorrente && ag.recorrencia) {
      const base = new Date(ag.agendado_para)
      let proxima: Date
      if (ag.recorrencia === "diario") {
        proxima = new Date(base.getTime() + 24 * 60 * 60 * 1000)
      } else if (ag.recorrencia === "semanal") {
        proxima = new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000)
      } else {
        // mensal: mesmo dia do próximo mês
        proxima = new Date(base)
        proxima.setMonth(proxima.getMonth() + 1)
      }

      const { id: _id, criado_em: _c, resultado: _r, ...agBase } = ag
      await supabase.from("stories_agendamentos").insert({
        ...agBase,
        status: "pendente",
        agendado_para: proxima.toISOString(),
        resultado: { publico_alvo: publicoAlvo, recipients: recipientsPreSalvos },
      })
      console.log(`[stories-cron] Próxima execução recorrente agendada para ${proxima.toISOString()}`)
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processados: agendamentos.length }),
    { status: 200 }
  )
})
