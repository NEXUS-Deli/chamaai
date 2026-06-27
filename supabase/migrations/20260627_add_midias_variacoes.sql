-- Variações de mídia para sorteio por disparo (até 10 arquivos)
ALTER TABLE public.campanhas
  ADD COLUMN IF NOT EXISTS midias_variacoes JSONB DEFAULT '[]';
