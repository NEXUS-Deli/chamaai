-- Adiciona coluna codigo (identificador curto único por usuário) na tabela pastas
ALTER TABLE public.pastas ADD COLUMN IF NOT EXISTS codigo TEXT;

-- Função que gera um código curto único por usuário (ex: LC1, LC2, ...)
-- Usa sequência crescente: pasta_X onde X é o número de pastas do usuário + 1
CREATE OR REPLACE FUNCTION public.gerar_codigo_pasta(p_usuario_id UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_seq INTEGER;
  v_codigo TEXT;
BEGIN
  SELECT COUNT(*) + 1 INTO v_seq
  FROM public.pastas
  WHERE usuario_id = p_usuario_id AND codigo IS NOT NULL;

  v_codigo := 'LC' || v_seq::TEXT;

  -- Garante unicidade mesmo em casos de concorrência
  WHILE EXISTS (
    SELECT 1 FROM public.pastas
    WHERE usuario_id = p_usuario_id AND codigo = v_codigo
  ) LOOP
    v_seq := v_seq + 1;
    v_codigo := 'LC' || v_seq::TEXT;
  END LOOP;

  RETURN v_codigo;
END;
$$;

-- Trigger para preencher codigo automaticamente ao criar uma pasta
CREATE OR REPLACE FUNCTION public.set_codigo_pasta()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    NEW.codigo := public.gerar_codigo_pasta(NEW.usuario_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_codigo_pasta ON public.pastas;
CREATE TRIGGER trg_set_codigo_pasta
  BEFORE INSERT ON public.pastas
  FOR EACH ROW EXECUTE FUNCTION public.set_codigo_pasta();

-- Preenche o codigo nas pastas existentes (sem codigo ainda)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, usuario_id FROM public.pastas WHERE codigo IS NULL ORDER BY criada_em ASC
  LOOP
    UPDATE public.pastas
    SET codigo = public.gerar_codigo_pasta(r.usuario_id)
    WHERE id = r.id;
  END LOOP;
END;
$$;

-- Índice de unicidade: mesmo usuário não pode ter dois códigos iguais
CREATE UNIQUE INDEX IF NOT EXISTS idx_pastas_usuario_codigo
  ON public.pastas(usuario_id, codigo);
