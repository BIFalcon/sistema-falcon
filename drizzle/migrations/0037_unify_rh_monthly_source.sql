ALTER TABLE public.rh_employees ADD COLUMN IF NOT EXISTS movement text, ADD COLUMN IF NOT EXISTS detail text, ADD COLUMN IF NOT EXISTS gross_earnings numeric, ADD COLUMN IF NOT EXISTS overtime_earnings numeric, ADD COLUMN IF NOT EXISTS deductions numeric, ADD COLUMN IF NOT EXISTS net_earnings numeric, ADD COLUMN IF NOT EXISTS inss_base numeric, ADD COLUMN IF NOT EXISTS inss_deducted numeric, ADD COLUMN IF NOT EXISTS fgts_base numeric, ADD COLUMN IF NOT EXISTS fgts numeric, ADD COLUMN IF NOT EXISTS cnpj text, ADD COLUMN IF NOT EXISTS accounting text, ADD COLUMN IF NOT EXISTS company text;
COMMENT ON TABLE public.rh_payroll_entries IS 'DEPRECATED for new imports: public.rh_employees is the consolidated monthly RH source; retained for historical payroll.';
CREATE OR REPLACE FUNCTION public.can_view_rh_monthly_hotel(_user_id uuid,_hotel_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT public.is_rh_manager(_user_id) OR public.has_role(_user_id,'fernando') OR public.has_role(_user_id,'viewer') OR ((public.has_role(_user_id,'gop') OR public.has_role(_user_id,'gg')) AND EXISTS(SELECT 1 FROM public.user_hotels WHERE user_id=_user_id AND hotel_id=_hotel_id)); $$;
REVOKE ALL ON FUNCTION public.can_view_rh_monthly_hotel(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_rh_monthly_hotel(uuid,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.can_view_payroll_hotel(_user_id uuid,_hotel_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT public.can_view_rh_monthly_hotel(_user_id,_hotel_id); $$;
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
 INSERT INTO public.rh_employees(hotel_id,upload_id,employee_key,name,"position",admission_date,termination_date,termination_reason,salary,status,source_format,reference_month,reference_year,movement,detail,gross_earnings,overtime_earnings,deductions,net_earnings,inss_base,inss_deducted,fgts_base,fgts,cnpj,accounting,company)
 SELECT r.hotel_id,v_upload,r.employee_key,r.name,r."position",r.admission_date,CASE WHEN lower(btrim(r.movement))='desligamento' THEN r.termination_date ELSE NULL END,CASE WHEN lower(btrim(r.movement))='desligamento' THEN r.detail ELSE NULL END,r.salary,r.status,'CONSOLIDADO',_month,_year,r.movement,r.detail,r.gross_earnings,r.overtime_earnings,r.deductions,r.net_earnings,r.inss_base,r.inss_deducted,r.fgts_base,r.fgts,r.cnpj,r.accounting,r.company
 FROM jsonb_to_recordset(_rows) AS r(hotel_id text,employee_key text,name text,"position" text,admission_date date,termination_date date,salary numeric,status text,movement text,detail text,gross_earnings numeric,overtime_earnings numeric,deductions numeric,net_earnings numeric,inss_base numeric,inss_deducted numeric,fgts_base numeric,fgts numeric,cnpj text,accounting text,company text);
 RETURN jsonb_build_object('upload_id',v_upload,'rows_imported',v_count,'hotels_imported',v_hotels,'month',_month,'year',_year);
END; $$;
REVOKE ALL ON FUNCTION public.import_rh_monthly(text,integer,integer,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_rh_monthly(text,integer,integer,jsonb,jsonb) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_rh_employees_for_user(_hotel_id text DEFAULT NULL,_reference_month integer DEFAULT NULL,_reference_year integer DEFAULT NULL)
RETURNS TABLE(id uuid,hotel_id text,upload_id uuid,employee_key text,name text,cpf text,"position" text,department text,gender text,birth_date date,admission_date date,termination_date date,termination_reason text,salary numeric,status text,source_format text,raw jsonb,reference_month integer,reference_year integer,created_at timestamptz,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid:=auth.uid(); v_manager boolean;
BEGIN
 IF v_uid IS NULL OR NOT (public.is_rh_manager(v_uid) OR public.has_role(v_uid,'fernando') OR public.has_role(v_uid,'viewer') OR public.has_role(v_uid,'gop') OR public.has_role(v_uid,'gg')) THEN RAISE EXCEPTION 'not authorized'; END IF;
 IF _hotel_id IS NOT NULL AND NOT public.can_view_rh_monthly_hotel(v_uid,_hotel_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
 v_manager:=public.is_rh_manager(v_uid);
 RETURN QUERY SELECT e.id,e.hotel_id,e.upload_id,e.employee_key,e.name,CASE WHEN v_manager THEN e.cpf ELSE NULL END,e."position",e.department,e.gender,CASE WHEN v_manager THEN e.birth_date ELSE NULL END,e.admission_date,e.termination_date,CASE WHEN v_manager THEN e.termination_reason ELSE NULL END,CASE WHEN v_manager THEN e.salary ELSE NULL END,e.status,e.source_format,CASE WHEN e.source_format='CONSOLIDADO' THEN jsonb_build_object('movement',e.movement) ELSE '{}'::jsonb END,e.reference_month,e.reference_year,e.created_at,e.updated_at FROM public.rh_employees e WHERE public.can_view_rh_monthly_hotel(v_uid,e.hotel_id) AND (_hotel_id IS NULL OR e.hotel_id=_hotel_id) AND (_reference_month IS NULL OR e.reference_month=_reference_month) AND (_reference_year IS NULL OR e.reference_year=_reference_year) ORDER BY e.name;
END; $$;
REVOKE ALL ON FUNCTION public.get_rh_employees_for_user(text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_rh_employees_for_user(text,integer,integer) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_rh_payroll_summary(_hotel_id text,_month integer,_year integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_start date:=make_date(_year,_month,1); v_end date:=(v_start+interval '1 month - 1 day')::date; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_view_rh_monthly_hotel(auth.uid(),_hotel_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
 WITH source AS (
 SELECT e.department,e.gross_earnings total_cost,e.admission_date,e.termination_date,e.movement,true consolidated FROM public.rh_employees e WHERE e.hotel_id=_hotel_id AND e.reference_month=_month AND e.reference_year=_year AND e.source_format='CONSOLIDADO'
 UNION ALL SELECT e.department,e.total_cost,e.admission_date,e.termination_date,NULL::text,false FROM public.rh_payroll_entries e WHERE e.hotel_id=_hotel_id AND e.reference_month=_month AND e.reference_year=_year AND NOT EXISTS(SELECT 1 FROM public.rh_uploads u WHERE u.detected_format='CONSOLIDADO' AND u.reference_month=_month AND u.reference_year=_year)
 ), deps AS (SELECT COALESCE(NULLIF(department,''),'Sem departamento') dep,COALESCE(sum(total_cost),0) tc,count(*) hc FROM source GROUP BY 1)
 SELECT jsonb_build_object('total_cost',COALESCE(sum(total_cost),0),'headcount',count(*),'admitted',count(*) FILTER(WHERE CASE WHEN consolidated THEN lower(btrim(movement)) IN ('admissão','admissao') ELSE admission_date BETWEEN v_start AND v_end END),'experience',count(*) FILTER(WHERE admission_date<=v_end AND v_end-admission_date<90),'terminated',count(*) FILTER(WHERE CASE WHEN consolidated THEN lower(btrim(movement))='desligamento' ELSE termination_date BETWEEN v_start AND v_end END),'has_termination_data',COALESCE(bool_or(consolidated),false) OR COALESCE((SELECT bool_or(u.has_termination_column) FROM public.rh_payroll_entries x JOIN public.rh_payroll_uploads u ON u.id=x.upload_id WHERE x.hotel_id=_hotel_id AND x.reference_month=_month AND x.reference_year=_year),false),'departments',COALESCE((SELECT jsonb_agg(jsonb_build_object('department',dep,'total_cost',tc,'headcount',hc) ORDER BY tc DESC) FROM deps),'[]'::jsonb)) INTO v_result FROM source;
 RETURN v_result;
END; $$;
CREATE OR REPLACE FUNCTION public.get_rh_payroll_history(_hotel_id text,_year integer) RETURNS TABLE(reference_month integer,total_cost numeric,headcount bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_view_rh_monthly_hotel(auth.uid(),_hotel_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
 RETURN QUERY SELECT e.reference_month,COALESCE(sum(e.gross_earnings),0),count(*) FROM public.rh_employees e WHERE e.hotel_id=_hotel_id AND e.reference_year=_year AND e.source_format='CONSOLIDADO' GROUP BY e.reference_month
 UNION ALL SELECT e.reference_month,sum(e.total_cost),count(*) FROM public.rh_payroll_entries e WHERE e.hotel_id=_hotel_id AND e.reference_year=_year AND NOT EXISTS(SELECT 1 FROM public.rh_uploads u WHERE u.detected_format='CONSOLIDADO' AND u.reference_year=_year AND u.reference_month=e.reference_month) GROUP BY e.reference_month ORDER BY 1;
END; $$;
CREATE OR REPLACE FUNCTION public.get_rh_monthly_payroll_entries(_hotel_id text,_month integer,_year integer)
RETURNS TABLE(id uuid,employee_name text,"position" text,department text,bond text,admission_date date,termination_date date,base_salary numeric,fgts numeric,inss_patronal numeric,total_cost numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_rh_manager(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
 IF EXISTS(SELECT 1 FROM public.rh_uploads WHERE detected_format='CONSOLIDADO' AND reference_month=_month AND reference_year=_year) THEN
 RETURN QUERY SELECT e.id,e.name,e."position",e.department,NULL::text,e.admission_date,e.termination_date,e.salary,e.fgts,NULL::numeric,e.gross_earnings FROM public.rh_employees e WHERE e.hotel_id=_hotel_id AND e.reference_month=_month AND e.reference_year=_year ORDER BY e.department,e.name;
 ELSE
 RETURN QUERY SELECT e.id,e.employee_name,e."position",e.department,e.bond,e.admission_date,e.termination_date,e.base_salary,e.fgts,e.inss_patronal,e.total_cost FROM public.rh_payroll_entries e WHERE e.hotel_id=_hotel_id AND e.reference_month=_month AND e.reference_year=_year ORDER BY e.department,e.employee_name;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.get_rh_monthly_payroll_entries(text,integer,integer),public.get_rh_payroll_summary(text,integer,integer),public.get_rh_payroll_history(text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_rh_monthly_payroll_entries(text,integer,integer),public.get_rh_payroll_summary(text,integer,integer),public.get_rh_payroll_history(text,integer) TO authenticated,service_role;