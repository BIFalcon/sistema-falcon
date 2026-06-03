DROP POLICY IF EXISTS ap_storage_select ON storage.objects;
CREATE POLICY ap_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'accounts-payable'
    AND public.is_hotel_allowed(auth.uid(), split_part(name, '/', 1))
    AND NOT public.has_role(auth.uid(), 'viewer'::public.app_role)
    AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
    AND NOT public.has_role(auth.uid(), 'gg'::public.app_role)
  );