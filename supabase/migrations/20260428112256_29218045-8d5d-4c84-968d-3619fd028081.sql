-- 1) Allow GG to upload/link/delete documents directly (not only financeiro/master)
DROP POLICY IF EXISTS ap_documents_insert_managers ON public.ap_documents;
DROP POLICY IF EXISTS ap_documents_update_managers ON public.ap_documents;
DROP POLICY IF EXISTS ap_documents_delete_managers ON public.ap_documents;

CREATE POLICY ap_documents_insert_scoped ON public.ap_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    (uploaded_by = auth.uid())
    AND public.is_hotel_allowed(auth.uid(), hotel_id)
    AND (public.is_ap_manager(auth.uid()) OR public.has_role(auth.uid(), 'gg'::app_role))
  );

CREATE POLICY ap_documents_update_scoped ON public.ap_documents
  FOR UPDATE TO authenticated
  USING (
    public.is_hotel_allowed(auth.uid(), hotel_id)
    AND (public.is_ap_manager(auth.uid()) OR public.has_role(auth.uid(), 'gg'::app_role))
  );

CREATE POLICY ap_documents_delete_scoped ON public.ap_documents
  FOR DELETE TO authenticated
  USING (
    public.is_hotel_allowed(auth.uid(), hotel_id)
    AND (public.is_ap_manager(auth.uid()) OR public.has_role(auth.uid(), 'gg'::app_role))
  );

-- 2) Storage bucket policies — allow GG to upload/read documents in `accounts-payable` bucket
-- Existing policies likely restrict to managers. Add a permissive insert/select/delete for GG too.
-- (We don't drop existing manager policies; we ADD GG access.)

DO $$
BEGIN
  -- INSERT
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='ap_storage_insert_gg_or_manager') THEN
    CREATE POLICY ap_storage_insert_gg_or_manager
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'accounts-payable'
        AND (public.is_ap_manager(auth.uid()) OR public.has_role(auth.uid(), 'gg'::app_role))
      );
  END IF;
  -- SELECT (anyone with role can read; signed URL also handles unauth)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='ap_storage_select_role') THEN
    CREATE POLICY ap_storage_select_role
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'accounts-payable'
        AND public.has_any_role(auth.uid())
      );
  END IF;
  -- DELETE
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='ap_storage_delete_gg_or_manager') THEN
    CREATE POLICY ap_storage_delete_gg_or_manager
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'accounts-payable'
        AND (public.is_ap_manager(auth.uid()) OR public.has_role(auth.uid(), 'gg'::app_role))
      );
  END IF;
END$$;

-- 3) Add validation columns to ap_documents (AI-driven validation result)
ALTER TABLE public.ap_documents
  ADD COLUMN IF NOT EXISTS doc_cnpj text,
  ADD COLUMN IF NOT EXISTS doc_type text,           -- 'nfe' | 'nfse' | 'boleto' | 'recibo' | 'outro'
  ADD COLUMN IF NOT EXISTS validation_status text,  -- 'ok' | 'divergence' | 'unreadable' | 'pending'
  ADD COLUMN IF NOT EXISTS validation_details jsonb,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz;

-- 4) Add stable lookup key to ap_entries to preserve doc links across re-uploads
-- Lookup key uses ONLY (supplier ascii|document_number) — survives changes in due/amount.
ALTER TABLE public.ap_entries
  ADD COLUMN IF NOT EXISTS lookup_key text;

CREATE INDEX IF NOT EXISTS idx_ap_entries_lookup_key
  ON public.ap_entries (hotel_id, lookup_key);

-- Backfill lookup_key for existing rows using current supplier+document_number
UPDATE public.ap_entries
SET lookup_key = lower(regexp_replace(supplier, '\s+', ' ', 'g'))
                 || '|'
                 || coalesce(nullif(trim(document_number), ''), '')
WHERE lookup_key IS NULL;