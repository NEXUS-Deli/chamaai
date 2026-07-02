-- Tabela de templates de mídia (imagens, vídeos, documentos, áudios)
CREATE TABLE IF NOT EXISTS public.media_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome        TEXT        NOT NULL,
  tipo        TEXT        NOT NULL CHECK (tipo IN ('image', 'video', 'document', 'audio')),
  url         TEXT        NOT NULL,
  storage_path TEXT       NOT NULL,
  mimetype    TEXT        NOT NULL,
  tamanho     BIGINT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.media_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_media_templates"
  ON public.media_templates
  FOR ALL
  USING (auth.uid() = usuario_id);

-- Trigger para atualizar atualizado_em automaticamente
CREATE OR REPLACE FUNCTION public.set_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER media_templates_atualizado_em
  BEFORE UPDATE ON public.media_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();

-- Bucket de storage para templates de mídia
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media-templates',
  'media-templates',
  true,
  52428800,
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Políticas de storage: upload apenas na própria pasta (userId/...)
CREATE POLICY "users_upload_media_templates"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'media-templates'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "public_read_media_templates"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'media-templates');

CREATE POLICY "users_delete_media_templates"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'media-templates'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
