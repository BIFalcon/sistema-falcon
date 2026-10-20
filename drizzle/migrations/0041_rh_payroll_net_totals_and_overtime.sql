CREATE OR REPLACE FUNCTION public.get_rh_monthly_payroll_entries(_hotel_id text, _month integer, _year integer)
RETURNS TABLE(id uuid, employee_name text, "position" text, department text, bond text, admission_date date, termination_date date, base_salary numeric, fgts numeric, inss_patronal numeric, total_cost numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_rh_manager(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
 IF EXISTS(SELECT 1 FROM public.rh_uploads WHERE detected_format='CONSOLIDADO' AND reference_month=_month AND reference_year=_year) THEN
 RETURN QUERY SELECT e.id,e.name,e."position",e.department,NULL::text,e.admission_date,e.termination_date,e.salary,e.fgts,NULL::numeric,e.net_earnings FROM public.rh_employees e WHERE e.hotel_id=_hotel_id AND e.reference_month=_month AND e.reference_year=_year AND e.source_format='CONSOLIDADO' ORDER BY e.department,e.name;
 ELSE
 RETURN QUERY SELECT e.id,e.employee_name,e."position",e.department,e.bond,e.admission_date,e.termination_date,e.base_salary,e.fgts,e.inss_patronal,NULL::numeric FROM public.rh_payroll_entries e WHERE e.hotel_id=_hotel_id AND e.reference_month=_month AND e.reference_year=_year ORDER BY e.department,e.employee_name;
 END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_rh_payroll_history(_hotel_id text, _year integer)
RETURNS TABLE(reference_month integer, total_cost numeric, headcount bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_view_rh_monthly_hotel(auth.uid(),_hotel_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
 RETURN QUERY SELECT e.reference_month,sum(e.net_earnings),count(*) FROM public.rh_employees e WHERE e.hotel_id=_hotel_id AND e.reference_year=_year AND e.source_format='CONSOLIDADO' GROUP BY e.reference_month
 UNION ALL SELECT e.reference_month,NULL::numeric,count(*) FROM public.rh_payroll_entries e WHERE e.hotel_id=_hotel_id AND e.reference_year=_year AND NOT EXISTS(SELECT 1 FROM public.rh_uploads u WHERE u.detected_format='CONSOLIDADO' AND u.reference_year=_year AND u.reference_month=e.reference_month) GROUP BY e.reference_month ORDER BY 1;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_rh_payroll_summary(_hotel_id text, _month integer, _year integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_start date:=make_date(_year,_month,1); v_end date:=(v_start+interval '1 month - 1 day')::date; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_view_rh_monthly_hotel(auth.uid(),_hotel_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
 WITH source AS (
 SELECT e.department,e.net_earnings total_cost,e.salary,e.gross_earnings,e.overtime_earnings,e.admission_date,e.termination_date,e.movement,true consolidated FROM public.rh_employees e WHERE e.hotel_id=_hotel_id AND e.reference_month=_month AND e.reference_year=_year AND e.source_format='CONSOLIDADO'
 UNION ALL SELECT e.department,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric,e.admission_date,e.termination_date,NULL::text,false FROM public.rh_payroll_entries e WHERE e.hotel_id=_hotel_id AND e.reference_month=_month AND e.reference_year=_year AND NOT EXISTS(SELECT 1 FROM public.rh_uploads u WHERE u.detected_format='CONSOLIDADO' AND u.reference_month=_month AND u.reference_year=_year)
 ), deps AS (SELECT COALESCE(NULLIF(department,''),'Sem departamento') dep,sum(total_cost) tc,count(*) hc FROM source GROUP BY 1)
 SELECT jsonb_build_object('total_cost',sum(total_cost),'total_salary',sum(salary),'total_gross_earnings',sum(gross_earnings),'total_overtime_earnings',sum(overtime_earnings),'headcount',count(*),'admitted',count(*) FILTER(WHERE CASE WHEN consolidated THEN lower(btrim(movement)) IN ('admissão','admissao') ELSE admission_date BETWEEN v_start AND v_end END),'experience',count(*) FILTER(WHERE admission_date<=v_end AND v_end-admission_date<90),'terminated',count(*) FILTER(WHERE CASE WHEN consolidated THEN lower(btrim(movement))='desligamento' ELSE termination_date BETWEEN v_start AND v_end END),'has_termination_data',COALESCE(bool_or(consolidated),false) OR COALESCE((SELECT bool_or(u.has_termination_column) FROM public.rh_payroll_entries x JOIN public.rh_payroll_uploads u ON u.id=x.upload_id WHERE x.hotel_id=_hotel_id AND x.reference_month=_month AND x.reference_year=_year),false),'departments',COALESCE((SELECT jsonb_agg(jsonb_build_object('department',dep,'total_cost',tc,'headcount',hc) ORDER BY tc DESC NULLS LAST) FROM deps),'[]'::jsonb)) INTO v_result FROM source;
 RETURN v_result;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_rh_payroll_overtime_history(_hotel_id text, _year integer)
RETURNS TABLE(reference_month integer, total_overtime_earnings numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_view_rh_monthly_hotel(auth.uid(),_hotel_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
 RETURN QUERY SELECT e.reference_month,sum(e.overtime_earnings) FROM public.rh_employees e WHERE e.hotel_id=_hotel_id AND e.reference_year=_year AND e.source_format='CONSOLIDADO' GROUP BY e.reference_month
 UNION ALL SELECT e.reference_month,NULL::numeric FROM public.rh_payroll_entries e WHERE e.hotel_id=_hotel_id AND e.reference_year=_year AND NOT EXISTS(SELECT 1 FROM public.rh_uploads u WHERE u.detected_format='CONSOLIDADO' AND u.reference_year=_year AND u.reference_month=e.reference_month) GROUP BY e.reference_month ORDER BY 1;
END; $function$;
REVOKE ALL ON FUNCTION public.get_rh_payroll_overtime_history(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rh_payroll_overtime_history(text,integer) TO authenticated,service_role;
COMMENT ON FUNCTION public.get_rh_payroll_overtime_history(text,integer) IS 'Authorized monthly overtime/night/reflex earnings; NULL for legacy-only months. Existing history signature preserved for deployed clients.';
COMMENT ON FUNCTION public.get_rh_payroll_summary(text,integer,integer) IS 'Consolidated payroll totals: total_cost is net_earnings; salary, gross and overtime are separate. Legacy-only earnings totals are NULL.';