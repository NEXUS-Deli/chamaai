
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  nome TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_profile" ON public.profiles FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.configuracoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  webhook_criar TEXT DEFAULT '',
  webhook_pausar TEXT DEFAULT '',
  webhook_retomar TEXT DEFAULT '',
  webhook_cancelar TEXT DEFAULT '',
  webhook_status TEXT DEFAULT '',
  instancia_uazapi TEXT DEFAULT '',
  token_uazapi TEXT DEFAULT '',
  nome_produto TEXT DEFAULT 'Chama AI Delivery',
  cor_primaria TEXT DEFAULT '#FF5C00',
  logo_url TEXT DEFAULT '',
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.configuracoes TO authenticated;
GRANT ALL ON public.configuracoes TO service_role;
ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_config" ON public.configuracoes FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);

CREATE TABLE public.pastas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pastas_usuario ON public.pastas(usuario_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pastas TO authenticated;
GRANT ALL ON public.pastas TO service_role;
ALTER TABLE public.pastas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_pastas" ON public.pastas FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);

CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pasta_id UUID REFERENCES public.pastas(id) ON DELETE SET NULL,
  telefone TEXT NOT NULL,
  nome TEXT,
  empresa TEXT,
  notas TEXT,
  importado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_leads_usuario_pasta ON public.leads(usuario_id, pasta_id);
CREATE INDEX idx_leads_usuario_telefone ON public.leads(usuario_id, telefone);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_leads" ON public.leads FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);

CREATE TABLE public.leads_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  UNIQUE(lead_id, tag)
);
CREATE INDEX idx_leads_tags_lead ON public.leads_tags(lead_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads_tags TO authenticated;
GRANT ALL ON public.leads_tags TO service_role;
ALTER TABLE public.leads_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_lead_tags" ON public.leads_tags FOR ALL
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND l.usuario_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND l.usuario_id = auth.uid()));

CREATE TABLE public.campanhas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  midia_url TEXT,
  delay_segundos INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'aguardando',
  total_contatos INTEGER NOT NULL DEFAULT 0,
  enviadas INTEGER NOT NULL DEFAULT 0,
  entregues INTEGER NOT NULL DEFAULT 0,
  erros INTEGER NOT NULL DEFAULT 0,
  agendada_para TIMESTAMPTZ,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_campanhas_usuario ON public.campanhas(usuario_id, criada_em DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campanhas TO authenticated;
GRANT ALL ON public.campanhas TO service_role;
ALTER TABLE public.campanhas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_campanhas" ON public.campanhas FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);

CREATE TABLE public.contatos_campanha (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id UUID NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
  telefone TEXT NOT NULL,
  nome TEXT,
  empresa TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contatos_campanha ON public.contatos_campanha(campanha_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contatos_campanha TO authenticated;
GRANT ALL ON public.contatos_campanha TO service_role;
ALTER TABLE public.contatos_campanha ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_contatos_campanha" ON public.contatos_campanha FOR ALL
  USING (EXISTS (SELECT 1 FROM public.campanhas c WHERE c.id = campanha_id AND c.usuario_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.campanhas c WHERE c.id = campanha_id AND c.usuario_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nome)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)));
  INSERT INTO public.configuracoes (usuario_id) VALUES (NEW.id);
  INSERT INTO public.pastas (usuario_id, nome) VALUES (NEW.id, 'Geral');
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_leads_upd BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();
CREATE TRIGGER trg_campanhas_upd BEFORE UPDATE ON public.campanhas FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();
CREATE TRIGGER trg_contatos_campanha_upd BEFORE UPDATE ON public.contatos_campanha FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();
