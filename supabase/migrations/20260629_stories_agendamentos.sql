-- Tabela de agendamentos de stories (status do WhatsApp)
CREATE TABLE public.stories_agendamentos (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo         TEXT        NOT NULL,
  tipo           TEXT        NOT NULL DEFAULT 'text' CHECK (tipo IN ('text','image','video')),
  texto          TEXT,
  background_color INTEGER   DEFAULT 19,
  font           INTEGER     DEFAULT 0,
  file_url       TEXT,
  file_base64    TEXT,
  mimetype       TEXT,
  legenda        TEXT,
  max_recipients INTEGER     DEFAULT 100,
  instancias_ids UUID[]      NOT NULL DEFAULT '{}',
  agendado_para  TIMESTAMPTZ NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'pendente'
                             CHECK (status IN ('pendente','enviando','enviado','erro','cancelado')),
  resultado      JSONB,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stories_agendamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_stories" ON public.stories_agendamentos
  FOR ALL USING (auth.uid() = usuario_id)
  WITH CHECK (auth.uid() = usuario_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stories_agendamentos TO authenticated;
GRANT ALL ON public.stories_agendamentos TO service_role;

CREATE INDEX idx_stories_pendentes
  ON public.stories_agendamentos (agendado_para)
  WHERE status = 'pendente';

CREATE TRIGGER trg_stories_upd
  BEFORE UPDATE ON public.stories_agendamentos
  FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();

-- Cron: dispara o worker de stories a cada minuto
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'stories-cron') THEN
    PERFORM cron.unschedule('stories-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'stories-cron',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://jaoxormsyftctpsegtza.supabase.co/functions/v1/stories-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imphb3hvcm1zeWZ0Y3Rwc2VndHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjQ0MzEsImV4cCI6MjA5NzM0MDQzMX0.mx-OXMn8q4pDh16Vif5ysu6NiKkI9CsNKaNjz423SBk'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
