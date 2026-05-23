
-- 1. Remove broad investor-letters insert policy
DROP POLICY IF EXISTS "storage_letters_insert" ON storage.objects;

-- 2. Tighten AP storage GG policies to require hotel scope
DROP POLICY IF EXISTS "ap_storage_insert_gg_or_manager" ON storage.objects;
DROP POLICY IF EXISTS "ap_storage_delete_gg_or_manager" ON storage.objects;

CREATE POLICY "ap_storage_insert_gg_or_manager"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'accounts-payable'
  AND (
    is_ap_manager(auth.uid())
    OR (
      has_role(auth.uid(), 'gg'::app_role)
      AND is_hotel_allowed(auth.uid(), split_part(name, '/', 1))
    )
  )
);

CREATE POLICY "ap_storage_delete_gg_or_manager"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'accounts-payable'
  AND (
    is_ap_manager(auth.uid())
    OR (
      has_role(auth.uid(), 'gg'::app_role)
      AND is_hotel_allowed(auth.uid(), split_part(name, '/', 1))
    )
  )
);

-- 3. Restrict ar_uploads SELECT to AR managers only
DROP POLICY IF EXISTS "ar_uploads_select_any_role" ON public.ar_uploads;

CREATE POLICY "ar_uploads_select_managers"
ON public.ar_uploads
FOR SELECT
TO authenticated
USING (is_ar_manager(auth.uid()));
