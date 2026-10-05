CREATE OR REPLACE FUNCTION public.get_dre_history(_hotel_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_lines jsonb; v_ent jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.can_read_dre_hotel(v_uid, _hotel_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  WITH latest_year AS (
    SELECT DISTINCT ON (c.year) c.year, v.closing_id, v.version_number
    FROM public.dre_versions v JOIN public.closings c ON c.id = v.closing_id
    WHERE c.hotel_id = _hotel_id
      AND EXISTS (SELECT 1 FROM public.dre_parsed_lines d WHERE d.closing_id = v.closing_id AND d.version_number = v.version_number AND left(d.line_label, 7) = '[cline_')
    ORDER BY c.year, v.created_at DESC
  ), cl AS (
    SELECT la.year, (m[1])::int AS month, m[2] AS label, d.line_value AS value
    FROM latest_year la
    JOIN public.dre_parsed_lines d ON d.closing_id = la.closing_id AND d.version_number = la.version_number
    CROSS JOIN LATERAL regexp_match(d.line_label, '^\[cline_(\d+)\]\s(.+)$') m
    WHERE left(d.line_label, 7) = '[cline_' AND d.line_value IS NOT NULL
  ), latest_month AS (
    SELECT DISTINCT ON (c.year, c.month) c.year, c.month, v.closing_id, v.version_number
    FROM public.dre_versions v JOIN public.closings c ON c.id = v.closing_id
    WHERE c.hotel_id = _hotel_id
    ORDER BY c.year, c.month, v.created_at DESC
  ), pl AS (
    SELECT lm.year, lm.month, d.line_label AS label, d.line_value AS value
    FROM latest_month lm
    JOIN public.dre_parsed_lines d ON d.closing_id = lm.closing_id AND d.version_number = lm.version_number
    WHERE left(d.line_label, 1) <> '[' AND d.line_value IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM cl WHERE cl.year = lm.year AND cl.month = lm.month)
  ), l AS (SELECT * FROM cl UNION ALL SELECT * FROM pl)
  SELECT COALESCE(jsonb_agg(jsonb_build_array(year, month, label, value)), '[]'::jsonb) INTO v_lines FROM l;
  SELECT COALESCE(jsonb_agg(jsonb_build_array(entity, year, month, line_label, panel_group, line_value)), '[]'::jsonb)
    INTO v_ent FROM public.dre_entity_history WHERE hotel_id = _hotel_id;
  RETURN jsonb_build_object('lines', v_lines, 'entities', v_ent);
END $function$;