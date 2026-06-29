-- Adiciona constraint UNIQUE em (usuario_id, telefone) para suportar upsert onConflict
ALTER TABLE public.leads
  ADD CONSTRAINT leads_usuario_telefone_unique UNIQUE (usuario_id, telefone);
