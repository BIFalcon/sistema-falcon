DROP POLICY IF EXISTS "hotel_assets_public_read" ON storage.objects;
DROP POLICY IF EXISTS "rh_assets_select_public" ON storage.objects;

CREATE POLICY "hotel_assets_authenticated_read"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'hotel-assets' AND public.has_any_role(auth.uid()));