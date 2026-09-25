CREATE TABLE public.email_credentials (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    usuario_id uuid NOT NULL,
    host text NOT NULL,
    port integer NOT NULL,
    username text NOT NULL,
    password text NOT NULL,
    from_name text NOT NULL,
    from_email text NOT NULL,
    encryption text,
    criado_em timestamp with time zone NOT NULL DEFAULT now(),
    atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT email_credentials_pkey PRIMARY KEY (id),
    CONSTRAINT email_credentials_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.email_templates (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    usuario_id uuid NOT NULL,
    nome text NOT NULL,
    assunto text NOT NULL,
    conteudo_html text NOT NULL,
    criado_em timestamp with time zone NOT NULL DEFAULT now(),
    atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT email_templates_pkey PRIMARY KEY (id),
    CONSTRAINT email_templates_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.profiles(id)
);

-- Modificações na tabela de campanhas para suportar EMAIL
ALTER TABLE public.campanhas ADD COLUMN tipo_campanha text DEFAULT 'WHATSAPP';
ALTER TABLE public.campanhas ADD COLUMN email_credential_id uuid REFERENCES public.email_credentials(id) ON DELETE SET NULL;
ALTER TABLE public.campanhas ADD COLUMN email_assunto text;
ALTER TABLE public.campanhas ADD COLUMN email_conteudo_html text;
