-- Allow hotel adm role to justify open folios (insert notes) and reflect expected payment date on the entry.

DROP POLICY IF EXISTS ar_ofn_insert_scoped ON public.ar_open_folio_notes;
CREATE POLICY ar_ofn_insert_scoped ON public.ar_open_folio_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND (
      public.is_ar_manager(auth.uid())
      OR (
        (public.has_role(auth.uid(), 'gg'::app_role) OR public.has_role(auth.uid(), 'adm'::app_role))
        AND public.is_hotel_allowed(auth.uid(), hotel_id)
      )
    )
  );

DROP POLICY IF EXISTS ar_ofn_update_own_or_managers ON public.ar_open_folio_notes;
CREATE POLICY ar_ofn_update_own_or_managers ON public.ar_open_folio_notes
  FOR UPDATE TO authenticated
  USING (public.is_ar_manager(auth.uid()) OR author_id = auth.uid());

-- Allow gg/adm of the hotel to update the expected_payment_date mirror on the entry
DROP POLICY IF EXISTS ar_of_update_managers ON public.ar_open_folio_entries;
CREATE POLICY ar_of_update_managers ON public.ar_open_folio_entries
  FOR UPDATE TO authenticated
  USING (
    public.is_ar_manager(auth.uid())
    OR (
      (public.has_role(auth.uid(), 'gg'::app_role) OR public.has_role(auth.uid(), 'adm'::app_role))
      AND public.is_hotel_allowed(auth.uid(), hotel_id)
    )
  )
  WITH CHECK (
    public.is_ar_manager(auth.uid())
    OR (
      (public.has_role(auth.uid(), 'gg'::app_role) OR public.has_role(auth.uid(), 'adm'::app_role))
      AND public.is_hotel_allowed(auth.uid(), hotel_id)
    )
  );
