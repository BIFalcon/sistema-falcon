
CREATE OR REPLACE FUNCTION public.hotel_slug(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(
    regexp_replace(
      regexp_replace(coalesce(_name, ''), '[^a-zA-Z0-9]+', '-', 'g'),
      '(^-+|-+$)', '', 'g'
    )
  );
$$;

DROP POLICY IF EXISTS hotel_assets_authenticated_read ON storage.objects;

CREATE POLICY hotel_assets_scoped_read
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'hotel-assets'
  AND (
    public.is_master(auth.uid())
    OR public.has_global_data_access(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.hotels h
      JOIN public.user_hotels uh ON uh.hotel_id = h.id
      WHERE uh.user_id = auth.uid()
        AND (
          h.id::text = split_part(objects.name, '/', 1)
          OR public.hotel_slug(h.name) = split_part(objects.name, '/', 1)
        )
    )
  )
);
