-- 1) Revoke public/anon EXECUTE on internal SECURITY DEFINER helpers & trigger functions
REVOKE ALL ON FUNCTION public.consolidado_has_line(uuid, integer, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consolidado_indicator(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consolidado_indicator_by_pattern(uuid, integer, text[], integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consolidado_line_value(uuid, integer, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recalc_consolidado_cache(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_consolidado_from_closing() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_consolidado_from_dre_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_consolidado_from_hotel() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_consolidado_from_parsed_lines() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.consolidado_has_line(uuid, integer, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.consolidado_indicator(uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consolidado_indicator_by_pattern(uuid, integer, text[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consolidado_line_value(uuid, integer, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalc_consolidado_cache(uuid) TO service_role;

-- 2) ap_documents UPDATE: re-validate new row values
DROP POLICY IF EXISTS ap_documents_update_managers ON public.ap_documents;
CREATE POLICY ap_documents_update_managers
ON public.ap_documents
FOR UPDATE
TO authenticated
USING (public.is_hotel_allowed(auth.uid(), hotel_id) AND public.is_ap_manager(auth.uid()))
WITH CHECK (public.is_hotel_allowed(auth.uid(), hotel_id) AND public.is_ap_manager(auth.uid()));