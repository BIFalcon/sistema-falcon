ALTER TABLE public.rh_employees ADD COLUMN IF NOT EXISTS overtime_hours_earnings numeric, ADD COLUMN IF NOT EXISTS night_earnings numeric, ADD COLUMN IF NOT EXISTS reflex_earnings numeric, ADD COLUMN IF NOT EXISTS holiday_earnings numeric;
CREATE OR REPLACE FUNCTION public.rh_department_for_position(_position text) RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $fn$
WITH normalized AS (SELECT lower(regexp_replace(translate(coalesce(_position,''),'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),'[^a-zA-Z0-9]+',' ','g')) AS p)
SELECT CASE
 WHEN p ~ '(pessoas? e cultura|recursos humanos|(^| )rh( |$))' THEN 'Recursos Humanos'
 WHEN p ~ '(cozinha|cozinheir|alimentos|bebidas|(^| )a (e )?b( |$)|maitre|garco[mn]|steward|restaurante|eventos)' THEN 'Alimentos & Bebidas'
 WHEN p ~ '(camareir|arrumad|governant|governanca|(^| )andar(es)?( |$)|limpeza|servicos? gerais|servicoes gerais)' THEN 'Governança'
 WHEN p ~ 'manutenc' THEN 'Manutenção'
 WHEN p ~ '(hospedag|recepc|noturno|guest experience|manobrista|reservas|comercial)' THEN 'Recepção & Atendimento'
 WHEN p ~ '(administrativ|(^| )adm( |$)|financeir|controladoria|almoxarife|escritorio|sistemas)' THEN 'Administrativo, Financeiro & Controladoria'
 WHEN p ~ '(gerente|operac|operacional|gestao estrategica|processos)' THEN 'Gestão & Operações'
 ELSE NULL END FROM normalized;
$fn$;
REVOKE ALL ON FUNCTION public.rh_department_for_position(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rh_department_for_position(text) TO service_role;
CREATE OR REPLACE FUNCTION public.import_rh_monthly(_file_name text,_month integer,_year integer,_rows jsonb,_unknown_hotels jsonb DEFAULT '[]'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid:=auth.uid(); v_upload uuid; v_count integer; v_hotels text[];
BEGIN
 IF v_uid IS NULL OR NOT public.is_rh_manager(v_uid) THEN RAISE EXCEPTION 'Somente RH e Master podem enviar a folha mensal.'; END IF;
 IF _month IS NULL OR _year IS NULL OR _month NOT BETWEEN 1 AND 12 OR _year NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'Competência inválida.'; END IF;
 IF jsonb_typeof(_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(_rows)=0 THEN RAISE EXCEPTION 'Nenhum colaborador reconhecido.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(_rows) r WHERE NULLIF(btrim(r->>'employee_key'),'') IS NULL OR NULLIF(btrim(r->>'name'),'') IS NULL OR r->>'status' IS NULL OR r->>'status' NOT IN ('ativo','inativo') OR NOT EXISTS(SELECT 1 FROM public.hotels h WHERE h.id=r->>'hotel_id')) THEN RAISE EXCEPTION 'Colaborador ou hotel inválido.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(_rows) r GROUP BY r->>'hotel_id',r->>'employee_key' HAVING count(*)>1) THEN RAISE EXCEPTION 'Código repetido dentro do mesmo hotel.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('rh-monthly'),_year*12+_month);
 SELECT count(*),array_agg(DISTINCT r->>'hotel_id') INTO v_count,v_hotels FROM jsonb_array_elements(_rows) r;
 INSERT INTO public.rh_uploads(hotel_id,file_name,file_path,uploaded_by,detected_format,parsed_count,reference_month,reference_year,metadata) VALUES(NULL,_file_name,'monthly/'||_year||'/'||_month||'/'||_file_name,v_uid,'CONSOLIDADO',v_count,_month,_year,jsonb_build_object('hotels',v_hotels,'unknown_hotels',_unknown_hotels)) RETURNING id INTO v_upload;
 DELETE FROM public.rh_employees WHERE reference_month=_month AND reference_year=_year;
 INSERT INTO public.rh_employees(hotel_id,upload_id,employee_key,name,"position",admission_date,termination_date,termination_reason,salary,status,source_format,reference_month,reference_year,movement,detail,gross_earnings,overtime_earnings,overtime_hours_earnings,night_earnings,reflex_earnings,holiday_earnings,deductions,net_earnings,inss_base,inss_deducted,fgts_base,fgts,cnpj,accounting,company)
 SELECT r.hotel_id,v_upload,r.employee_key,r.name,r."position",r.admission_date,CASE WHEN lower(btrim(r.movement))='desligamento' THEN r.termination_date ELSE NULL END,CASE WHEN lower(btrim(r.movement))='desligamento' THEN r.detail ELSE NULL END,r.salary,r.status,'CONSOLIDADO',_month,_year,r.movement,r.detail,r.gross_earnings,r.overtime_earnings,r.overtime_hours_earnings,r.night_earnings,r.reflex_earnings,r.holiday_earnings,r.deductions,r.net_earnings,r.inss_base,r.inss_deducted,r.fgts_base,r.fgts,r.cnpj,r.accounting,r.company
 FROM jsonb_to_recordset(_rows) AS r(hotel_id text,employee_key text,name text,"position" text,admission_date date,termination_date date,salary numeric,status text,movement text,detail text,gross_earnings numeric,overtime_earnings numeric,overtime_hours_earnings numeric,night_earnings numeric,reflex_earnings numeric,holiday_earnings numeric,deductions numeric,net_earnings numeric,inss_base numeric,inss_deducted numeric,fgts_base numeric,fgts numeric,cnpj text,accounting text,company text);
 RETURN jsonb_build_object('upload_id',v_upload,'rows_imported',v_count,'hotels_imported',v_hotels,'month',_month,'year',_year);
END; $$;
REVOKE ALL ON FUNCTION public.import_rh_monthly(text,integer,integer,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_rh_monthly(text,integer,integer,jsonb,jsonb) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_rh_payroll_summary(_hotel_id text,_month integer,_year integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_start date:=make_date(_year,_month,1); v_end date:=(v_start+interval '1 month - 1 day')::date; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_view_rh_monthly_hotel(auth.uid(),_hotel_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
 WITH source AS (
 SELECT e.department,e.net_earnings total_cost,e.salary,e.gross_earnings,e.overtime_earnings,e.overtime_hours_earnings,e.night_earnings,e.reflex_earnings,e.holiday_earnings,e.admission_date,e.termination_date,e.movement,true consolidated FROM public.rh_employees e WHERE e.hotel_id=_hotel_id AND e.reference_month=_month AND e.reference_year=_year AND e.source_format='CONSOLIDADO'
 UNION ALL SELECT e.department,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric,e.admission_date,e.termination_date,NULL::text,false FROM public.rh_payroll_entries e WHERE e.hotel_id=_hotel_id AND e.reference_month=_month AND e.reference_year=_year AND NOT EXISTS(SELECT 1 FROM public.rh_uploads u WHERE u.detected_format='CONSOLIDADO' AND u.reference_month=_month AND u.reference_year=_year)
 ), deps AS (SELECT COALESCE(NULLIF(department,''),'Sem departamento') dep,sum(total_cost) tc,count(*) hc,sum(overtime_earnings) ot,sum(overtime_hours_earnings) he,sum(night_earnings) nt,sum(reflex_earnings) rf,sum(holiday_earnings) hd FROM source GROUP BY 1)
 SELECT jsonb_build_object('total_cost',sum(total_cost),'total_salary',sum(salary),'total_gross_earnings',sum(gross_earnings),'total_overtime_earnings',sum(overtime_earnings),'headcount',count(*),'admitted',count(*) FILTER(WHERE CASE WHEN consolidated THEN lower(btrim(movement)) IN ('admissão','admissao') ELSE admission_date BETWEEN v_start AND v_end END),'experience',count(*) FILTER(WHERE admission_date<=v_end AND v_end-admission_date<90),'terminated',count(*) FILTER(WHERE CASE WHEN consolidated THEN lower(btrim(movement))='desligamento' ELSE termination_date BETWEEN v_start AND v_end END),'has_termination_data',COALESCE(bool_or(consolidated),false) OR COALESCE((SELECT bool_or(u.has_termination_column) FROM public.rh_payroll_entries x JOIN public.rh_payroll_uploads u ON u.id=x.upload_id WHERE x.hotel_id=_hotel_id AND x.reference_month=_month AND x.reference_year=_year),false),'departments',COALESCE((SELECT jsonb_agg(jsonb_build_object('department',dep,'total_cost',tc,'headcount',hc,'overtime_earnings',ot,'overtime_hours_earnings',he,'night_earnings',nt,'reflex_earnings',rf,'holiday_earnings',hd) ORDER BY tc DESC NULLS LAST) FROM deps),'[]'::jsonb)) INTO v_result FROM source;
 RETURN v_result;
END; $$;
CREATE OR REPLACE FUNCTION public.get_rh_monthly_payroll_entries_v2(_hotel_id text,_month integer,_year integer)
RETURNS TABLE(id uuid,employee_name text,"position" text,department text,bond text,admission_date date,termination_date date,base_salary numeric,fgts numeric,inss_patronal numeric,total_cost numeric,overtime_earnings numeric,overtime_hours_earnings numeric,night_earnings numeric,reflex_earnings numeric,holiday_earnings numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_rh_manager(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
 IF EXISTS(SELECT 1 FROM public.rh_uploads WHERE detected_format='CONSOLIDADO' AND reference_month=_month AND reference_year=_year) THEN
 RETURN QUERY SELECT e.id,e.name,e."position",e.department,NULL::text,e.admission_date,e.termination_date,e.salary,e.fgts,NULL::numeric,e.net_earnings,e.overtime_earnings,e.overtime_hours_earnings,e.night_earnings,e.reflex_earnings,e.holiday_earnings FROM public.rh_employees e WHERE e.hotel_id=_hotel_id AND e.reference_month=_month AND e.reference_year=_year AND e.source_format='CONSOLIDADO' ORDER BY e.department,e.name;
 ELSE
 RETURN QUERY SELECT e.id,e.employee_name,e."position",e.department,e.bond,e.admission_date,e.termination_date,e.base_salary,e.fgts,e.inss_patronal,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric FROM public.rh_payroll_entries e WHERE e.hotel_id=_hotel_id AND e.reference_month=_month AND e.reference_year=_year ORDER BY e.department,e.employee_name;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.get_rh_monthly_payroll_entries_v2(text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_rh_monthly_payroll_entries_v2(text,integer,integer) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_rh_payroll_roomnights(_hotel_id text,_month integer,_year integer) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_closing uuid; v_version integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_view_rh_monthly_hotel(auth.uid(),_hotel_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
 SELECT c.id,max(v.version_number) INTO v_closing,v_version FROM public.closings c JOIN public.dre_versions v ON v.closing_id=c.id WHERE c.hotel_id=_hotel_id AND c.month=_month AND c.year=_year GROUP BY c.id;
 IF v_closing IS NULL THEN RETURN NULL; END IF;
 RETURN public.consolidado_indicator(v_closing,v_version,'roomnights');
END; $$;
REVOKE ALL ON FUNCTION public.get_rh_payroll_roomnights(text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_rh_payroll_roomnights(text,integer,integer) TO authenticated,service_role;
COMMENT ON FUNCTION public.get_rh_monthly_payroll_entries(text,integer,integer) IS 'Compatibility signature; detailed extras available in get_rh_monthly_payroll_entries_v2.';