-- Contador de mensagens lidas nas campanhas
ALTER TABLE public.campanhas
  ADD COLUMN IF NOT EXISTS lidos INTEGER NOT NULL DEFAULT 0;

-- Flag de webhook configurado por instância
ALTER TABLE public.instancias
  ADD COLUMN IF NOT EXISTS webhook_configurado BOOLEAN NOT NULL DEFAULT false;

-- Função atômica para incrementar lidos
CREATE OR REPLACE FUNCTION incrementar_lidos(p_campanha_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.campanhas
  SET lidos = lidos + 1
  WHERE id = p_campanha_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
