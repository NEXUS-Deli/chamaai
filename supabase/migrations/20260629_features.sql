-- ============================================================
-- Templates de Mensagem
-- ============================================================
CREATE TABLE public.message_templates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome          TEXT        NOT NULL,
  mensagem      TEXT        NOT NULL,
  midia_url     TEXT,
  midia_tipo    TEXT,
  midia_nome    TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_templates" ON public.message_templates
  FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_templates TO authenticated;
GRANT ALL ON public.message_templates TO service_role;
CREATE TRIGGER trg_templates_upd
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();

-- ============================================================
-- Blacklist (opt-out)
-- ============================================================
CREATE TABLE public.blacklist (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telefone   TEXT        NOT NULL,
  motivo     TEXT,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(usuario_id, telefone)
);
ALTER TABLE public.blacklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_blacklist" ON public.blacklist
  FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blacklist TO authenticated;
GRANT ALL ON public.blacklist TO service_role;

-- ============================================================
-- Notificações internas
-- ============================================================
CREATE TABLE public.notificacoes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo     TEXT        NOT NULL,
  mensagem   TEXT,
  tipo       TEXT        NOT NULL DEFAULT 'info'
                         CHECK (tipo IN ('info','sucesso','erro','aviso')),
  lida       BOOLEAN     NOT NULL DEFAULT false,
  link       TEXT,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_notificacoes" ON public.notificacoes
  FOR ALL USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notificacoes TO authenticated;
GRANT ALL ON public.notificacoes TO service_role;
CREATE INDEX idx_notificacoes_usuario ON public.notificacoes(usuario_id, criado_em DESC);

-- Trigger: gera notificação automática quando campanha conclui ou é cancelada
CREATE OR REPLACE FUNCTION public.notificar_campanha()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'concluida' AND OLD.status <> 'concluida' THEN
    INSERT INTO public.notificacoes(usuario_id, titulo, mensagem, tipo, link)
    VALUES(NEW.usuario_id,
           'Campanha concluída: ' || NEW.nome,
           NEW.enviadas || ' mensagens enviadas • ' || COALESCE(NEW.erros,0) || ' erros.',
           'sucesso', '/campanhas/' || NEW.id);
  ELSIF NEW.status = 'cancelada' AND OLD.status <> 'cancelada' THEN
    INSERT INTO public.notificacoes(usuario_id, titulo, mensagem, tipo, link)
    VALUES(NEW.usuario_id,
           'Campanha cancelada: ' || NEW.nome,
           NEW.enviadas || ' mensagens enviadas antes do cancelamento.',
           'aviso', '/campanhas/' || NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notificar_campanha
  AFTER UPDATE ON public.campanhas
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.notificar_campanha();

-- ============================================================
-- Recorrência de Stories
-- ============================================================
ALTER TABLE public.stories_agendamentos
  ADD COLUMN IF NOT EXISTS recorrente       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recorrencia      TEXT    CHECK (recorrencia IN ('diario','semanal','mensal')),
  ADD COLUMN IF NOT EXISTS proxima_execucao TIMESTAMPTZ;
