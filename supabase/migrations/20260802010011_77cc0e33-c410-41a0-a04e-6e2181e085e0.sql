CREATE OR REPLACE FUNCTION public.be_eight_dre_latest_lines(
  _hotel_id text DEFAULT NULL,
  _closing_id uuid DEFAULT NULL,
  _only_indicators boolean DEFAULT false,
  _after_closing_id uuid DEFAULT NULL,
  _after_line_id uuid DEFAULT NULL,
  _limit integer DEFAULT 1000
)
RETURNS TABLE(
  id uuid,
  closing_id uuid,
  line_label text,
  line_value numeric,
  version_number integer,
  line_type text,
  line_level integer,
  line_category text,
  line_segment text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT c.id
    FROM public.closings c
    WHERE (_hotel_id IS NULL OR c.hotel_id = _hotel_id)
      AND (_closing_id IS NULL OR c.id = _closing_id)
  ),
  latest AS (
    SELECT l.closing_id, MAX(l.version_number) AS v
    FROM public.dre_parsed_lines l
    JOIN scoped s ON s.id = l.closing_id
    GROUP BY l.closing_id
  )
  SELECT l.id, l.closing_id, l.line_label, l.line_value, l.version_number,
         l.line_type, l.line_level, l.line_category, l.line_segment
  FROM public.dre_parsed_lines l
  JOIN latest x ON x.closing_id = l.closing_id AND x.v = l.version_number
  WHERE (NOT _only_indicators OR l.line_type = 'indicator')
    AND (
      _after_closing_id IS NULL
      OR l.closing_id > _after_closing_id
      OR (l.closing_id = _after_closing_id AND (_after_line_id IS NULL OR l.id > _after_line_id))
    )
  ORDER BY l.closing_id, l.id
  LIMIT GREATEST(COALESCE(_limit, 1000), 1);
$$;

REVOKE ALL ON FUNCTION public.be_eight_dre_latest_lines(text, uuid, boolean, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.be_eight_dre_latest_lines(text, uuid, boolean, uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.be_eight_dre_latest_lines(text, uuid, boolean, uuid, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.be_eight_dre_latest_lines(text, uuid, boolean, uuid, uuid, integer) TO service_role;

CREATE INDEX IF NOT EXISTS idx_dre_parsed_lines_closing_version_id
  ON public.dre_parsed_lines (closing_id, version_number, id);