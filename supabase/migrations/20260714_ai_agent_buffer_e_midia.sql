-- ============================================================
-- Agente de IA: buffer de mensagens + suporte a áudio/imagem
-- ============================================================

-- Configurações adicionais do agente de IA
ALTER TABLE public.ai_configuracoes
  ADD COLUMN IF NOT EXISTS buffer_segundos       INTEGER NOT NULL DEFAULT 8 CHECK (buffer_segundos BETWEEN 0 AND 45),
  ADD COLUMN IF NOT EXISTS responder_audio        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS responder_imagem       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS openai_key_transcricao TEXT;

-- Buffer de mensagens recebidas, aguardando a janela de silêncio configurada
-- antes de serem processadas em conjunto pelo agente de IA.
CREATE TABLE IF NOT EXISTS public.ai_buffer (
  instancia_id  UUID        NOT NULL REFERENCES public.instancias(id) ON DELETE CASCADE,
  numero        TEXT        NOT NULL,
  mensagens     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  lock_token    UUID,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instancia_id, numero)
);

ALTER TABLE public.ai_buffer ENABLE ROW LEVEL SECURITY;

-- Tabela de uso exclusivamente interno (webhook + sweep de segurança),
-- sem necessidade de acesso direto do usuário final.
GRANT ALL ON public.ai_buffer TO service_role;

-- Upsert atômico: anexa o item ao array cumulativo e assume o lock_token mais
-- recente. Cada invocação do webhook chama isso ao receber uma mensagem; após
-- a janela de buffer, só quem ainda detém o lock_token mais recente processa
-- o lote inteiro (compare-and-swap via UPDATE condicional feito em código).
CREATE OR REPLACE FUNCTION public.ai_buffer_append(
  p_instancia_id UUID,
  p_numero       TEXT,
  p_item         JSONB,
  p_token        UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ai_buffer (instancia_id, numero, mensagens, lock_token, atualizado_em)
  VALUES (p_instancia_id, p_numero, jsonb_build_array(p_item), p_token, now())
  ON CONFLICT (instancia_id, numero) DO UPDATE
    SET mensagens     = public.ai_buffer.mensagens || jsonb_build_array(p_item),
        lock_token    = p_token,
        atualizado_em = now();
END;
$$;

REVOKE ALL ON FUNCTION public.ai_buffer_append(UUID, TEXT, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_buffer_append(UUID, TEXT, JSONB, UUID) TO service_role;

-- ============================================================
-- Agendamento da rede de segurança (ai-agent-buffer-sweep)
-- Varre buffers travados há mais de 2 minutos (a invocação vencedora morreu
-- antes de completar o processamento) e tenta reivindicá-los/reprocessá-los.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-agent-buffer-sweep') THEN
    PERFORM cron.unschedule('ai-agent-buffer-sweep');
  END IF;
END $$;

SELECT cron.schedule(
  'ai-agent-buffer-sweep',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://jaoxormsyftctpsegtza.supabase.co/functions/v1/ai-agent-buffer-sweep',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imphb3hvcm1zeWZ0Y3Rwc2VndHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjQ0MzEsImV4cCI6MjA5NzM0MDQzMX0.mx-OXMn8q4pDh16Vif5ysu6NiKkI9CsNKaNjz423SBk'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
