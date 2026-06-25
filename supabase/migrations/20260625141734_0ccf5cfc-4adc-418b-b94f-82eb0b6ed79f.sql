
-- ============================================================
-- Fix #1: rh_employees direct PII exposure
-- ============================================================
-- Drop the broad SELECT policy so reads must go through the
-- get_rh_employees_for_user RPC (which masks CPF/salary/birth/termination).
DROP POLICY IF EXISTS rh_employees_select_managers ON public.rh_employees;
-- Intentionally no SELECT policy: all client reads must use the SECURITY
-- DEFINER RPC. Service role (edge functions) bypasses RLS.

-- ============================================================
-- Fix #2: is_hotel_allowed bypass via 'ri' / 'viewer' roles
-- ============================================================

-- New helper for SELECT policies that intentionally allow ri/viewer
-- global read access (closings module, AR/AP visibility, etc.).
CREATE OR REPLACE FUNCTION public.can_view_hotel_data(_user_id uuid, _hotel_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_master(_user_id)
    OR public.has_role(_user_id, 'controladoria')
    OR public.has_role(_user_id, 'patronos')
    OR public.has_role(_user_id, 'ri')
    OR public.has_role(_user_id, 'viewer')
    OR EXISTS (
      SELECT 1 FROM public.user_hotels
      WHERE user_id = _user_id AND hotel_id = _hotel_id
    );
$$;
REVOKE ALL ON FUNCTION public.can_view_hotel_data(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_hotel_data(uuid, text) TO authenticated, service_role;

-- Tighten is_hotel_allowed: remove blanket ri/viewer bypass so write
-- policies that rely on it cannot be circumvented by these read-only roles.
CREATE OR REPLACE FUNCTION public.is_hotel_allowed(_user_id uuid, _hotel_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_master(_user_id)
    OR public.has_role(_user_id, 'controladoria')
    OR public.has_role(_user_id, 'patronos')
    OR EXISTS (
      SELECT 1 FROM public.user_hotels
      WHERE user_id = _user_id AND hotel_id = _hotel_id
    );
$$;

-- Repoint SELECT policies that intentionally include ri/viewer to the
-- new helper. Write policies keep is_hotel_allowed (now stricter).

-- AP
DROP POLICY IF EXISTS ap_bank_balance_select_scoped ON public.ap_bank_balance;
CREATE POLICY ap_bank_balance_select_scoped ON public.ap_bank_balance
  FOR SELECT USING (
    public.can_view_hotel_data(auth.uid(), hotel_id)
    AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
    AND NOT public.has_role(auth.uid(), 'gg'::public.app_role)
  );

DROP POLICY IF EXISTS ap_documents_select_scoped ON public.ap_documents;
CREATE POLICY ap_documents_select_scoped ON public.ap_documents
  FOR SELECT USING (
    public.can_view_hotel_data(auth.uid(), hotel_id)
    AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
    AND NOT public.has_role(auth.uid(), 'gg'::public.app_role)
  );

DROP POLICY IF EXISTS ap_entries_select_scoped ON public.ap_entries;
CREATE POLICY ap_entries_select_scoped ON public.ap_entries
  FOR SELECT USING (
    public.can_view_hotel_data(auth.uid(), hotel_id)
    AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
    AND NOT public.has_role(auth.uid(), 'gg'::public.app_role)
  );

DROP POLICY IF EXISTS ap_uploads_select_scoped ON public.ap_uploads;
CREATE POLICY ap_uploads_select_scoped ON public.ap_uploads
  FOR SELECT USING (
    public.can_view_hotel_data(auth.uid(), hotel_id)
    AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
    AND NOT public.has_role(auth.uid(), 'gg'::public.app_role)
  );

-- AR
DROP POLICY IF EXISTS ar_contracts_select_scoped ON public.ar_client_contracts;
CREATE POLICY ar_contracts_select_scoped ON public.ar_client_contracts
  FOR SELECT USING (
    public.can_view_hotel_data(auth.uid(), hotel_id)
    AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
  );

DROP POLICY IF EXISTS ar_ofdh_select_scoped ON public.ar_open_folio_date_history;
CREATE POLICY ar_ofdh_select_scoped ON public.ar_open_folio_date_history
  FOR SELECT USING (
    public.can_view_hotel_data(auth.uid(), hotel_id)
    AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
  );

DROP POLICY IF EXISTS ar_of_select_scoped ON public.ar_open_folio_entries;
CREATE POLICY ar_of_select_scoped ON public.ar_open_folio_entries
  FOR SELECT USING (
    hotel_id IS NOT NULL
    AND public.can_view_hotel_data(auth.uid(), hotel_id)
    AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
  );

DROP POLICY IF EXISTS ar_ofn_select_scoped ON public.ar_open_folio_notes;
CREATE POLICY ar_ofn_select_scoped ON public.ar_open_folio_notes
  FOR SELECT USING (
    public.can_view_hotel_data(auth.uid(), hotel_id)
    AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
  );

DROP POLICY IF EXISTS ar_ti_select_scoped ON public.ar_to_invoice_entries;
CREATE POLICY ar_ti_select_scoped ON public.ar_to_invoice_entries
  FOR SELECT USING (
    hotel_id IS NOT NULL
    AND public.can_view_hotel_data(auth.uid(), hotel_id)
    AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
  );

-- Closings module
DROP POLICY IF EXISTS closings_select_scoped ON public.closings;
CREATE POLICY closings_select_scoped ON public.closings
  FOR SELECT USING (public.can_view_hotel_data(auth.uid(), hotel_id));

DROP POLICY IF EXISTS status_log_select_scoped ON public.closing_status_log;
CREATE POLICY status_log_select_scoped ON public.closing_status_log
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id = closing_status_log.closing_id
      AND public.can_view_hotel_data(auth.uid(), c.hotel_id)
  ));

DROP POLICY IF EXISTS comments_select_scoped ON public.comments;
CREATE POLICY comments_select_scoped ON public.comments
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id = comments.closing_id
      AND public.can_view_hotel_data(auth.uid(), c.hotel_id)
  ));

