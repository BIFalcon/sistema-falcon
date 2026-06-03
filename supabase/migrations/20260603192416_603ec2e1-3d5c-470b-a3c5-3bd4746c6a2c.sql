-- Restrict accounts-payable storage SELECT to exclude viewer and ri
DROP POLICY IF EXISTS ap_storage_select ON storage.objects;
CREATE POLICY ap_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'accounts-payable'
    AND is_hotel_allowed(auth.uid(), split_part(name, '/', 1))
    AND NOT has_role(auth.uid(), 'viewer'::app_role)
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  );

-- Restrict hotels SELECT to exclude viewer and ri (sensitive: bank_accounts, cnpj)
DROP POLICY IF EXISTS hotels_select_any_role ON public.hotels;
CREATE POLICY hotels_select_any_role ON public.hotels
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid())
    AND NOT has_role(auth.uid(), 'viewer'::app_role)
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  );