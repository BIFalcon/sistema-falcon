-- Allow 'viewer' role to read financial (AP/AR) data in read-only mode.
-- Keeps 'ri' excluded (investor-only role) and preserves hotel scoping.

-- ap_bank_balance
DROP POLICY IF EXISTS ap_bank_balance_select_scoped ON public.ap_bank_balance;
CREATE POLICY ap_bank_balance_select_scoped ON public.ap_bank_balance
  FOR SELECT TO authenticated
  USING (
    is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT has_role(auth.uid(), 'ri'::app_role)
    AND NOT has_role(auth.uid(), 'gg'::app_role)
  );

-- ap_documents
DROP POLICY IF EXISTS ap_documents_select_scoped ON public.ap_documents;
CREATE POLICY ap_documents_select_scoped ON public.ap_documents
  FOR SELECT TO authenticated
  USING (
    is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT has_role(auth.uid(), 'ri'::app_role)
    AND NOT has_role(auth.uid(), 'gg'::app_role)
  );

-- ap_entries
DROP POLICY IF EXISTS ap_entries_select_scoped ON public.ap_entries;
CREATE POLICY ap_entries_select_scoped ON public.ap_entries
  FOR SELECT TO authenticated
  USING (
    is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT has_role(auth.uid(), 'ri'::app_role)
    AND NOT has_role(auth.uid(), 'gg'::app_role)
  );

-- ap_uploads
DROP POLICY IF EXISTS ap_uploads_select_scoped ON public.ap_uploads;
CREATE POLICY ap_uploads_select_scoped ON public.ap_uploads
  FOR SELECT TO authenticated
  USING (
    is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT has_role(auth.uid(), 'ri'::app_role)
    AND NOT has_role(auth.uid(), 'gg'::app_role)
  );

-- ar_client_contracts
DROP POLICY IF EXISTS ar_contracts_select_scoped ON public.ar_client_contracts;
CREATE POLICY ar_contracts_select_scoped ON public.ar_client_contracts
  FOR SELECT TO authenticated
  USING (
    (is_master(auth.uid())
     OR has_role(auth.uid(), 'controladoria'::app_role)
     OR has_role(auth.uid(), 'patronos'::app_role)
     OR is_hotel_allowed(auth.uid(), hotel_id))
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  );

-- ar_open_folio_date_history
DROP POLICY IF EXISTS ar_ofdh_select_scoped ON public.ar_open_folio_date_history;
CREATE POLICY ar_ofdh_select_scoped ON public.ar_open_folio_date_history
  FOR SELECT TO authenticated
  USING (
    (is_master(auth.uid())
     OR has_role(auth.uid(), 'controladoria'::app_role)
     OR has_role(auth.uid(), 'patronos'::app_role)
     OR is_hotel_allowed(auth.uid(), hotel_id))
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  );

-- ar_open_folio_entries
DROP POLICY IF EXISTS ar_of_select_scoped ON public.ar_open_folio_entries;
CREATE POLICY ar_of_select_scoped ON public.ar_open_folio_entries
  FOR SELECT TO authenticated
  USING (
    (is_master(auth.uid())
     OR has_role(auth.uid(), 'controladoria'::app_role)
     OR has_role(auth.uid(), 'patronos'::app_role)
     OR (hotel_id IS NOT NULL AND is_hotel_allowed(auth.uid(), hotel_id)))
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  );

-- ar_open_folio_notes
DROP POLICY IF EXISTS ar_ofn_select_scoped ON public.ar_open_folio_notes;
CREATE POLICY ar_ofn_select_scoped ON public.ar_open_folio_notes
  FOR SELECT TO authenticated
  USING (
    (is_master(auth.uid())
     OR has_role(auth.uid(), 'controladoria'::app_role)
     OR has_role(auth.uid(), 'patronos'::app_role)
     OR is_hotel_allowed(auth.uid(), hotel_id))
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  );

-- ar_to_invoice_entries
DROP POLICY IF EXISTS ar_ti_select_scoped ON public.ar_to_invoice_entries;
CREATE POLICY ar_ti_select_scoped ON public.ar_to_invoice_entries
  FOR SELECT TO authenticated
  USING (
    (is_master(auth.uid())
     OR has_role(auth.uid(), 'controladoria'::app_role)
     OR has_role(auth.uid(), 'patronos'::app_role)
     OR (hotel_id IS NOT NULL AND is_hotel_allowed(auth.uid(), hotel_id)))
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  );