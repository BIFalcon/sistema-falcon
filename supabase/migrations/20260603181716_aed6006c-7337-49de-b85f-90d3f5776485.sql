-- Restrict viewer and ri roles from reading operational Accounts Payable data.
-- is_hotel_allowed returns TRUE for viewer/ri unconditionally (designed for investor read access
-- on closings/DRE/letters). AP entries include supplier CNPJ, bank accounts and payment data
-- that viewer/ri should not see. Add an explicit exclusion to the AP SELECT policies.

DROP POLICY IF EXISTS ap_entries_select_scoped ON public.ap_entries;
CREATE POLICY ap_entries_select_scoped ON public.ap_entries
  FOR SELECT TO authenticated
  USING (
    is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT has_role(auth.uid(), 'viewer'::app_role)
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  );

DROP POLICY IF EXISTS ap_bank_balance_select_scoped ON public.ap_bank_balance;
CREATE POLICY ap_bank_balance_select_scoped ON public.ap_bank_balance
  FOR SELECT TO authenticated
  USING (
    is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT has_role(auth.uid(), 'viewer'::app_role)
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  );

DROP POLICY IF EXISTS ap_documents_select_scoped ON public.ap_documents;
CREATE POLICY ap_documents_select_scoped ON public.ap_documents
  FOR SELECT TO authenticated
  USING (
    is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT has_role(auth.uid(), 'viewer'::app_role)
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  );

DROP POLICY IF EXISTS ap_uploads_select_scoped ON public.ap_uploads;
CREATE POLICY ap_uploads_select_scoped ON public.ap_uploads
  FOR SELECT TO authenticated
  USING (
    is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT has_role(auth.uid(), 'viewer'::app_role)
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  );

-- ap_anticipation already restricts to master/financeiro via ALL policy, so no change needed.