CREATE TABLE public.rh_payroll_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  reference_month int NOT NULL CHECK (reference_month BETWEEN 1 AND 12),
  reference_year int NOT NULL,
  hotels_imported text[] NOT NULL DEFAULT '{}',
  sheets_ignored text[] NOT NULL DEFAULT '{}',
  has_termination_column boolean NOT NULL DEFAULT false,
  rows_imported int NOT NULL DEFAULT 0,
  uploaded_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.rh_payroll_uploads TO authenticated;
GRANT ALL ON public.rh_payroll_uploads TO service_role;
ALTER TABLE public.rh_payroll_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh managers read payroll uploads" ON public.rh_payroll_uploads FOR SELECT TO authenticated USING (public.is_rh_manager(auth.uid()));
CREATE POLICY "rh managers insert payroll uploads" ON public.rh_payroll_uploads FOR INSERT TO authenticated WITH CHECK (public.is_rh_manager(auth.uid()));

-- Limitação conhecida: a planilha não traz CPF/matrícula; a correspondência
-- entre meses usa Funcionário + Departamento + Data de Admissão (match_key).
CREATE TABLE public.rh_payroll_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.rh_payroll_uploads(id) ON DELETE CASCADE,
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  reference_month int NOT NULL,
  reference_year int NOT NULL,
  match_key text NOT NULL,
  employee_name text NOT NULL,
  cnpj text, company text, bond text, position text, department text,
  admission_date date,
  termination_date date,
  base_salary numeric, salary_base numeric, fgts numeric, inss_patronal numeric,
  total_cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rh_payroll_entries_hotel_period_idx ON public.rh_payroll_entries (hotel_id, reference_year, reference_month);
CREATE INDEX rh_payroll_entries_upload_idx ON public.rh_payroll_entries (upload_id);
GRANT SELECT, INSERT, DELETE ON public.rh_payroll_entries TO authenticated;
GRANT ALL ON public.rh_payroll_entries TO service_role;
ALTER TABLE public.rh_payroll_entries ENABLE ROW LEVEL SECURITY;
-- Valores individuais: apenas RH e Master.
CREATE POLICY "rh managers read payroll entries" ON public.rh_payroll_entries FOR SELECT TO authenticated USING (public.is_rh_manager(auth.uid()));
CREATE POLICY "rh managers insert payroll entries" ON public.rh_payroll_entries FOR INSERT TO authenticated WITH CHECK (public.is_rh_manager(auth.uid()));
CREATE POLICY "rh managers delete payroll entries" ON public.rh_payroll_entries FOR DELETE TO authenticated USING (public.is_rh_manager(auth.uid()));

CREATE TABLE public.sensitive_export_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  module text NOT NULL,
  export_format text NOT NULL,
  hotel_id text,
  reference_month int,
  reference_year int,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sensitive_export_log_created_idx ON public.sensitive_export_log (created_at DESC);
GRANT SELECT, INSERT ON public.sensitive_export_log TO authenticated;
GRANT ALL ON public.sensitive_export_log TO service_role;
ALTER TABLE public.sensitive_export_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users log own exports" ON public.sensitive_export_log FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "master reads export log" ON public.sensitive_export_log FOR SELECT TO authenticated USING (public.is_master(auth.uid()));

-- Totais agregados para quem tem acesso ao hotel (nunca valores individuais).
CREATE OR REPLACE FUNCTION public.get_rh_payroll_summary(_hotel_id text, _month int, _year int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_start date := make_date(_year, _month, 1);
  v_end date := (make_date(_year, _month, 1) + interval '1 month - 1 day')::date;
  v_result jsonb;
  v_has_term boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.can_view_hotel_data(v_uid, _hotel_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT COALESCE(bool_or(u.has_termination_column), false) INTO v_has_term
  FROM public.rh_payroll_entries e JOIN public.rh_payroll_uploads u ON u.id = e.upload_id
  WHERE e.hotel_id = _hotel_id AND e.reference_month = _month AND e.reference_year = _year;

  SELECT jsonb_build_object(
    'total_cost', COALESCE(sum(total_cost), 0),
    'headcount', count(*),
    'admitted', count(*) FILTER (WHERE admission_date BETWEEN v_start AND v_end),
    'experience', count(*) FILTER (WHERE admission_date IS NOT NULL AND admission_date <= v_end AND (v_end - admission_date) < 90),
    'terminated', count(*) FILTER (WHERE termination_date BETWEEN v_start AND v_end),
    'has_termination_data', v_has_term,
    'departments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('department', d.dep, 'total_cost', d.tc, 'headcount', d.hc) ORDER BY d.tc DESC)
      FROM (SELECT COALESCE(NULLIF(department, ''), 'Sem departamento') dep, sum(total_cost) tc, count(*) hc
            FROM public.rh_payroll_entries
            WHERE hotel_id = _hotel_id AND reference_month = _month AND reference_year = _year
            GROUP BY 1) d), '[]'::jsonb)
  ) INTO v_result
  FROM public.rh_payroll_entries
  WHERE hotel_id = _hotel_id AND reference_month = _month AND reference_year = _year;

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_rh_payroll_summary(text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rh_payroll_summary(text, int, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_rh_payroll_history(_hotel_id text, _year int)
RETURNS TABLE(reference_month int, total_cost numeric, headcount bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_hotel_data(auth.uid(), _hotel_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY SELECT e.reference_month, sum(e.total_cost), count(*)
  FROM public.rh_payroll_entries e
  WHERE e.hotel_id = _hotel_id AND e.reference_year = _year
  GROUP BY e.reference_month ORDER BY 1;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_rh_payroll_history(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rh_payroll_history(text, int) TO authenticated, service_role;