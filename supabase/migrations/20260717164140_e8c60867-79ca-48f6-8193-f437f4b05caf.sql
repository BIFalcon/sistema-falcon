CREATE OR REPLACE FUNCTION public.get_latest_dre_lines(_closing_id uuid)
RETURNS TABLE(line_label text, line_value numeric, version_number integer, line_type text, line_level integer, line_category text, line_segment text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hotel_id text;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT c.hotel_id INTO v_hotel_id FROM public.closings c WHERE c.id = _closing_id;
  IF v_hotel_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.can_read_dre_hotel(v_uid, v_hotel_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH v AS (
    SELECT MAX(dpl.version_number) AS top
    FROM public.dre_parsed_lines dpl
    WHERE dpl.closing_id = _closing_id
  )
  SELECT d.line_label, d.line_value, d.version_number,
         d.line_type, d.line_level, d.line_category, d.line_segment
  FROM public.dre_parsed_lines d, v
  WHERE d.closing_id = _closing_id AND d.version_number = v.top;
END;
$$;

REVOKE ALL ON FUNCTION public.get_latest_dre_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_latest_dre_lines(uuid) TO authenticated, service_role;