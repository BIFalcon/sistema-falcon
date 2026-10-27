CREATE OR REPLACE FUNCTION public.can_view_rh_consolidated(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _user_id IS NOT NULL AND (
    public.is_rh_manager(_user_id) OR public.has_role(_user_id,'fernando') OR public.has_role(_user_id,'viewer')
    OR (public.has_role(_user_id,'gop') AND (SELECT count(DISTINCT uh.hotel_id) FROM public.user_hotels uh WHERE uh.user_id=_user_id) > 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_rh_payroll_consolidated(_month integer, _year integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_out jsonb := '[]'::jsonb; h record; v_sum jsonb; v_rn numeric; v_closing uuid; v_version int;
BEGIN
  IF NOT public.can_view_rh_consolidated(v_uid) THEN RAISE EXCEPTION 'not authorized'; END IF;
  FOR h IN SELECT id, name, brand FROM public.hotels WHERE public.can_view_rh_monthly_hotel(v_uid, id) ORDER BY name LOOP
    v_sum := public.get_rh_payroll_summary(h.id, _month, _year);
    IF v_sum IS NULL OR COALESCE((v_sum->>'headcount')::int,0) = 0 THEN CONTINUE; END IF;
    v_closing := NULL; v_rn := NULL;
    SELECT c.id, max(v.version_number) INTO v_closing, v_version FROM public.closings c JOIN public.dre_versions v ON v.closing_id=c.id
      WHERE c.hotel_id=h.id AND c.month=_month AND c.year=_year GROUP BY c.id;
    IF v_closing IS NOT NULL THEN v_rn := public.consolidado_indicator(v_closing, v_version, 'roomnights'); END IF;
    v_out := v_out || jsonb_build_object(
      'hotel_id', h.id, 'hotel_name', h.name, 'brand', h.brand,
      'total_cost', v_sum->'total_cost', 'headcount', v_sum->'headcount',
      'overtime_earnings', v_sum->'total_overtime_earnings', 'roomnights', v_rn,
      'departments', COALESCE((SELECT jsonb_agg(jsonb_build_object('department', d->>'department', 'total_cost', d->'total_cost', 'headcount', d->'headcount'))
                               FROM jsonb_array_elements(v_sum->'departments') d), '[]'::jsonb));
  END LOOP;
  RETURN v_out;
END; $$;

REVOKE ALL ON FUNCTION public.get_rh_payroll_consolidated(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rh_payroll_consolidated(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_rh_consolidated(uuid) TO authenticated;