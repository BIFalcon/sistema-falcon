
-- 1. Allow fernando and dre roles to read DRE lines
CREATE OR REPLACE FUNCTION public.get_latest_dre_lines(_closing_id uuid)
 RETURNS TABLE(line_label text, line_value numeric, version_number integer, line_type text, line_level integer, line_category text, line_segment text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF NOT (
    public.has_global_data_access(v_uid)
    OR public.is_hotel_allowed(v_uid, v_hotel_id)
    OR public.has_role(v_uid, 'fernando')
    OR public.has_role(v_uid, 'dre')
  ) THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.get_year_latest_dre_lines(_hotel_id text, _year integer)
 RETURNS TABLE(closing_id uuid, version_number integer, line_label text, line_value numeric, line_type text, line_level integer, line_category text, line_segment text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF NOT (
    public.has_global_data_access(v_uid)
    OR public.is_hotel_allowed(v_uid, _hotel_id)
    OR public.has_role(v_uid, 'fernando')
    OR public.has_role(v_uid, 'dre')
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT c.id AS cid, MAX(d.version_number) AS v
    FROM public.closings c
    JOIN public.dre_parsed_lines d ON d.closing_id = c.id
    WHERE c.hotel_id = _hotel_id AND c.year = _year
    GROUP BY c.id
  ),
  best AS (
    SELECT cid, v
    FROM latest
    ORDER BY (SELECT MAX(created_at) FROM public.dre_parsed_lines d2 WHERE d2.closing_id = latest.cid AND d2.version_number = latest.v) DESC NULLS LAST
    LIMIT 1
  )
  SELECT b.cid, d.version_number, d.line_label, d.line_value,
         d.line_type, d.line_level, d.line_category, d.line_segment
  FROM best b
  JOIN public.dre_parsed_lines d ON d.closing_id = b.cid AND d.version_number = b.v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_latest_dre_lines_by_closings(_closing_ids uuid[])
 RETURNS TABLE(closing_id uuid, line_label text, line_value numeric, version_number integer, line_type text, line_level integer, line_category text, line_segment text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND (
      public.has_global_data_access(v_uid)
      OR public.is_hotel_allowed(v_uid, c.hotel_id)
      OR public.has_role(v_uid, 'fernando')
      OR public.has_role(v_uid, 'dre')
    );

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
$function$;

-- 2. Unarchive Ibis Styles Confins open folio entries that were archived by later uploads
UPDATE public.ar_open_folio_entries
SET archived_at = NULL
WHERE hotel_id = 'ibis-styles-confins'
  AND archived_at IS NOT NULL;
