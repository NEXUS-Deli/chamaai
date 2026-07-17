-- ============================================================
-- Reduz o intervalo do disparo-cron de 1 minuto para 5 segundos.
--
-- Motivo: o motor processa no máximo um envio por invocação e depende do
-- próprio cron para retomar no horário certo (sem dormir bloqueado dentro
-- da function). Com o cron rodando só uma vez por minuto, um contato cujo
-- delay sorteado vencesse perto do fim da janela de processamento da
-- invocação anterior podia ficar esperando até ~60s a mais pelo próximo
-- tick — ignorando na prática o delay_minimo/delay_maximo configurado
-- pelo usuário. Rodando a cada 5s, esse atraso extra cai para no máximo ~5s.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'disparo-cron') THEN
    PERFORM cron.unschedule('disparo-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'disparo-cron',
  '5 seconds',
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
