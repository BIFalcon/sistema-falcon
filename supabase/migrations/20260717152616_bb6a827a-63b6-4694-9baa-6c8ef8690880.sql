DROP POLICY IF EXISTS ar_ofn_update_own_or_managers ON public.ar_open_folio_notes;
CREATE POLICY ar_ofn_update_own_or_managers ON public.ar_open_folio_notes
  FOR UPDATE TO authenticated
  USING (public.is_ar_manager(auth.uid()) OR author_id = auth.uid())
  WITH CHECK (
    (public.is_ar_manager(auth.uid()) OR author_id = auth.uid())
    AND author_id = auth.uid()
    AND public.is_hotel_allowed(auth.uid(), hotel_id)
  );

DROP POLICY IF EXISTS rh_calendar_posts_update ON public.rh_calendar_posts;
CREATE POLICY rh_calendar_posts_update ON public.rh_calendar_posts FOR UPDATE TO authenticated
USING (
  author_id = auth.uid()
  OR public.is_rh_manager(auth.uid())
  OR public.can_edit_marketing(auth.uid())
)
WITH CHECK (
  author_id = auth.uid()
  OR public.is_rh_manager(auth.uid())
  OR public.can_edit_marketing(auth.uid())
);