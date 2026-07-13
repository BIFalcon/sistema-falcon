
-- 1) Tighten has_global_data_access: remove 'rh' and 'operacoes'
CREATE OR REPLACE FUNCTION public.has_global_data_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_master(_user_id)
      OR public.has_role(_user_id, 'controladoria')
      OR public.has_role(_user_id, 'patronos')
      OR public.has_role(_user_id, 'ri')
      OR public.has_role(_user_id, 'viewer');
$$;

-- 2) get_latest_dre_lines: enforce hotel scope
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

  IF NOT (public.has_global_data_access(v_uid) OR public.is_hotel_allowed(v_uid, v_hotel_id)) THEN
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

-- 3) get_latest_dre_lines_by_closings: filter to closings user can access
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
    AND (public.has_global_data_access(v_uid) OR public.is_hotel_allowed(v_uid, c.hotel_id));

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

-- 4) get_year_latest_dre_lines: add auth + hotel scope
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
  IF NOT (public.has_global_data_access(v_uid) OR public.is_hotel_allowed(v_uid, _hotel_id)) THEN
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

-- 5) get_ap_category_monthly_series: add auth + hotel scope
CREATE OR REPLACE FUNCTION public.get_ap_category_monthly_series(_hotel_id text, _category_normalized text DEFAULT NULL::text)
RETURNS TABLE(hotel_id text, category_normalized text, ref_year integer, ref_month integer, total_amount numeric, entry_count integer)
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
  IF NOT (public.has_global_data_access(v_uid) OR public.is_hotel_allowed(v_uid, _hotel_id)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    e.hotel_id,
    e.category_normalized,
    EXTRACT(YEAR FROM e.due_date)::integer AS ref_year,
    EXTRACT(MONTH FROM e.due_date)::integer AS ref_month,
    SUM(e.amount) AS total_amount,
    COUNT(*)::integer AS entry_count
  FROM public.ap_entries e
  WHERE e.hotel_id = _hotel_id
    AND e.due_date IS NOT NULL
    AND e.archived_at IS NULL
    AND (_category_normalized IS NULL OR e.category_normalized = _category_normalized)
  GROUP BY e.hotel_id, e.category_normalized, ref_year, ref_month
  ORDER BY ref_year, ref_month;
END;
$$;

-- 6) Lock down execution
REVOKE ALL ON FUNCTION public.get_latest_dre_lines(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_latest_dre_lines_by_closings(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_year_latest_dre_lines(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_ap_category_monthly_series(text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_latest_dre_lines(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_latest_dre_lines_by_closings(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_year_latest_dre_lines(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ap_category_monthly_series(text, text) TO authenticated;
