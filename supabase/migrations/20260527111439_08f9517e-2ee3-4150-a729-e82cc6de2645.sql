ALTER TABLE public.ar_to_invoice_entries
  ADD COLUMN IF NOT EXISTS invoice_file_1 text NULL,
  ADD COLUMN IF NOT EXISTS invoice_file_2 text NULL;

INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='invoices-auth-all'
  ) THEN
    CREATE POLICY "invoices-auth-all"
      ON storage.objects FOR ALL TO authenticated
      USING (bucket_id = 'invoices')
      WITH CHECK (bucket_id = 'invoices');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='invoices-public-read'
  ) THEN
    CREATE POLICY "invoices-public-read"
      ON storage.objects FOR SELECT TO public
      USING (bucket_id = 'invoices');
  END IF;
END$$;