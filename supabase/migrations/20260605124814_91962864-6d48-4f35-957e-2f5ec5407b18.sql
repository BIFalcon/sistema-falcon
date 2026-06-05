
-- 1) Block RI role from reading DRE data via the global-access policies
DROP POLICY IF EXISTS dre_parsed_lines_select_global ON public.dre_parsed_lines;
CREATE POLICY dre_parsed_lines_select_global ON public.dre_parsed_lines
  FOR SELECT TO authenticated
  USING (
    has_global_data_access(auth.uid())
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  );

DROP POLICY IF EXISTS dre_versions_select_global ON public.dre_versions;
CREATE POLICY dre_versions_select_global ON public.dre_versions
  FOR SELECT TO authenticated
  USING (
    has_global_data_access(auth.uid())
    AND NOT has_role(auth.uid(), 'ri'::app_role)
  );

-- 2) Exclude viewer from base hotels SELECT (they leak bank_accounts/cnpj otherwise)
DROP POLICY IF EXISTS hotels_select_any_role ON public.hotels;
CREATE POLICY hotels_select_any_role ON public.hotels
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid())
    AND NOT has_role(auth.uid(), 'ri'::app_role)
    AND NOT has_role(auth.uid(), 'marketing'::app_role)
    AND NOT has_role(auth.uid(), 'comercial'::app_role)
    AND NOT has_role(auth.uid(), 'viewer'::app_role)
  );

-- Safe public view exposes hotel metadata without bank_accounts / cnpj.
-- Uses default security_definer so viewers (excluded from base RLS) can still list hotels.
DROP VIEW IF EXISTS public.hotels_safe;
CREATE VIEW public.hotels_safe AS
SELECT id, name, brand, active, is_active, cover_url, brand_logo_url,
       opera_property_name, num_apartments, financial_system,
       show_in_closing, created_at
FROM public.hotels
WHERE is_active = true OR is_active IS NULL;

GRANT SELECT ON public.hotels_safe TO authenticated;