DROP POLICY IF EXISTS approvals_select_scoped ON public.approvals;
CREATE POLICY approvals_select_scoped ON public.approvals
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id = approvals.closing_id
      AND public.can_view_hotel_data(auth.uid(), c.hotel_id)
  ));

DROP POLICY IF EXISTS dre_parsed_lines_select_scoped ON public.dre_parsed_lines;
CREATE POLICY dre_parsed_lines_select_scoped ON public.dre_parsed_lines
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id = dre_parsed_lines.closing_id
      AND public.can_view_hotel_data(auth.uid(), c.hotel_id)
  ));

DROP POLICY IF EXISTS dre_versions_select_scoped ON public.dre_versions;
CREATE POLICY dre_versions_select_scoped ON public.dre_versions
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id = dre_versions.closing_id
      AND public.can_view_hotel_data(auth.uid(), c.hotel_id)
  ));

DROP POLICY IF EXISTS letters_select_scoped ON public.investor_letters;
CREATE POLICY letters_select_scoped ON public.investor_letters
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id = investor_letters.closing_id
      AND public.can_view_hotel_data(auth.uid(), c.hotel_id)
  ));

DROP POLICY IF EXISTS highlights_select_scoped ON public.letter_highlights;
CREATE POLICY highlights_select_scoped ON public.letter_highlights
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id = letter_highlights.closing_id
      AND public.can_view_hotel_data(auth.uid(), c.hotel_id)
  ));

DROP POLICY IF EXISTS letter_versions_select_scoped ON public.letter_versions;
CREATE POLICY letter_versions_select_scoped ON public.letter_versions
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id = letter_versions.closing_id
      AND public.can_view_hotel_data(auth.uid(), c.hotel_id)
  ));
