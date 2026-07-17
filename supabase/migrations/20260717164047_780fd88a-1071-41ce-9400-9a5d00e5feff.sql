CREATE OR REPLACE FUNCTION public.can_read_dre_hotel(_user_id uuid, _hotel_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_global_data_access(_user_id)
      OR public.has_role(_user_id, 'fernando'::public.app_role)
      OR public.is_hotel_allowed(_user_id, _hotel_id);
$$;

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

  SELECT hotel_id INTO v_hotel_id FROM public.closings WHERE id = _closing_id;
  IF v_hotel_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.can_read_dre_hotel(v_uid, v_hotel_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH v AS (
    SELECT MAX(version_number) AS top FROM public.dre_parsed_lines WHERE closing_id = _closing_id
  )
  SELECT d.line_label, d.line_value, d.version_number,
         d.line_type, d.line_level, d.line_category, d.line_segment
  FROM public.dre_parsed_lines d, v
  WHERE d.closing_id = _closing_id AND d.version_number = v.top;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_latest_dre_lines_by_closings(_closing_ids uuid[])
RETURNS TABLE(closing_id uuid, line_label text, line_value numeric, version_number integer, line_type text, line_level integer, line_category text, line_segment text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT array_agg(c.id) INTO v_allowed
  FROM public.closings c
  WHERE c.id = ANY(_closing_ids)
    AND public.can_read_dre_hotel(v_uid, c.hotel_id);

  IF v_allowed IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT d.closing_id AS cid, MAX(d.version_number) AS v
    FROM public.dre_parsed_lines d
    WHERE d.closing_id = ANY(v_allowed)
    GROUP BY d.closing_id
  )
  SELECT d.closing_id, d.line_label, d.line_value,
         d.version_number, d.line_type, d.line_level,
         d.line_category, d.line_segment
  FROM public.dre_parsed_lines d
  JOIN latest l ON l.cid = d.closing_id AND l.v = d.version_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_year_latest_dre_lines(_hotel_id text, _year integer)
RETURNS TABLE(closing_id uuid, version_number integer, line_label text, line_value numeric, line_type text, line_level integer, line_category text, line_segment text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF NOT public.can_read_dre_hotel(v_uid, _hotel_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT v.closing_id, v.version_number
    FROM public.dre_versions v
    JOIN public.closings c ON c.id = v.closing_id
    WHERE c.hotel_id = _hotel_id AND c.year = _year
    ORDER BY v.created_at DESC
    LIMIT 1
  )
  SELECT d.closing_id, d.version_number, d.line_label, d.line_value,
         d.line_type, d.line_level, d.line_category, d.line_segment
  FROM public.dre_parsed_lines d
  JOIN latest l
    ON l.closing_id = d.closing_id
   AND l.version_number = d.version_number;
END;
$$;

REVOKE ALL ON FUNCTION public.can_read_dre_hotel(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_latest_dre_lines(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_latest_dre_lines_by_closings(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_year_latest_dre_lines(text, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_read_dre_hotel(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_latest_dre_lines(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_latest_dre_lines_by_closings(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_year_latest_dre_lines(text, integer) TO authenticated, service_role;