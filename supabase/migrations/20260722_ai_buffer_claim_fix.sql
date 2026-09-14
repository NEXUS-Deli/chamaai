-- ============================================================
-- Corrige claimBuffer: UPDATE...RETURNING sempre devolve o valor DEPOIS da
-- alteração, nunca o de antes. Como a query zerava "mensagens" e tentava
-- devolver "mensagens" na mesma instrução, sempre voltava um array vazio —
-- o lote nunca era processado, mesmo com mensagens de verdade no buffer.
--
-- Esta função resolve isso com um CTE que lê o valor ANTES do UPDATE
-- (com FOR UPDATE pra travar a linha e manter o compare-and-swap atômico:
-- só "ganha" quem ainda bate lock_token = p_token no momento da transação),
-- e o UPDATE devolve esse valor pré-capturado, não o pós-atualização.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ai_buffer_claim(
  p_instancia_id UUID,
  p_numero       TEXT,
  p_token        UUID
) RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH old AS (
    SELECT mensagens
    FROM public.ai_buffer
    WHERE instancia_id = p_instancia_id
      AND numero = p_numero
      AND lock_token = p_token
    FOR UPDATE
  )
  UPDATE public.ai_buffer AS b
  SET mensagens = '[]'::jsonb, lock_token = NULL, atualizado_em = now()
  FROM old
  WHERE b.instancia_id = p_instancia_id
    AND b.numero = p_numero
    AND b.lock_token = p_token
  RETURNING old.mensagens;
$$;

REVOKE ALL ON FUNCTION public.ai_buffer_claim(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_buffer_claim(UUID, TEXT, UUID) TO service_role;
