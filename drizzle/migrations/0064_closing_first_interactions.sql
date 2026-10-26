CREATE OR REPLACE FUNCTION public.horas_uteis_24(a timestamptz, b timestamptz)
RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
SELECT CASE WHEN a IS NULL OR b IS NULL OR b < a THEN NULL ELSE (SELECT count(*)::int FROM generate_series(a, b - interval '1 millisecond', interval '1 hour') g WHERE extract(dow FROM g AT TIME ZONE 'America/Sao_Paulo') NOT IN (0,6)) END
$$;
REVOKE ALL ON FUNCTION public.horas_uteis_24(timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.horas_uteis_24(timestamptz,timestamptz) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.get_closing_interactions(p_month int, p_year int)
RETURNS TABLE (hotel_id text, hotel text, is_historical boolean, t_prev timestamptz, t_gg timestamptz, t_gop timestamptz, tipo_gop text, t_fer timestamptz, tipo_fer text, h_prev_gg int, h_gg_gop int, h_gop_fer int, h_total int, ultimo_marco text, h_desde_ultimo int, gg_antes_previa boolean, gg_depois_gop boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
 IF auth.uid() IS NULL OR NOT (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.role::text IN ('processos','fernando','viewer')) OR lower(coalesce(auth.jwt()->>'email',''))='fernando.fonseca@falconhoteis.com.br') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_month NOT BETWEEN 1 AND 12 OR p_year NOT BETWEEN 1900 AND 9999 THEN RAISE EXCEPTION 'invalid period'; END IF;
 RETURN QUERY
 WITH cl AS MATERIALIZED (SELECT c.id,c.hotel_id,h.name AS hotel,c.is_historical FROM public.closings c JOIN public.hotels h ON h.id=c.hotel_id WHERE c.month=p_month AND c.year=p_year),
 usr AS (SELECT r.user_id,array_agg(DISTINCT r.role::text) AS roles FROM public.user_roles r GROUP BY r.user_id),
 st AS (SELECT cl.id AS closing_id,cl.hotel_id,cl.hotel,cl.is_historical,min(l.created_at) FILTER(WHERE l.field='status_dre' AND l.new_value::text='aguardando_fernando') AS t_gop_aprov,min(l.created_at) FILTER(WHERE l.field='status_dre' AND l.new_value::text='aprovado') AS t_fer_aprov FROM cl LEFT JOIN public.closing_status_log l ON l.closing_id=cl.id GROUP BY cl.id,cl.hotel_id,cl.hotel,cl.is_historical),
 prev AS (SELECT v.closing_id,min(v.created_at) AS t FROM public.dre_versions v JOIN cl ON cl.id=v.closing_id JOIN usr u ON u.user_id=v.author_id WHERE u.roles && array['controladoria','patronos'] GROUP BY v.closing_id),
 cm AS (SELECT m.closing_id,min(m.created_at) FILTER(WHERE 'gg'=ANY(u.roles)) AS t_gg,min(m.created_at) FILTER(WHERE 'gop'=ANY(u.roles)) AS t_gop_c,min(m.created_at) FILTER(WHERE 'fernando'=ANY(u.roles)) AS t_fer_c FROM public.comments m JOIN cl ON cl.id=m.closing_id JOIN usr u ON u.user_id=m.author_id WHERE m.stage::text='dre' GROUP BY m.closing_id),
 mk AS (SELECT st.hotel_id,st.hotel,st.is_historical,prev.t AS t_prev,cm.t_gg,least(cm.t_gop_c,st.t_gop_aprov) AS t_gop,CASE WHEN cm.t_gop_c IS NOT NULL AND (st.t_gop_aprov IS NULL OR cm.t_gop_c<=st.t_gop_aprov) THEN 'Comentário' WHEN st.t_gop_aprov IS NOT NULL THEN 'Aprovação' END AS tipo_gop,least(cm.t_fer_c,st.t_fer_aprov) AS t_fer,CASE WHEN cm.t_fer_c IS NOT NULL AND (st.t_fer_aprov IS NULL OR cm.t_fer_c<=st.t_fer_aprov) THEN 'Comentário' WHEN st.t_fer_aprov IS NOT NULL THEN 'Aprovação' END AS tipo_fer FROM st LEFT JOIN prev ON prev.closing_id=st.closing_id LEFT JOIN cm ON cm.closing_id=st.closing_id)
 SELECT mk.hotel_id,mk.hotel,mk.is_historical,mk.t_prev,mk.t_gg,mk.t_gop,mk.tipo_gop,mk.t_fer,mk.tipo_fer,
 CASE WHEN mk.t_gg>mk.t_prev THEN public.horas_uteis_24(mk.t_prev,mk.t_gg) END,CASE WHEN mk.t_gop>mk.t_gg THEN public.horas_uteis_24(mk.t_gg,mk.t_gop) END,CASE WHEN mk.t_fer>mk.t_gop THEN public.horas_uteis_24(mk.t_gop,mk.t_fer) END,CASE WHEN mk.t_fer>mk.t_prev THEN public.horas_uteis_24(mk.t_prev,mk.t_fer) END,
 CASE WHEN mk.t_prev IS NULL OR mk.t_fer IS NOT NULL THEN NULL WHEN greatest(mk.t_prev,mk.t_gg,mk.t_gop)=mk.t_gop THEN 'GOP' WHEN greatest(mk.t_prev,mk.t_gg,mk.t_gop)=mk.t_gg THEN 'GG' ELSE 'Prévia' END,
 CASE WHEN mk.t_prev IS NULL OR mk.t_fer IS NOT NULL THEN NULL ELSE public.horas_uteis_24(greatest(mk.t_prev,mk.t_gg,mk.t_gop),now()) END,
 coalesce(mk.t_gg<mk.t_prev,false),coalesce(mk.t_gg>mk.t_gop,false) FROM mk ORDER BY mk.hotel;
END $$;
REVOKE ALL ON FUNCTION public.get_closing_interactions(int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_closing_interactions(int,int) TO authenticated,service_role;