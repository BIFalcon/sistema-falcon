
CREATE OR REPLACE FUNCTION public.get_year_latest_dre_lines(_hotel_id text, _year int)
RETURNS TABLE(
  closing_id uuid,
  version_number int,
  line_label text,
  line_value numeric,
  line_type text,
  line_level int,
  line_category text,
  line_segment text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
