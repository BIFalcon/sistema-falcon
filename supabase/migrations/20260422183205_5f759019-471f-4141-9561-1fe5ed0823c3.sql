DROP POLICY IF EXISTS storage_hotel_assets_public_read ON storage.objects;
DROP POLICY IF EXISTS storage_system_assets_public_read ON storage.objects;

-- Restringe LISTAGEM a autenticados (URLs públicas continuam funcionando)
CREATE POLICY storage_hotel_assets_auth_list ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'hotel-assets');

CREATE POLICY storage_system_assets_auth_list ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'system-assets');