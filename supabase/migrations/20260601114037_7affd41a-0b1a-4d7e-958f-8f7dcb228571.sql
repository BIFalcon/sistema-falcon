INSERT INTO storage.buckets (id, name, public)
VALUES ('rh-photos', 'rh-photos', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='rh-photos-public-read') THEN
    CREATE POLICY "rh-photos-public-read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'rh-photos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='rh-photos-auth-upload') THEN
    CREATE POLICY "rh-photos-auth-upload"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'rh-photos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='rh-photos-auth-update') THEN
    CREATE POLICY "rh-photos-auth-update"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (bucket_id = 'rh-photos');
  END IF;
END $$;