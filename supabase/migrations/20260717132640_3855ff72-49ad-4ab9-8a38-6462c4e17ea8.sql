CREATE POLICY "user_avatars_auth_read" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'user-avatars');

CREATE POLICY "user_avatars_self_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'user-avatars'
  AND split_part(name, '.', 1) = auth.uid()::text
);

CREATE POLICY "user_avatars_self_update" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'user-avatars'
  AND split_part(name, '.', 1) = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'user-avatars'
  AND split_part(name, '.', 1) = auth.uid()::text
);

CREATE POLICY "user_avatars_self_delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'user-avatars'
  AND split_part(name, '.', 1) = auth.uid()::text
);