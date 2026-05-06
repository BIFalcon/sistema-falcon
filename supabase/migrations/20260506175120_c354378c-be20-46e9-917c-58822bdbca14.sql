
CREATE INDEX IF NOT EXISTS idx_dre_parsed_lines_closing_version
  ON public.dre_parsed_lines (closing_id, version_number DESC);

CREATE OR REPLACE FUNCTION public.get_latest_dre_lines_by_closings(_closing_ids uuid[])
RETURNS TABLE (
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
  WITH latest AS (
    SELECT closing_id, MAX(version_number) AS v
    FROM public.dre_parsed_lines
    WHERE closing_id = ANY(_closing_ids)
    GROUP BY closing_id
  )
  SELECT d.closing_id, d.line_label, d.line_value, d.version_number,
         d.line_type, d.line_level, d.line_category, d.line_segment
  FROM public.dre_parsed_lines d
  JOIN latest l ON l.closing_id = d.closing_id AND l.v = d.version_number;
$$;

CREATE OR REPLACE FUNCTION public.get_latest_dre_lines(_closing_id uuid)
RETURNS TABLE (
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
  WITH v AS (
    SELECT MAX(version_number) AS top FROM public.dre_parsed_lines WHERE closing_id = _closing_id
  )
  SELECT d.line_label, d.line_value, d.version_number,
         d.line_type, d.line_level, d.line_category, d.line_segment
  FROM public.dre_parsed_lines d, v
  WHERE d.closing_id = _closing_id AND d.version_number = v.top;
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_dre_lines_by_closings(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_latest_dre_lines(uuid) TO authenticated;
