CREATE OR REPLACE FUNCTION public.get_year_latest_dre_lines_json(_hotel_id text, _year integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.can_read_dre_hotel(v_uid, _hotel_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  WITH latest AS (
    SELECT v.closing_id, v.version_number FROM public.dre_versions v
    JOIN public.closings c ON c.id = v.closing_id
    WHERE c.hotel_id = _hotel_id AND c.year = _year
    ORDER BY v.created_at DESC LIMIT 1)
  SELECT COALESCE(jsonb_agg(jsonb_build_array(d.closing_id, d.version_number, d.line_label, d.line_value, d.line_type, d.line_level, d.line_category, d.line_segment)), '[]'::jsonb)
  INTO v FROM public.dre_parsed_lines d JOIN latest l ON l.closing_id = d.closing_id AND l.version_number = d.version_number;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.get_year_latest_dre_lines_json(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_year_latest_dre_lines_json(text, integer) TO authenticated, service_role;