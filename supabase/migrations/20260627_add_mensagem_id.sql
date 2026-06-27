-- Adiciona ID da mensagem para rastreamento de entrega via webhook uazapi
ALTER TABLE public.contatos_campanha
  ADD COLUMN IF NOT EXISTS mensagem_id TEXT;

CREATE INDEX IF NOT EXISTS idx_contatos_mensagem_id
  ON public.contatos_campanha (mensagem_id)
  WHERE mensagem_id IS NOT NULL;

-- Função para incrementar o contador de entregues atomicamente
CREATE OR REPLACE FUNCTION incrementar_entregues(p_campanha_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.campanhas
  SET entregues = entregues + 1
  WHERE id = p_campanha_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
