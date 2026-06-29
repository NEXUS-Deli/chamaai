import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const UAZAPI_BASE_URL = Deno.env.get("UAZAPI_BASE_URL") || "https://nexus-360.uazapi.com"

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

        if (!resp.ok) {
          const msg = (respData as Record<string, string>)?.error || `HTTP ${resp.status}`
          console.error(`[stories-cron] Erro na instância ${inst.nome}: ${msg}`)
          resultados.push({ instancia: inst.nome, ok: false, erro: msg })
          totalErros++
        } else {
          console.log(`[stories-cron] OK: ${inst.nome}`)
          resultados.push({ instancia: inst.nome, ok: true })
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
