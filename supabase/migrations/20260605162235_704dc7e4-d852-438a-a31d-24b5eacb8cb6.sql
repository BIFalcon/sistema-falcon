
DROP POLICY IF EXISTS dre_parsed_lines_select_scoped ON public.dre_parsed_lines;
CREATE POLICY dre_parsed_lines_select_scoped ON public.dre_parsed_lines
  FOR SELECT TO authenticated
  USING (
    (NOT has_role(auth.uid(), 'ri'::app_role))
    AND EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id = dre_parsed_lines.closing_id
        AND is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

DROP POLICY IF EXISTS dre_versions_select_scoped ON public.dre_versions;
CREATE POLICY dre_versions_select_scoped ON public.dre_versions
  FOR SELECT TO authenticated
  USING (
    (NOT has_role(auth.uid(), 'ri'::app_role))
    AND EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id = dre_versions.closing_id
        AND is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );
