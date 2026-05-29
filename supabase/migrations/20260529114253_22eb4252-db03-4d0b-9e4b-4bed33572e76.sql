
-- 1. Fix ap_entries UPDATE WITH CHECK to mirror USING (role requirement)
DROP POLICY IF EXISTS ap_entries_update_scoped ON public.ap_entries;
CREATE POLICY ap_entries_update_scoped ON public.ap_entries
  FOR UPDATE TO authenticated
  USING (is_hotel_allowed(auth.uid(), hotel_id) AND (is_ap_manager(auth.uid()) OR has_role(auth.uid(), 'gg'::app_role)))
  WITH CHECK (is_hotel_allowed(auth.uid(), hotel_id) AND (is_ap_manager(auth.uid()) OR has_role(auth.uid(), 'gg'::app_role)));

-- 2. Make invoices bucket private and replace policies with hotel-scoped ones
UPDATE storage.buckets SET public = false WHERE id = 'invoices';

DROP POLICY IF EXISTS "invoices-public-read" ON storage.objects;
DROP POLICY IF EXISTS "invoices-auth-all" ON storage.objects;

CREATE POLICY invoices_select_scoped ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'invoices' AND (
      is_ar_manager(auth.uid())
      OR has_role(auth.uid(),'controladoria'::app_role)
      OR is_hotel_allowed(auth.uid(), split_part(name,'/',1))
    )
  );

CREATE POLICY invoices_insert_scoped ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'invoices' AND (
      is_ar_manager(auth.uid())
      OR (has_role(auth.uid(),'gg'::app_role) AND is_hotel_allowed(auth.uid(), split_part(name,'/',1)))
    )
  );

CREATE POLICY invoices_update_scoped ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'invoices' AND (
      is_ar_manager(auth.uid())
      OR (has_role(auth.uid(),'gg'::app_role) AND is_hotel_allowed(auth.uid(), split_part(name,'/',1)))
    )
  )
  WITH CHECK (
    bucket_id = 'invoices' AND (
      is_ar_manager(auth.uid())
      OR (has_role(auth.uid(),'gg'::app_role) AND is_hotel_allowed(auth.uid(), split_part(name,'/',1)))
    )
  );

CREATE POLICY invoices_delete_managers ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'invoices' AND is_ar_manager(auth.uid()));

-- 3. Remove broad role-only SELECT policies that bypass hotel scoping
DROP POLICY IF EXISTS ap_storage_select_role ON storage.objects;
DROP POLICY IF EXISTS ar_storage_read_authenticated ON storage.objects;
DROP POLICY IF EXISTS closings_storage_read_scoped ON storage.objects;
DROP POLICY IF EXISTS storage_closings_select ON storage.objects;
DROP POLICY IF EXISTS letters_storage_read_scoped ON storage.objects;
DROP POLICY IF EXISTS storage_letters_select ON storage.objects;

-- AR: only AR managers and controladoria can read (files are global multi-hotel reports)
CREATE POLICY ar_storage_read_managers ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'accounts-receivable' AND (
      is_ar_manager(auth.uid())
      OR has_role(auth.uid(),'controladoria'::app_role)
    )
  );

-- Closings bucket: paths start with closing_id; resolve hotel via closings table
CREATE POLICY closings_storage_select_scoped ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'closings' AND (
      has_global_data_access(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.closings c
        WHERE c.id::text = split_part(name,'/',1)
          AND is_hotel_allowed(auth.uid(), c.hotel_id)
      )
    )
  );

-- Investor letters bucket: paths start with closing_id
CREATE POLICY letters_storage_select_scoped ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'investor-letters' AND (
      has_global_data_access(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.closings c
        WHERE c.id::text = split_part(name,'/',1)
          AND is_hotel_allowed(auth.uid(), c.hotel_id)
      )
    )
  );

-- 4. Letters INSERT: require GG to have hotel access for the file's closing
DROP POLICY IF EXISTS letters_storage_insert_scoped ON storage.objects;
CREATE POLICY letters_storage_insert_scoped ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'investor-letters' AND (
      is_master(auth.uid())
      OR has_role(auth.uid(),'gop'::app_role)
      OR has_role(auth.uid(),'controladoria'::app_role)
      OR (
        has_role(auth.uid(),'gg'::app_role)
        AND EXISTS (
          SELECT 1 FROM public.closings c
          WHERE c.id::text = split_part(name,'/',1)
            AND is_hotel_allowed(auth.uid(), c.hotel_id)
        )
      )
    )
  );
