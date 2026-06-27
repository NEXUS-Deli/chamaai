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

      const tokenHeaders = { 'Content-Type': 'application/json', 'token': token }
      const adminHeaders = { 'Content-Type': 'application/json', 'admintoken': UAZAPI_ADMIN_TOKEN }

      // uazapiGO usa events como string "messages", não array
      const candidatos = [
        { headers: tokenHeaders, url: `${UAZAPI_BASE_URL}/webhook/set`,
          body: { webhookUrl: WEBHOOK_URL, enabled: true, events: 'messages' } },
        { headers: tokenHeaders, url: `${UAZAPI_BASE_URL}/webhook`,
          body: { url: WEBHOOK_URL, enabled: true, events: 'messages' } },
        { headers: tokenHeaders, url: `${UAZAPI_BASE_URL}/webhook/create`,
          body: { url: WEBHOOK_URL, enabled: true, events: 'messages' } },
        { headers: tokenHeaders, url: `${UAZAPI_BASE_URL}/instance/webhook`,
          body: { webhook: WEBHOOK_URL, enabled: true, events: 'messages' } },
        ...(instanceId ? [
          { headers: adminHeaders, url: `${UAZAPI_BASE_URL}/webhook/set`,
            body: { instanceId, webhookUrl: WEBHOOK_URL, enabled: true, events: 'messages' } },
          { headers: adminHeaders, url: `${UAZAPI_BASE_URL}/webhook`,
            body: { instanceId, url: WEBHOOK_URL, enabled: true, events: 'messages' } },
        ] : []),
      ]

      let lastStatus = 0
      let lastBody = ''
      for (const candidato of candidatos) {
        const r = await fetch(candidato.url, {
          method: 'POST',
          headers: candidato.headers,
          body: JSON.stringify(candidato.body),
        })
        lastStatus = r.status
        lastBody = await r.text()
        if (r.ok) {
          let parsed: unknown = {}
          try { parsed = JSON.parse(lastBody) } catch { /* ignora */ }
          console.log(`[uazapi-proxy] set_webhook OK via ${candidato.url}`)
          return new Response(JSON.stringify({ ok: true, ...(parsed as object) }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          })
        }
        console.warn(`[uazapi-proxy] set_webhook falhou em ${candidato.url}: ${r.status} ${lastBody}`)
      }

      return new Response(JSON.stringify({ ok: false, message: `Webhook não configurado (HTTP ${lastStatus}): ${lastBody}` }), {
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
