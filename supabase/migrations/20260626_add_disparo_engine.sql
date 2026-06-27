-- Motor de disparo nativo: suporte a múltiplas instâncias, variações de mensagem e janela de horário

-- Campanhas: suporte a múltiplas instâncias e variações de mensagem
ALTER TABLE public.campanhas
  ADD COLUMN IF NOT EXISTS instancias_selecionadas JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS mensagens_variacoes JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS horario_inicio TEXT DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS horario_fim TEXT DEFAULT '22:00';

-- Contatos de campanha: agendamento de envio por contato e rastreamento
ALTER TABLE public.contatos_campanha
  ADD COLUMN IF NOT EXISTS next_send_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS instancia_usada TEXT,
  ADD COLUMN IF NOT EXISTS mensagem_enviada TEXT,
  ADD COLUMN IF NOT EXISTS wpp_valido BOOLEAN;

-- Índice para a fila de envio (cron precisa achar contatos prontos rapidamente)
CREATE INDEX IF NOT EXISTS idx_contatos_next_send
  ON public.contatos_campanha (campanha_id, next_send_at)
  WHERE status = 'pendente';

-- Campanhas agendadas: índice para o scheduler encontrar rápido
CREATE INDEX IF NOT EXISTS idx_campanhas_agendadas
  ON public.campanhas (agendada_para)
  WHERE status = 'agendada';
