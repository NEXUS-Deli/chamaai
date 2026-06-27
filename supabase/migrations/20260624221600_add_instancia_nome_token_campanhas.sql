-- Adiciona colunas de configurações da campanha e detalhes de conexão da instância do WhatsApp na tabela campanhas
ALTER TABLE public.campanhas ADD COLUMN IF NOT EXISTS instancia_whatsapp UUID REFERENCES public.instancias(id) ON DELETE SET NULL;
ALTER TABLE public.campanhas ADD COLUMN IF NOT EXISTS delay_minimo INTEGER DEFAULT 5;
ALTER TABLE public.campanhas ADD COLUMN IF NOT EXISTS delay_maximo INTEGER DEFAULT 15;
ALTER TABLE public.campanhas ADD COLUMN IF NOT EXISTS delay_mensagens INTEGER DEFAULT 3;
ALTER TABLE public.campanhas ADD COLUMN IF NOT EXISTS instancia_nome TEXT;
ALTER TABLE public.campanhas ADD COLUMN IF NOT EXISTS instancia_token TEXT;
ALTER TABLE public.campanhas ADD COLUMN IF NOT EXISTS midia_nome TEXT;
ALTER TABLE public.campanhas ADD COLUMN IF NOT EXISTS midia_tipo TEXT;
ALTER TABLE public.campanhas ADD COLUMN IF NOT EXISTS midia_path TEXT;
ALTER TABLE public.campanhas ADD COLUMN IF NOT EXISTS midia_bucket TEXT;
