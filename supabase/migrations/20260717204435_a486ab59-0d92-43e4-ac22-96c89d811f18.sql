DROP POLICY IF EXISTS letters_storage_select_scoped ON storage.objects;

CREATE POLICY letters_storage_select_scoped
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'investor-letters'
  AND (
    public.has_global_data_access(auth.uid())
    OR public.has_role(auth.uid(), 'fernando')
    OR EXISTS (
      SELECT 1
      FROM public.closings c
      WHERE c.id::text = split_part(storage.objects.name, '/', 1)
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  )
);