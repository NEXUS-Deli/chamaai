-- Cria a tabela de instâncias WhatsApp (UAZAPI)
CREATE TABLE IF NOT EXISTS public.instancias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  instancia TEXT NOT NULL,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  criada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_instancias_usuario ON public.instancias(usuario_id, criada_em DESC);

-- Permissões
GRANT SELECT, INSERT, UPDATE, DELETE ON public.instancias TO authenticated;
GRANT ALL ON public.instancias TO service_role;

-- Row Level Security
ALTER TABLE public.instancias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_instancias" ON public.instancias
  FOR ALL
  USING (auth.uid() = usuario_id)
  WITH CHECK (auth.uid() = usuario_id);

-- Trigger para atualizar atualizada_em automaticamente
CREATE OR REPLACE FUNCTION public.set_instancias_atualizada_em()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.atualizada_em = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_instancias_upd
  BEFORE UPDATE ON public.instancias
  FOR EACH ROW EXECUTE FUNCTION public.set_instancias_atualizada_em();
