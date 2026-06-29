ALTER TABLE public.message_templates ADD COLUMN IF NOT EXISTS variacoes TEXT[] NOT NULL DEFAULT '{}';
