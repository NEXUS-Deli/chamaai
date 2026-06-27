-- Agendamento do motor de disparo via pg_cron + pg_net
-- Chama a Edge Function disparo-cron a cada minuto

-- Extensões necessárias (disponíveis em todos projetos Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove agendamento anterior se existir (permite re-executar de forma segura)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'disparo-cron') THEN
    PERFORM cron.unschedule('disparo-cron');
  END IF;
END $$;

-- Agenda chamada à Edge Function a cada minuto
SELECT cron.schedule(
  'disparo-cron',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://jaoxormsyftctpsegtza.supabase.co/functions/v1/disparo-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imphb3hvcm1zeWZ0Y3Rwc2VndHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjQ0MzEsImV4cCI6MjA5NzM0MDQzMX0.mx-OXMn8q4pDh16Vif5ysu6NiKkI9CsNKaNjz423SBk'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
