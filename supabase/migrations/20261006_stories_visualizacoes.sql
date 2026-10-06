-- Visualizações de stories
--
-- Cada story publicado gera um "envio" por instância, guardando o ID da mensagem
-- devolvido pela UAZAPI em /send/status. Quando alguém visualiza o status, o
-- WhatsApp manda um recibo de leitura (Chat = status@broadcast, Sender = quem viu),
-- que chega no disparo-webhook. O webhook chama registrar_visualizacao_story(),
-- que grava o visualizador uma única vez e incrementa o contador do envio.
--
-- Só cria objetos novos; nenhuma tabela existente é alterada.

CREATE TABLE IF NOT EXISTS public.stories_envios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id uuid NOT NULL REFERENCES public.stories_agendamentos(id) ON DELETE CASCADE,
  usuario_id     uuid NOT NULL,
  instancia_id   uuid REFERENCES public.instancias(id) ON DELETE SET NULL,
  mensagem_id    text NOT NULL UNIQUE,
  visualizacoes  integer NOT NULL DEFAULT 0,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stories_envios_agendamento_idx ON public.stories_envios (agendamento_id);
CREATE INDEX IF NOT EXISTS stories_envios_usuario_idx     ON public.stories_envios (usuario_id);

CREATE TABLE IF NOT EXISTS public.stories_visualizacoes (
  envio_id     uuid NOT NULL REFERENCES public.stories_envios(id) ON DELETE CASCADE,
  visualizador text NOT NULL,
  visto_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (envio_id, visualizador)
);

-- RLS: o usuário lê e cria apenas os próprios envios (o envio imediato é feito pelo navegador).
-- stories_visualizacoes não tem policy: só o service role (webhook) acessa.
ALTER TABLE public.stories_envios        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stories_visualizacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_stories_envios_select ON public.stories_envios;
CREATE POLICY own_stories_envios_select ON public.stories_envios
  FOR SELECT USING (auth.uid() = usuario_id);

DROP POLICY IF EXISTS own_stories_envios_insert ON public.stories_envios;
CREATE POLICY own_stories_envios_insert ON public.stories_envios
  FOR INSERT WITH CHECK (auth.uid() = usuario_id);

-- Registra uma visualização (idempotente por visualizador). Retorna true se for nova.
CREATE OR REPLACE FUNCTION public.registrar_visualizacao_story(p_mensagem_id text, p_visualizador text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_envio uuid;
  v_novas integer;
BEGIN
  SELECT id INTO v_envio FROM public.stories_envios WHERE mensagem_id = p_mensagem_id;
  IF v_envio IS NULL OR coalesce(p_visualizador, '') = '' THEN
    RETURN false;
  END IF;

  INSERT INTO public.stories_visualizacoes (envio_id, visualizador)
  VALUES (v_envio, p_visualizador)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_novas = ROW_COUNT;

  IF v_novas > 0 THEN
    UPDATE public.stories_envios SET visualizacoes = visualizacoes + 1 WHERE id = v_envio;
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_visualizacao_story(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_visualizacao_story(text, text) TO service_role;

-- Backfill: stories publicados pelo envio imediato já guardam o ID em resultado.response.Id.
-- Registrá-los permite contar as visualizações que acontecerem a partir de agora.
INSERT INTO public.stories_envios (agendamento_id, usuario_id, instancia_id, mensagem_id)
SELECT
  a.id,
  a.usuario_id,
  (SELECT i.id FROM public.instancias i WHERE i.id = a.instancias_ids[1]),
  regexp_replace(a.resultado->'response'->>'Id', '^.*:', '')
FROM public.stories_agendamentos a
WHERE a.status = 'enviado'
  AND coalesce(a.resultado->'response'->>'Id', '') <> ''
ON CONFLICT (mensagem_id) DO NOTHING;
