
-- 1) AR tables: exclude viewer/ri from SELECT
DROP POLICY IF EXISTS ar_ti_select_scoped ON public.ar_to_invoice_entries;
CREATE POLICY ar_ti_select_scoped ON public.ar_to_invoice_entries FOR SELECT TO authenticated
USING (
  (is_master(auth.uid()) OR has_role(auth.uid(),'controladoria'::app_role) OR has_role(auth.uid(),'patronos'::app_role)
   OR (hotel_id IS NOT NULL AND is_hotel_allowed(auth.uid(), hotel_id)))
  AND NOT has_role(auth.uid(),'viewer'::app_role)
  AND NOT has_role(auth.uid(),'ri'::app_role)
);

DROP POLICY IF EXISTS ar_of_select_scoped ON public.ar_open_folio_entries;
CREATE POLICY ar_of_select_scoped ON public.ar_open_folio_entries FOR SELECT TO authenticated
USING (
  (is_master(auth.uid()) OR has_role(auth.uid(),'controladoria'::app_role) OR has_role(auth.uid(),'patronos'::app_role)
   OR (hotel_id IS NOT NULL AND is_hotel_allowed(auth.uid(), hotel_id)))
  AND NOT has_role(auth.uid(),'viewer'::app_role)
  AND NOT has_role(auth.uid(),'ri'::app_role)
);

DROP POLICY IF EXISTS ar_ofn_select_scoped ON public.ar_open_folio_notes;
CREATE POLICY ar_ofn_select_scoped ON public.ar_open_folio_notes FOR SELECT TO authenticated
USING (
  (is_master(auth.uid()) OR has_role(auth.uid(),'controladoria'::app_role) OR has_role(auth.uid(),'patronos'::app_role)
   OR is_hotel_allowed(auth.uid(), hotel_id))
  AND NOT has_role(auth.uid(),'viewer'::app_role)
  AND NOT has_role(auth.uid(),'ri'::app_role)
);

DROP POLICY IF EXISTS ar_ofdh_select_scoped ON public.ar_open_folio_date_history;
CREATE POLICY ar_ofdh_select_scoped ON public.ar_open_folio_date_history FOR SELECT TO authenticated
USING (
  (is_master(auth.uid()) OR has_role(auth.uid(),'controladoria'::app_role) OR has_role(auth.uid(),'patronos'::app_role)
   OR is_hotel_allowed(auth.uid(), hotel_id))
  AND NOT has_role(auth.uid(),'viewer'::app_role)
  AND NOT has_role(auth.uid(),'ri'::app_role)
);

DROP POLICY IF EXISTS ar_contracts_select_scoped ON public.ar_client_contracts;
CREATE POLICY ar_contracts_select_scoped ON public.ar_client_contracts FOR SELECT TO authenticated
USING (
  (is_master(auth.uid()) OR has_role(auth.uid(),'controladoria'::app_role) OR has_role(auth.uid(),'patronos'::app_role)
   OR is_hotel_allowed(auth.uid(), hotel_id))
  AND NOT has_role(auth.uid(),'viewer'::app_role)
  AND NOT has_role(auth.uid(),'ri'::app_role)
);

-- 2) Invoices storage: exclude viewer/ri
DROP POLICY IF EXISTS invoices_select_scoped ON storage.objects;
CREATE POLICY invoices_select_scoped ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'invoices'
  AND (is_ar_manager(auth.uid()) OR has_role(auth.uid(),'controladoria'::app_role)
       OR is_hotel_allowed(auth.uid(), split_part(name,'/',1)))
  AND NOT has_role(auth.uid(),'viewer'::app_role)
  AND NOT has_role(auth.uid(),'ri'::app_role)
);

-- 3) Profiles: restrict broad SELECT — only self + global/admin-ish roles can read all profiles.
DROP POLICY IF EXISTS profiles_select_any_role ON public.profiles;
CREATE POLICY profiles_select_any_role ON public.profiles FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR is_master(auth.uid())
  OR has_role(auth.uid(),'processos'::app_role)
  OR has_role(auth.uid(),'fernando'::app_role)
  OR has_role(auth.uid(),'controladoria'::app_role)
  OR has_role(auth.uid(),'patronos'::app_role)
  OR has_role(auth.uid(),'rh'::app_role)
  OR has_role(auth.uid(),'ri'::app_role)
);
