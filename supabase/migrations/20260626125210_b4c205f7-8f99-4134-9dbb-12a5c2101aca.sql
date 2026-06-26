ALTER TABLE public.ap_entries
  ADD COLUMN IF NOT EXISTS category_normalized text
  GENERATED ALWAYS AS (
    lower(
      translate(
        trim(coalesce(category, '')),
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
      )
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_ap_entries_category_normalized
  ON public.ap_entries(hotel_id, category_normalized, due_date);

CREATE OR REPLACE FUNCTION public.get_ap_category_monthly_series(
  _hotel_id text,
  _category_normalized text DEFAULT NULL
)
RETURNS TABLE (
  hotel_id text,
  category_normalized text,
  ref_year integer,
  ref_month integer,
  total_amount numeric,
  entry_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION public.get_ap_category_monthly_series(text, text) TO authenticated;