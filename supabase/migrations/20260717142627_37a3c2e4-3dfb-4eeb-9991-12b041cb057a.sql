DROP POLICY IF EXISTS user_avatars_auth_read ON storage.objects;
CREATE POLICY user_avatars_self_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'user-avatars' AND split_part(name, '.', 1) = auth.uid()::text);