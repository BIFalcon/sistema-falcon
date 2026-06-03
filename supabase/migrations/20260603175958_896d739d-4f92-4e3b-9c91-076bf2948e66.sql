
-- Tighten write policies to exclude read-only roles (viewer, ri)

DROP POLICY IF EXISTS closings_insert_scoped ON public.closings;
CREATE POLICY closings_insert_scoped ON public.closings
  FOR INSERT TO authenticated
  WITH CHECK (
    is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT has_role(auth.uid(), 'viewer'::app_role)
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  );

DROP POLICY IF EXISTS closings_update_scoped ON public.closings;
CREATE POLICY closings_update_scoped ON public.closings
  FOR UPDATE TO authenticated
  USING (
    is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT has_role(auth.uid(), 'viewer'::app_role)
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  )
  WITH CHECK (
    is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT has_role(auth.uid(), 'viewer'::app_role)
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  );

DROP POLICY IF EXISTS comments_insert_any_role ON public.comments;
CREATE POLICY comments_insert_any_role ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (
    has_any_role(auth.uid())
    AND author_id = auth.uid()
    AND NOT has_role(auth.uid(), 'viewer'::app_role)
    AND NOT has_role(auth.uid(), 'ri'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id = comments.closing_id
        AND is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

DROP POLICY IF EXISTS approvals_insert_any_role ON public.approvals;
CREATE POLICY approvals_insert_any_role ON public.approvals
  FOR INSERT TO authenticated
  WITH CHECK (
    has_any_role(auth.uid())
    AND approved_by = auth.uid()
    AND NOT has_role(auth.uid(), 'viewer'::app_role)
    AND NOT has_role(auth.uid(), 'ri'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id = approvals.closing_id
        AND is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );
