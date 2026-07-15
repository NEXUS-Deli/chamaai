-- ============================================================
-- Atendimento com IA — tabelas do agente de IA por WhatsApp
-- ============================================================

-- Configuração de IA por usuário (provedor, chave, prompt, modelo)
CREATE TABLE IF NOT EXISTS public.ai_configuracoes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provedor      TEXT        NOT NULL DEFAULT 'openai',
  api_key       TEXT,
  modelo        TEXT,
  system_prompt TEXT        DEFAULT 'Você é um assistente útil do WhatsApp. Responda de forma breve, natural e em português.',
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(usuario_id)
);

ALTER TABLE public.ai_configuracoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_ai_configuracoes" ON public.ai_configuracoes
  FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_configuracoes TO authenticated;
GRANT ALL ON public.ai_configuracoes TO service_role;

-- Habilitação do agente de IA por instância WhatsApp
CREATE TABLE IF NOT EXISTS public.ai_instancias (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instancia_id UUID        NOT NULL REFERENCES public.instancias(id) ON DELETE CASCADE,
  ativo        BOOLEAN     NOT NULL DEFAULT false,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(instancia_id)
);

ALTER TABLE public.ai_instancias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_ai_instancias" ON public.ai_instancias
  FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_instancias TO authenticated;
GRANT ALL ON public.ai_instancias TO service_role;

-- Contatos excluídos do agente de IA (por instância)
CREATE TABLE IF NOT EXISTS public.ai_contatos_excluidos (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instancia_id UUID        NOT NULL REFERENCES public.instancias(id) ON DELETE CASCADE,
  telefone     TEXT        NOT NULL,
  nome         TEXT,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(instancia_id, telefone)
);

ALTER TABLE public.ai_contatos_excluidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_ai_contatos_excluidos" ON public.ai_contatos_excluidos
  FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_contatos_excluidos TO authenticated;
GRANT ALL ON public.ai_contatos_excluidos TO service_role;

-- Histórico de conversas (contexto do agente de IA por contato por instância)
CREATE TABLE IF NOT EXISTS public.ai_conversas (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instancia_id UUID        NOT NULL REFERENCES public.instancias(id) ON DELETE CASCADE,
  numero       TEXT        NOT NULL,
  role         TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  mensagem     TEXT        NOT NULL,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_conversas_lookup
  ON public.ai_conversas(instancia_id, numero, criado_em DESC);

CREATE INDEX IF NOT EXISTS ai_conversas_usuario
  ON public.ai_conversas(usuario_id, criado_em DESC);

ALTER TABLE public.ai_conversas ENABLE ROW LEVEL SECURITY;

-- Usuário lê apenas o próprio histórico; escrita exclusiva do service_role
CREATE POLICY "own_ai_conversas_select" ON public.ai_conversas
  FOR SELECT USING (auth.uid() = usuario_id);

GRANT SELECT ON public.ai_conversas TO authenticated;
GRANT ALL    ON public.ai_conversas TO service_role;
