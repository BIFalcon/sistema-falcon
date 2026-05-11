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
      AND line_type = 'indicator'
    GROUP BY closing_id
  )
  SELECT d.closing_id, d.line_label, d.line_value, d.version_number,
         d.line_type, d.line_level, d.line_category, d.line_segment
  FROM public.dre_parsed_lines d
  JOIN latest l ON l.closing_id = d.closing_id AND l.v = d.version_number
  WHERE d.line_type = 'indicator';
$$;

CREATE INDEX IF NOT EXISTS idx_dre_parsed_lines_type_closing
  ON public.dre_parsed_lines (closing_id, line_type, version_number);