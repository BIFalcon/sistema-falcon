
-- rh-photos: remove public read, restrict SELECT to authenticated users with a role
DROP POLICY IF EXISTS "rh-photos-public-read" ON storage.objects;
CREATE POLICY "rh-photos-authenticated-read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'rh-photos' AND public.has_any_role(auth.uid()));

-- rh-assets: remove public read, restrict SELECT to authenticated users with a role
DROP POLICY IF EXISTS "rh-assets-public-read" ON storage.objects;
DROP POLICY IF EXISTS "rh-assets public read" ON storage.objects;
CREATE POLICY "rh-assets-authenticated-read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'rh-assets' AND public.has_any_role(auth.uid()));
