DROP POLICY IF EXISTS closings_storage_select_scoped ON storage.objects;

CREATE POLICY closings_storage_select_scoped ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'closings'
  AND (
    public.is_master(auth.uid())
    OR (
      public.has_global_data_access(auth.uid())
      AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
    )
    OR EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id::text = split_part(storage.objects.name, '/', 1)
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  )
);