-- Coluna de controle na tabela campanhas
ALTER TABLE campanhas
  ADD COLUMN IF NOT EXISTS aguardando_confirmacao BOOLEAN NOT NULL DEFAULT false;

-- Colunas de ação nas notificações
ALTER TABLE notificacoes
  ADD COLUMN IF NOT EXISTS acao_tipo TEXT,
  ADD COLUMN IF NOT EXISTS acao_dados JSONB,
  ADD COLUMN IF NOT EXISTS acao_respondida BOOLEAN NOT NULL DEFAULT false;
