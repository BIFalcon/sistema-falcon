
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS attachment_url text NULL,
  ADD COLUMN IF NOT EXISTS attachment_name text NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='comment-attachments-authenticated-read') THEN
    CREATE POLICY "comment-attachments-authenticated-read" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'comment-attachments');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='comment-attachments-authenticated-insert') THEN
    CREATE POLICY "comment-attachments-authenticated-insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'comment-attachments');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='comment-attachments-authenticated-update') THEN
    CREATE POLICY "comment-attachments-authenticated-update" ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'comment-attachments')
      WITH CHECK (bucket_id = 'comment-attachments');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='comment-attachments-authenticated-delete') THEN
    CREATE POLICY "comment-attachments-authenticated-delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'comment-attachments');
  END IF;
END $$;
