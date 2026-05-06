
CREATE OR REPLACE FUNCTION public.has_global_data_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_master(_user_id)
      OR public.has_role(_user_id, 'controladoria')
      OR public.has_role(_user_id, 'financeiro')
      OR public.has_role(_user_id, 'ri')
      OR public.has_role(_user_id, 'rh')
      OR public.has_role(_user_id, 'operacoes')
      OR public.has_role(_user_id, 'viewer');
$$;

CREATE POLICY closings_select_global
  ON public.closings FOR SELECT TO authenticated
  USING (public.has_global_data_access(auth.uid()));

CREATE POLICY dre_versions_select_global
  ON public.dre_versions FOR SELECT TO authenticated
  USING (public.has_global_data_access(auth.uid()));

CREATE POLICY dre_parsed_lines_select_global
  ON public.dre_parsed_lines FOR SELECT TO authenticated
  USING (public.has_global_data_access(auth.uid()));

CREATE POLICY status_log_select_global
  ON public.closing_status_log FOR SELECT TO authenticated
  USING (public.has_global_data_access(auth.uid()));
