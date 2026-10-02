CREATE OR REPLACE FUNCTION public.can_view_payroll_hotel(_user_id uuid, _hotel_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    public.has_role(_user_id, 'processos')
    OR public.has_role(_user_id, 'fernando')
    OR public.has_role(_user_id, 'rh')
    OR public.has_role(_user_id, 'viewer')
    OR ((public.has_role(_user_id, 'gg') OR public.has_role(_user_id, 'gop'))
        AND EXISTS (SELECT 1 FROM public.user_hotels WHERE user_id = _user_id AND hotel_id = _hotel_id));
$$;
REVOKE EXECUTE ON FUNCTION public.can_view_payroll_hotel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_payroll_hotel(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_rh_payroll_summary(_hotel_id text, _month integer, _year integer)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_start date := make_date(_year, _month, 1);
  v_end date := (make_date(_year, _month, 1) + interval '1 month - 1 day')::date;
  v_result jsonb;
  v_has_term boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.can_view_payroll_hotel(v_uid, _hotel_id) THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.get_rh_payroll_history(_hotel_id text, _year integer)
 RETURNS TABLE(reference_month integer, total_cost numeric, headcount bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_payroll_hotel(auth.uid(), _hotel_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY SELECT e.reference_month, sum(e.total_cost), count(*)
  FROM public.rh_payroll_entries e
  WHERE e.hotel_id = _hotel_id AND e.reference_year = _year
  GROUP BY e.reference_month ORDER BY 1;
END;
$function$;