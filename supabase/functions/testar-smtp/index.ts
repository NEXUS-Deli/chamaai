import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import nodemailer from "nodemailer"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { host, port, username, password, encryption } = await req.json()

    if (!host || !port || !username || !password) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Campos host, port, username e password são obrigatórios.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const portNum = Number(port)
    const isSsl = portNum === 465 || encryption === 'ssl'

    const transporter = nodemailer.createTransport({
      host,
      port: portNum,
      secure: isSsl,
      auth: {
        user: username,
        pass: password,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    })

    await transporter.verify()

    return new Response(
      JSON.stringify({ ok: true, message: 'Conexão e autenticação SMTP estabelecidas com sucesso!' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    let userMsg = msg

    if (msg.includes('535') || msg.includes('authentication data')) {
      userMsg = 'Falha de Autenticação (535): Usuário ou senha incorretos no servidor SMTP. Verifique os dados no cPanel.'
    } else if (msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) {
      userMsg = 'Tempo limite esgotado: Não foi possível alcançar o servidor SMTP no host/porta informados.'
    }

    return new Response(
      JSON.stringify({ ok: false, error: userMsg, rawError: msg }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
