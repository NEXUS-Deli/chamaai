-- ============================================================
-- Atendimento com IA — chave global do sistema + controle de consumo
--
-- A chave da IA deixa de ficar por agente (ai_configuracoes.api_key) e passa a
-- ser um segredo do servidor (Edge Function secret AI_OPENAI_API_KEY), nunca
-- gravado no banco nem exposto ao navegador. Para evitar gasto descontrolado,
-- cada resposta da IA consome uma cota diária por usuário e uma cota global.
--
-- Só acrescenta objetos/colunas; nada existente é alterado ou removido.
-- ============================================================

-- Destino do aviso de transferência para humano: JID de número
-- ("5511999999999@s.whatsapp.net") ou de grupo ("1203...@g.us").
ALTER TABLE public.ai_configuracoes
  ADD COLUMN IF NOT EXISTS transferencia_destino      TEXT,
  ADD COLUMN IF NOT EXISTS transferencia_destino_nome TEXT;

-- Consumo diário da IA por usuário (dia no fuso de Brasília)
CREATE TABLE IF NOT EXISTS public.ai_uso_diario (
  usuario_id     UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dia            DATE    NOT NULL,
  respostas      INTEGER NOT NULL DEFAULT 0,
  bloqueadas     INTEGER NOT NULL DEFAULT 0,
  tokens_entrada BIGINT  NOT NULL DEFAULT 0,
  tokens_saida   BIGINT  NOT NULL DEFAULT 0,
  avisado_limite BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (usuario_id, dia)
);

CREATE INDEX IF NOT EXISTS ai_uso_diario_dia_idx ON public.ai_uso_diario (dia);

ALTER TABLE public.ai_uso_diario ENABLE ROW LEVEL SECURITY;

-- Usuário vê o próprio consumo; admins veem o de todos. Escrita só pelo servidor.
DROP POLICY IF EXISTS ai_uso_diario_select ON public.ai_uso_diario;
CREATE POLICY ai_uso_diario_select ON public.ai_uso_diario
  FOR SELECT USING (
    auth.uid() = usuario_id
    OR EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid())
  );

GRANT SELECT ON public.ai_uso_diario TO authenticated;
GRANT ALL    ON public.ai_uso_diario TO service_role;

-- Reserva uma resposta da IA. Retorna 'ok', 'limite_usuario' ou 'limite_global'.
-- Atômico: um advisory lock serializa a checagem global, e o UPDATE condicional
-- garante que o limite por usuário nunca é ultrapassado, mesmo com mensagens simultâneas.
CREATE OR REPLACE FUNCTION public.ai_consumir_cota(
  p_usuario_id     UUID,
  p_limite_usuario INTEGER,
  p_limite_global  INTEGER
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dia    DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_global BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ai_consumir_cota_global'));

  INSERT INTO public.ai_uso_diario (usuario_id, dia)
  VALUES (p_usuario_id, v_dia)
  ON CONFLICT (usuario_id, dia) DO NOTHING;

  SELECT coalesce(sum(respostas), 0) INTO v_global
  FROM public.ai_uso_diario WHERE dia = v_dia;

  IF v_global >= p_limite_global THEN
    UPDATE public.ai_uso_diario SET bloqueadas = bloqueadas + 1
    WHERE usuario_id = p_usuario_id AND dia = v_dia;
    RETURN 'limite_global';
  END IF;

  UPDATE public.ai_uso_diario SET respostas = respostas + 1
  WHERE usuario_id = p_usuario_id AND dia = v_dia AND respostas < p_limite_usuario;

  IF NOT FOUND THEN
    UPDATE public.ai_uso_diario SET bloqueadas = bloqueadas + 1
    WHERE usuario_id = p_usuario_id AND dia = v_dia;
    RETURN 'limite_usuario';
  END IF;

  RETURN 'ok';
END;
$$;

-- Soma os tokens gastos numa resposta (para acompanhamento de custo).
CREATE OR REPLACE FUNCTION public.ai_registrar_tokens(
  p_usuario_id UUID,
  p_entrada    INTEGER,
  p_saida      INTEGER
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ai_uso_diario
  SET tokens_entrada = tokens_entrada + greatest(coalesce(p_entrada, 0), 0),
      tokens_saida   = tokens_saida   + greatest(coalesce(p_saida, 0), 0)
  WHERE usuario_id = p_usuario_id
    AND dia = (now() AT TIME ZONE 'America/Sao_Paulo')::date;
$$;

-- Marca que o usuário já foi avisado do limite hoje. Retorna true só na primeira vez.
CREATE OR REPLACE FUNCTION public.ai_marcar_aviso_limite(p_usuario_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ai_uso_diario SET avisado_limite = true
  WHERE usuario_id = p_usuario_id
    AND dia = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    AND avisado_limite = false;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_consumir_cota(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_registrar_tokens(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_marcar_aviso_limite(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_consumir_cota(UUID, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_registrar_tokens(UUID, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_marcar_aviso_limite(UUID) TO service_role;
