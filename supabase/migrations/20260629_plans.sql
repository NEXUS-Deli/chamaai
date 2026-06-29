-- ============================================================
-- Planos de uso e controle de conexões WhatsApp
-- ============================================================

-- Tabela de planos disponíveis (administrada via service_role)
CREATE TABLE IF NOT EXISTS public.plans (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  max_connections INTEGER     NOT NULL CHECK (max_connections > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- Usuários autenticados só leem; escrita exclusiva do service_role
CREATE POLICY "plans_select" ON public.plans
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.plans TO authenticated;
GRANT ALL    ON public.plans TO service_role;

-- Seed: 4 planos fixos
INSERT INTO public.plans (name, max_connections) VALUES
  ('Starter',  1),
  ('Basic',    3),
  ('Pro',      5),
  ('Business', 10)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Associação usuário → plano (um registro por usuário)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_plans (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id    UUID        NOT NULL REFERENCES public.plans(id),
  active     BOOLEAN     NOT NULL DEFAULT true,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.user_plans ENABLE ROW LEVEL SECURITY;

-- Usuário lê e edita apenas o próprio registro
CREATE POLICY "own_user_plans" ON public.user_plans
  FOR ALL
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_plans TO authenticated;
GRANT ALL ON public.user_plans TO service_role;
