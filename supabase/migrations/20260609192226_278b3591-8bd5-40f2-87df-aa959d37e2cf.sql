
CREATE POLICY "midias_read_own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'midias-campanhas' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "midias_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'midias-campanhas' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "midias_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'midias-campanhas' AND (storage.foldername(name))[1] = auth.uid()::text);
