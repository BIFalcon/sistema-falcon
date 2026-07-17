
DROP POLICY IF EXISTS closings_storage_insert_uploader ON storage.objects;
DROP POLICY IF EXISTS storage_closings_insert ON storage.objects;

CREATE POLICY closings_storage_insert_uploader ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'closings'
  AND is_dre_uploader(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id::text = split_part(storage.objects.name, '/', 1)
      AND is_hotel_allowed(auth.uid(), c.hotel_id)
  )
);

CREATE POLICY storage_closings_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'closings'
  AND is_dre_uploader(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id::text = split_part(storage.objects.name, '/', 1)
      AND is_hotel_allowed(auth.uid(), c.hotel_id)
  )
);
