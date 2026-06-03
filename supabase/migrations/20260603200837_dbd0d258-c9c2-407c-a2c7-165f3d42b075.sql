
DROP POLICY IF EXISTS ap_entries_select_scoped ON public.ap_entries;
CREATE POLICY ap_entries_select_scoped ON public.ap_entries FOR SELECT TO authenticated
USING (
  is_hotel_allowed(auth.uid(), hotel_id)
  AND NOT has_role(auth.uid(),'ri'::app_role)
  AND NOT has_role(auth.uid(),'gg'::app_role)
  AND NOT has_role(auth.uid(),'viewer'::app_role)
);

DROP POLICY IF EXISTS ap_documents_select_scoped ON public.ap_documents;
CREATE POLICY ap_documents_select_scoped ON public.ap_documents FOR SELECT TO authenticated
USING (
  is_hotel_allowed(auth.uid(), hotel_id)
  AND NOT has_role(auth.uid(),'ri'::app_role)
  AND NOT has_role(auth.uid(),'gg'::app_role)
  AND NOT has_role(auth.uid(),'viewer'::app_role)
);

DROP POLICY IF EXISTS ap_uploads_select_scoped ON public.ap_uploads;
CREATE POLICY ap_uploads_select_scoped ON public.ap_uploads FOR SELECT TO authenticated
USING (
  is_hotel_allowed(auth.uid(), hotel_id)
  AND NOT has_role(auth.uid(),'ri'::app_role)
  AND NOT has_role(auth.uid(),'gg'::app_role)
  AND NOT has_role(auth.uid(),'viewer'::app_role)
);

DROP POLICY IF EXISTS ap_bank_balance_select_scoped ON public.ap_bank_balance;
CREATE POLICY ap_bank_balance_select_scoped ON public.ap_bank_balance FOR SELECT TO authenticated
USING (
  is_hotel_allowed(auth.uid(), hotel_id)
  AND NOT has_role(auth.uid(),'ri'::app_role)
  AND NOT has_role(auth.uid(),'gg'::app_role)
  AND NOT has_role(auth.uid(),'viewer'::app_role)
);

-- Tighten broad hotel SELECT: exclude marketing & comercial (they have no need for CNPJ / bank_accounts).
DROP POLICY IF EXISTS hotels_select_any_role ON public.hotels;
CREATE POLICY hotels_select_any_role ON public.hotels FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid())
  AND NOT has_role(auth.uid(),'viewer'::app_role)
  AND NOT has_role(auth.uid(),'ri'::app_role)
  AND NOT has_role(auth.uid(),'marketing'::app_role)
  AND NOT has_role(auth.uid(),'comercial'::app_role)
);
