CREATE OR REPLACE FUNCTION public.rh_departure_reason_category(_detail text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE
 WHEN value ~ '(rescisao|experiencia|contrato)' AND value ~ 'antecipad' THEN 'Rescisão de experiência antecipada'
 WHEN value ~ '(termino|fim|vencimento)' AND value ~ 'experiencia' THEN 'Término do contrato de experiência'
 WHEN value ~ 'acordo' AND value ~ '(partes|rescisao)' THEN 'Rescisão por acordo entre as partes'
 WHEN value ~ 'pedido' AND value ~ 'demissao' THEN 'Pedido de demissão sem justa causa'
 WHEN value ~ '(demitido|demissao|dispensa)' AND value ~ 'sem justa causa' THEN 'Demitido sem justa causa'
 ELSE 'Outros' END
 FROM (SELECT translate(lower(COALESCE(_detail,'')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') value) s;
$$;
REVOKE ALL ON FUNCTION public.rh_departure_reason_category(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rh_departure_reason_category(text) TO service_role;
CREATE OR REPLACE FUNCTION public.get_rh_departure_reasons(_hotel_id text,_month integer,_year integer,_period_months integer DEFAULT 1) RETURNS TABLE(reason text,total bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid:=auth.uid(); v_end integer:=_year*12+_month;
BEGIN
 IF v_uid IS NULL OR NOT (public.is_rh_manager(v_uid) OR public.has_role(v_uid,'fernando') OR public.has_role(v_uid,'viewer') OR public.has_role(v_uid,'gop') OR public.has_role(v_uid,'gg')) THEN RAISE EXCEPTION 'not authorized'; END IF;
 IF _hotel_id IS NOT NULL AND NOT public.can_view_rh_monthly_hotel(v_uid,_hotel_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
 IF _month IS NULL OR _month NOT BETWEEN 1 AND 12 OR _year IS NULL OR _year NOT BETWEEN 2000 AND 2100 OR _period_months IS NULL OR _period_months NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Período inválido'; END IF;
 RETURN QUERY SELECT public.rh_departure_reason_category(COALESCE(e.detail,e.termination_reason)),count(*)
 FROM public.rh_employees e
 WHERE public.can_view_rh_monthly_hotel(v_uid,e.hotel_id) AND (_hotel_id IS NULL OR e.hotel_id=_hotel_id)
 AND e.reference_year*12+e.reference_month BETWEEN v_end-_period_months+1 AND v_end
 AND CASE WHEN e.source_format='CONSOLIDADO' THEN lower(btrim(e.movement))='desligamento' ELSE e.termination_date IS NOT NULL END
 GROUP BY 1 ORDER BY 2 DESC,1;
END; $$;
REVOKE ALL ON FUNCTION public.get_rh_departure_reasons(text,integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_rh_departure_reasons(text,integer,integer,integer) TO authenticated,service_role;