import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { action, payload } = await req.json()

    const UAZAPI_BASE_URL = Deno.env.get('UAZAPI_BASE_URL') || "https://nexus-360.uazapi.com"
    const UAZAPI_ADMIN_TOKEN = Deno.env.get('UAZAPI_ADMIN_TOKEN')

    if (!UAZAPI_ADMIN_TOKEN) {
      throw new Error('UAZAPI_ADMIN_TOKEN is not set in Edge Function secrets')
    }

    // --- CREATE INSTANCE (uses admin token) ---
    if (action === 'create_instance') {
      const response = await fetch(`${UAZAPI_BASE_URL}/instance/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'admintoken': UAZAPI_ADMIN_TOKEN
        },
        body: JSON.stringify({ name: payload.name })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Erro ao criar instância na UAZAPI')
      }

      // Tenta configurar webhook automaticamente logo após a criação
      const instanceToken = data?.token || data?.instance?.token
      const instanceId = data?.instance?.id || data?.id || data?.instance?.instanceId

      if (instanceToken) {
        const WEBHOOK_URL = Deno.env.get('SUPABASE_URL')
          ? `${Deno.env.get('SUPABASE_URL')}/functions/v1/disparo-webhook`
          : 'https://jaoxormsyftctpsegtza.supabase.co/functions/v1/disparo-webhook'

        // uazapiGO usa events como string "messages", não array
        const webhookCandidatos = [
          { headers: { 'Content-Type': 'application/json', 'token': instanceToken },
            url: `${UAZAPI_BASE_URL}/webhook/set`,
            body: { webhookUrl: WEBHOOK_URL, enabled: true, events: 'messages' } },
          { headers: { 'Content-Type': 'application/json', 'token': instanceToken },
            url: `${UAZAPI_BASE_URL}/webhook`,
            body: { url: WEBHOOK_URL, enabled: true, events: 'messages' } },
          { headers: { 'Content-Type': 'application/json', 'token': instanceToken },
            url: `${UAZAPI_BASE_URL}/webhook/create`,
            body: { url: WEBHOOK_URL, enabled: true, events: 'messages' } },
          ...(instanceId ? [
            { headers: { 'Content-Type': 'application/json', 'admintoken': UAZAPI_ADMIN_TOKEN },
              url: `${UAZAPI_BASE_URL}/webhook/set`,
              body: { instanceId, webhookUrl: WEBHOOK_URL, enabled: true, events: 'messages' } },
            { headers: { 'Content-Type': 'application/json', 'admintoken': UAZAPI_ADMIN_TOKEN },
              url: `${UAZAPI_BASE_URL}/webhook`,
              body: { instanceId, url: WEBHOOK_URL, enabled: true, events: 'messages' } },
          ] : []),
        ]

        for (const candidato of webhookCandidatos) {
          try {
            const r = await fetch(candidato.url, {
              method: 'POST',
              headers: candidato.headers,
              body: JSON.stringify(candidato.body),
            })
            const rText = await r.text()
            if (r.ok) {
              console.log(`[uazapi-proxy] Webhook configurado via ${candidato.url}`)
              break
            }
            console.warn(`[uazapi-proxy] Webhook falhou ${candidato.url}: ${r.status} ${rText}`)
          } catch (e) {
            console.warn(`[uazapi-proxy] Webhook erro ${candidato.url}:`, e)
          }
        }
      }

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // --- CONNECT INSTANCE (uses instance token, proxied to avoid CORS) ---
    if (action === 'connect_instance') {
      const { token } = payload
      if (!token) throw new Error('Token da instância é obrigatório')

      const response = await fetch(`${UAZAPI_BASE_URL}/instance/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'token': token
        }
      })

      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || data.message || 'Erro ao conectar instância')
      }

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // --- GET INSTANCE STATUS + QR CODE (uses instance token, proxied to avoid CORS) ---
    if (action === 'instance_status') {
      const { token } = payload
      if (!token) throw new Error('Token da instância é obrigatório')

      const response = await fetch(`${UAZAPI_BASE_URL}/instance/status`, {
        method: 'GET',
        headers: {
          'token': token
        }
      })

      const data = await response.json()
      
      // Don't throw on not-ok here — the status endpoint may return 4xx when disconnected
      // Just pass through the data

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // --- DELETE INSTANCE (uses instance token) ---
    if (action === 'delete_instance') {
      const { instanceId, token } = payload
      if (!instanceId) throw new Error('instanceId é obrigatório')
      if (!token) throw new Error('token é obrigatório')

      const response = await fetch(`${UAZAPI_BASE_URL}/instance`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'token': token
        },
        body: JSON.stringify({ id: instanceId })
      })

      // 404 = instância já foi deletada antes, trata como sucesso
      if (response.status === 404) {
        return new Response(JSON.stringify({ success: true, alreadyDeleted: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        })
      }

      if (!response.ok) {
        const rawText = await response.text()
        let errMsg = `Erro ao deletar instância na UAZAPI (HTTP ${response.status})`
        try {
          const data = JSON.parse(rawText)
          errMsg = data.error || data.message || data.msg || errMsg
        } catch (_) { /* ignora parse error, usa rawText */ }
        console.error('[uazapi-proxy] delete_instance error:', response.status, rawText)
        throw new Error(errMsg)
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }



    // --- DISCONNECT INSTANCE (uses instance token, proxied to avoid CORS) ---
    if (action === 'disconnect_instance') {
      const { token } = payload
      if (!token) throw new Error('Token da instância é obrigatório')

      const response = await fetch(`${UAZAPI_BASE_URL}/instance/disconnect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'token': token
        }
      })

      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || data.message || 'Erro ao desconectar instância')
      }

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // --- SET WEBHOOK (configura entrega de ACK para a Edge Function disparo-webhook) ---
    if (action === 'set_webhook') {
      const { token, instanceId } = payload
      if (!token) throw new Error('Token da instância é obrigatório')

      const WEBHOOK_URL = Deno.env.get('SUPABASE_URL')
        ? `${Deno.env.get('SUPABASE_URL')}/functions/v1/disparo-webhook`
        : 'https://jaoxormsyftctpsegtza.supabase.co/functions/v1/disparo-webhook'

      const th = { 'Content-Type': 'application/json', 'token': token }
      const ah = { 'Content-Type': 'application/json', 'admintoken': UAZAPI_ADMIN_TOKEN as string }

      // Tenta várias combinações de endpoint/método/body até uma funcionar.
      // A UAZAPI varia bastante dependendo da versão (uazapiGO, baileys, etc).
      type Candidato = { method: string; headers: Record<string,string>; url: string; body: Record<string,unknown> }
      const candidatos: Candidato[] = [
        // PUT /webhook — forma mais comum no uazapiGO
        { method: 'PUT',  headers: th, url: `${UAZAPI_BASE_URL}/webhook`,
          body: { url: WEBHOOK_URL, enabled: true } },
        { method: 'PUT',  headers: th, url: `${UAZAPI_BASE_URL}/webhook`,
          body: { webhookUrl: WEBHOOK_URL, enabled: true } },
        { method: 'PUT',  headers: th, url: `${UAZAPI_BASE_URL}/webhook`,
          body: { url: WEBHOOK_URL, enabled: true, events: ['messages.upsert','messages.update'] } },
        // POST /webhook
        { method: 'POST', headers: th, url: `${UAZAPI_BASE_URL}/webhook`,
          body: { url: WEBHOOK_URL, enabled: true } },
        { method: 'POST', headers: th, url: `${UAZAPI_BASE_URL}/webhook`,
          body: { webhookUrl: WEBHOOK_URL, enabled: true } },
        { method: 'POST', headers: th, url: `${UAZAPI_BASE_URL}/webhook`,
          body: { url: WEBHOOK_URL, enabled: true, events: ['messages.upsert','messages.update'] } },
        // POST /webhook/set
        { method: 'POST', headers: th, url: `${UAZAPI_BASE_URL}/webhook/set`,
          body: { webhookUrl: WEBHOOK_URL, enabled: true } },
        { method: 'POST', headers: th, url: `${UAZAPI_BASE_URL}/webhook/set`,
          body: { url: WEBHOOK_URL, enabled: true } },
        { method: 'PUT',  headers: th, url: `${UAZAPI_BASE_URL}/webhook/set`,
          body: { webhookUrl: WEBHOOK_URL, enabled: true } },
        // POST /instance/webhook
        { method: 'POST', headers: th, url: `${UAZAPI_BASE_URL}/instance/webhook`,
          body: { webhook: WEBHOOK_URL, enabled: true } },
        { method: 'PUT',  headers: th, url: `${UAZAPI_BASE_URL}/instance/webhook`,
          body: { webhook: WEBHOOK_URL, enabled: true } },
        { method: 'PUT',  headers: th, url: `${UAZAPI_BASE_URL}/instance/webhook`,
          body: { url: WEBHOOK_URL, enabled: true } },
        // Com admintoken + instanceId
        ...(instanceId ? [
          { method: 'POST', headers: ah, url: `${UAZAPI_BASE_URL}/webhook/set`,
            body: { instanceId, webhookUrl: WEBHOOK_URL, enabled: true } },
          { method: 'PUT',  headers: ah, url: `${UAZAPI_BASE_URL}/webhook`,
            body: { instanceId, url: WEBHOOK_URL, enabled: true } },
          { method: 'POST', headers: ah, url: `${UAZAPI_BASE_URL}/webhook`,
            body: { instanceId, url: WEBHOOK_URL, enabled: true } },
        ] : []),
      ]

      const erros: string[] = []
      for (const c of candidatos) {
        try {
          const r = await fetch(c.url, {
            method: c.method,
            headers: c.headers,
            body: JSON.stringify(c.body),
          })
          const body = await r.text()
          if (r.ok) {
            let parsed: unknown = {}
            try { parsed = JSON.parse(body) } catch { /* ignora */ }
            console.log(`[uazapi-proxy] set_webhook OK: ${c.method} ${c.url}`)
            return new Response(JSON.stringify({ ok: true, ...(parsed as object) }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200,
            })
          }
          const msg = `${c.method} ${c.url} → ${r.status}: ${body.slice(0, 200)}`
          erros.push(msg)
          console.warn(`[uazapi-proxy] set_webhook falhou: ${msg}`)
        } catch (e) {
          const msg = `${c.method} ${c.url} → erro: ${e}`
          erros.push(msg)
          console.warn(`[uazapi-proxy] set_webhook exceção: ${msg}`)
        }
      }

      return new Response(JSON.stringify({ ok: false, erros }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // --- CHECK NUMBERS (verifica se números têm WhatsApp) ---
    if (action === 'check_numbers') {
      const { token, numbers } = payload
      if (!token) throw new Error('Token da instância é obrigatório')
      if (!Array.isArray(numbers) || !numbers.length) throw new Error('Lista de números é obrigatória')

      const response = await fetch(`${UAZAPI_BASE_URL}/chat/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'token': token,
        },
        body: JSON.stringify({ numbers }),
      })

      const rawText = await response.text()
      let data: unknown
      try { data = JSON.parse(rawText) } catch { data = { error: rawText } }

      if (!response.ok) {
        const errMsg = (data as Record<string, string>)?.error
          || (data as Record<string, string>)?.message
          || `Erro ${response.status} da API Uazapi`
        console.error('[uazapi-proxy] check_numbers error:', response.status, rawText)
        throw new Error(errMsg)
      }

      console.log(`[uazapi-proxy] check_numbers OK — ${Array.isArray(data) ? data.length : 1} resultado(s)`)
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // --- GET CHAT DETAILS (busca nome real do contato — usado pra enriquecer o Verificador) ---
    if (action === 'get_chat_details') {
      const { token, number } = payload
      if (!token) throw new Error('Token da instância é obrigatório')
      if (!number) throw new Error('Número é obrigatório')

      const response = await fetch(`${UAZAPI_BASE_URL}/chat/details`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'token': token,
        },
        body: JSON.stringify({ number, preview: true }),
      })

      const rawText = await response.text()
      let data: unknown
      try { data = JSON.parse(rawText) } catch { data = { error: rawText } }

      if (!response.ok) {
        const errMsg = (data as Record<string, string>)?.error
          || (data as Record<string, string>)?.message
          || `Erro ${response.status} da API Uazapi`
        console.error('[uazapi-proxy] get_chat_details error:', response.status, rawText)
        throw new Error(errMsg)
      }

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // --- GET CONTACTS (lista contatos da instância, com paginação automática) ---
    if (action === 'get_contacts') {
      const { token, contactScope } = payload
      if (!token) throw new Error('Token é obrigatório')

      const scope = contactScope || 'address_book'
      const PAGE_SIZE = 1000
      const allContacts: unknown[] = []
      let page = 1
      let hasMore = true

      while (hasMore) {
        const url = `${UAZAPI_BASE_URL}/contacts?contactScope=${scope}&page=${page}&limit=${PAGE_SIZE}`

        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json', 'token': token },
        })

        const rawText = await response.text()
        let data: unknown
        try { data = JSON.parse(rawText) } catch { data = [] }

        if (!response.ok) {
          const errMsg = (data as Record<string, string>)?.error
            || (data as Record<string, string>)?.message
            || `Erro ${response.status} da API Uazapi`
          console.error('[uazapi-proxy] get_contacts error:', response.status, rawText)
          throw new Error(errMsg)
        }

        const pageList = Array.isArray(data)
          ? data
          : (data as Record<string, unknown>)?.contacts ?? (data as Record<string, unknown>)?.data ?? []

        const items = pageList as unknown[]
        allContacts.push(...items)

        // Para quando a página retorna menos que o limite (última página)
        hasMore = items.length === PAGE_SIZE
        page++

        // Proteção contra loop infinito (máx 50 páginas = 50.000 contatos)
        if (page > 50) break
      }

      console.log(`[uazapi-proxy] get_contacts OK — ${allContacts.length} contato(s) total (${page - 1} página(s)), scope=${scope}`)
      return new Response(JSON.stringify(allContacts), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // --- GET GROUPS (lista grupos da instância via GET /group/list) ---
    if (action === 'get_groups') {
      const { token } = payload
      if (!token) throw new Error('Token é obrigatório')

      const response = await fetch(`${UAZAPI_BASE_URL}/group/list`, {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'token': token },
      })

      const rawText = await response.text()
      let data: unknown
      try { data = JSON.parse(rawText) } catch { data = {} }

      if (!response.ok) {
        const errMsg = (data as Record<string, string>)?.error || `Erro ${response.status}`
        throw new Error(errMsg)
      }

      // API retorna { groups: [{ JID, Name, Size?, ... }] }
      type RawGroup = Record<string, unknown>
      const rawGroups: RawGroup[] = Array.isArray(data)
        ? data
        : ((data as Record<string, unknown>)?.groups as RawGroup[]) ?? []

      const groups = rawGroups
        .map((g) => ({
          id:      String(g.JID ?? g.jid ?? g.id ?? ''),
          subject: String(g.Name ?? g.name ?? g.subject ?? 'Grupo sem nome'),
          size:    Number(g.Size ?? g.size ?? g.participantsCount ?? 0) || null,
        }))
        .filter((g) => g.id && g.id.includes('@g.us'))

      console.log(`[uazapi-proxy] get_groups OK — ${groups.length} grupo(s)`)
      return new Response(JSON.stringify(groups), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // --- GET GROUP MEMBERS (extrai membros via POST /group/info) ---
    if (action === 'get_group_members') {
      const { token, groupId } = payload
      if (!token) throw new Error('Token é obrigatório')
      if (!groupId) throw new Error('groupId é obrigatório')

      const response = await fetch(`${UAZAPI_BASE_URL}/group/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'token': token },
        body: JSON.stringify({ groupjid: groupId, getInviteLink: false, getRequestsParticipants: false, force: false }),
      })

      const rawText = await response.text()
      let data: unknown
      try { data = JSON.parse(rawText) } catch { data = {} }

      if (!response.ok) {
        const errMsg = (data as Record<string, string>)?.error || `Erro ${response.status}`
        throw new Error(errMsg)
      }

      // API retorna array ou objeto único
      type RawParticipant = Record<string, unknown>
      const grupo = Array.isArray(data) ? (data as Record<string, unknown>[])[0] : (data as Record<string, unknown>)
      const rawParticipants: RawParticipant[] =
        (grupo?.Participants ?? grupo?.participants ?? []) as RawParticipant[]

      const members = rawParticipants
        .map((p) => {
          const jid = String(p.JID ?? p.jid ?? '')
          const phone = String(p.PhoneNumber ?? p.phoneNumber ?? jid.split('@')[0] ?? '')
          return {
            id:     jid,
            number: phone,
            name:   (p.DisplayName ?? p.displayName ?? p.name ?? null) as string | null,
            admin:  !!(p.IsAdmin ?? p.isAdmin ?? p.IsSuperAdmin ?? p.isSuperAdmin),
          }
        })
        .filter((m) => m.id && !m.id.includes('@g.us') && !m.id.includes('@broadcast'))

      console.log(`[uazapi-proxy] get_group_members OK — ${members.length} membro(s) em ${groupId}`)
      return new Response(JSON.stringify(members), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // --- SEND STATUS / STORY (posta story no WhatsApp) ---
    if (action === 'send_status') {
      const { token, type, text, background_color, font, file, mimetype, legenda, max_recipients, recipients } = payload
      if (!token) throw new Error('Token da instância é obrigatório')
      if (!type) throw new Error('Tipo é obrigatório (text, image, video)')

      const body: Record<string, unknown> = { type }

      if (type === 'text') {
        body.text = text ?? ''
        if (background_color !== undefined) body.background_color = background_color
        if (font !== undefined) body.font = font
      } else {
        if (!file) throw new Error('Campo file é obrigatório para imagem/vídeo')
        body.file = file
        if (mimetype) body.mimetype = mimetype
        if (legenda) body.text = legenda
      }

      if (max_recipients !== undefined && max_recipients !== null) body.max_recipients = max_recipients
      if (Array.isArray(recipients) && recipients.length) body.recipients = recipients

      const response = await fetch(`${UAZAPI_BASE_URL}/send/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'token': token },
        body: JSON.stringify(body),
      })

      const rawText = await response.text()
      let data: unknown
      try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

      if (!response.ok) {
        const errMsg = (data as Record<string, string>)?.error || `Erro ${response.status}`
        throw new Error(errMsg)
      }

      console.log(`[uazapi-proxy] send_status OK (${type})`)
      return new Response(JSON.stringify({ ok: true, ...(data as object) }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // --- ADD CONTACT (adiciona contato à agenda do WhatsApp) ---
    if (action === 'add_contact') {
      const { token, number, name } = payload
      if (!token) throw new Error('Token da instância é obrigatório')
      if (!number) throw new Error('Número é obrigatório')
      if (!name) throw new Error('Nome é obrigatório')

      const response = await fetch(`${UAZAPI_BASE_URL}/contact/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'token': token,
        },
        body: JSON.stringify({ number, name }),
      })

      const rawText = await response.text()
      let data: unknown
      try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

      if (!response.ok) {
        const errMsg = (data as Record<string, string>)?.error
          || (data as Record<string, string>)?.message
          || `Erro ${response.status}`
        throw new Error(errMsg)
      }

      console.log(`[uazapi-proxy] add_contact OK — ${name} (${number})`)
      return new Response(JSON.stringify({ ok: true, ...(data as object) }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    throw new Error('Invalid action')

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  }
})
