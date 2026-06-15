
DROP POLICY IF EXISTS rh_calendar_posts_insert ON public.rh_calendar_posts;
CREATE POLICY rh_calendar_posts_insert ON public.rh_calendar_posts FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND (
    public.can_edit_rh_content(auth.uid())
    OR public.has_role(auth.uid(), 'gg'::app_role)
    OR public.has_role(auth.uid(), 'gop'::app_role)
  )
);

DROP POLICY IF EXISTS rh_calendar_posts_update ON public.rh_calendar_posts;
CREATE POLICY rh_calendar_posts_update ON public.rh_calendar_posts FOR UPDATE TO authenticated
USING (
  author_id = auth.uid()
  OR public.is_rh_manager(auth.uid())
  OR public.can_edit_marketing(auth.uid())
);
