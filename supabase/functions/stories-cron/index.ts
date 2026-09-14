import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const UAZAPI_BASE_URL = Deno.env.get("UAZAPI_BASE_URL") || "https://nexus-360.uazapi.com"

// Formato "número WhatsApp" pedido pela doc do /send/status (ex: "5511999999999",
// SEMPRE com o código do país "55" — diferente do formatarTelefone usado em
// disparo-cron, que remove o "55" pra outro fluxo/endpoint).
function paraNumeroWhatsapp(phone: string): string {
  let digits = phone.replace(/\D/g, '')
  if (!digits.startsWith('55')) digits = '55' + digits
  const local = digits.slice(2)
  const ddd = local.slice(0, 2)
  let numero = local.slice(2)
  if (numero.length === 8 && ['6', '7', '8', '9'].includes(numero[0])) numero = '9' + numero
  if (numero.length > 9) numero = numero.slice(-9)
  return `55${ddd}${numero}`
}

// Busca todos os leads do usuário (paginado — PostgREST limita 1000 linhas
// por chamada) e devolve os números únicos, prontos pra virar "recipients" do
// story. A sessão da API não usa a agenda nativa do WhatsApp do celular
// conectado pra decidir quem vê o status — precisa receber a lista explícita.
// Não corta pelo limite aqui: manda a lista inteira e deixa o "max_recipients"
// (enviado junto) fazer o corte determinístico do lado da uazapi, como a doc
// recomenda pro modo "envio parcial" combinado com "envio explícito".
async function buscarDestinatarios(
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
      if (l.telefone) telefones.add(paraNumeroWhatsapp(l.telefone))
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

    if (ag.max_recipients) payloadBase.max_recipients = ag.max_recipients

    // Lista explícita de destinatários (todos os leads salvos do usuário) —
    // sem isso o story não tem audiência, já que a sessão da API não usa a
    // agenda nativa do WhatsApp do celular conectado. Manda a lista inteira;
    // "max_recipients" acima já faz o corte determinístico do lado da uazapi.
    const recipients = await buscarDestinatarios(supabase, ag.usuario_id)
    if (recipients.length > 0) payloadBase.recipients = recipients
    console.log(`[stories-cron] ${recipients.length} destinatário(s) para o agendamento ${ag.id}`)

    // Envia para cada instância selecionada
    for (const inst of instancias) {
      try {
        const resp = await fetch(`${UAZAPI_BASE_URL}/send/status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "token": inst.token,
          },
          body: JSON.stringify(payloadBase),
        })

        const respData = await resp.json().catch(() => ({}))
        // Guarda o debug da uazapi (contagens, motivos de descarte por
        // recipient, etc.) no resultado — essencial pra diagnosticar se a
        // audiência veio vazia/parcial mesmo com resp.ok.
        const debugInfo = (respData as Record<string, unknown>)?.debug

        if (!resp.ok) {
          const msg = (respData as Record<string, string>)?.error || `HTTP ${resp.status}`
          console.error(`[stories-cron] Erro na instância ${inst.nome}: ${msg}`, debugInfo ?? "")
          resultados.push({ instancia: inst.nome, ok: false, erro: msg, debug: debugInfo })
          totalErros++
        } else {
          console.log(`[stories-cron] OK: ${inst.nome}`, debugInfo ?? "")
          resultados.push({ instancia: inst.nome, ok: true, debug: debugInfo })
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
      .update({ status: novoStatus, resultado: { instancias: resultados } })
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
        resultado: null,
      })
      console.log(`[stories-cron] Próxima execução recorrente agendada para ${proxima.toISOString()}`)
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processados: agendamentos.length }),
    { status: 200 }
  )
})
