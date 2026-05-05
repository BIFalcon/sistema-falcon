
CREATE POLICY "avatars_user_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'system-assets'
  AND (storage.foldername(name))[1] = 'avatars'
  AND split_part(split_part(name, '/', 2), '.', 1) = auth.uid()::text
);

CREATE POLICY "avatars_user_update" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'system-assets'
  AND (storage.foldername(name))[1] = 'avatars'
  AND split_part(split_part(name, '/', 2), '.', 1) = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'system-assets'
  AND (storage.foldername(name))[1] = 'avatars'
  AND split_part(split_part(name, '/', 2), '.', 1) = auth.uid()::text
);

CREATE POLICY "avatars_user_delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'system-assets'
  AND (storage.foldername(name))[1] = 'avatars'
  AND split_part(split_part(name, '/', 2), '.', 1) = auth.uid()::text
);
