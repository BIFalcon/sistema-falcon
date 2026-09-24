CREATE OR REPLACE FUNCTION public.conc_matched_counts_by_upload(p_upload_ids uuid[])
RETURNS TABLE(upload_id uuid, n bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT upload_id, count(*) FROM (
    SELECT upload_id FROM conc_opera_entries WHERE upload_id = ANY(p_upload_ids) AND matched_at IS NOT NULL
    UNION ALL
    SELECT upload_id FROM conc_acquirer_entries WHERE upload_id = ANY(p_upload_ids) AND matched_at IS NOT NULL
    UNION ALL
    SELECT upload_id FROM conc_bank_entries WHERE upload_id = ANY(p_upload_ids) AND matched_at IS NOT NULL
  ) s GROUP BY upload_id;
$$;
GRANT EXECUTE ON FUNCTION public.conc_matched_counts_by_upload(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.ar_to_invoice_daily_totals(p_hotel_id text, p_from date, p_to date, p_dates date[] DEFAULT NULL)
RETURNS TABLE(day date, total numeric, n bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT transaction_date, coalesce(sum(amount),0), count(*)
  FROM ar_to_invoice_entries
  WHERE hotel_id = p_hotel_id
    AND transaction_date IS NOT NULL
    AND (CASE WHEN p_dates IS NOT NULL AND array_length(p_dates,1) > 0
              THEN transaction_date = ANY(p_dates)
              ELSE (p_from IS NULL OR transaction_date >= p_from) AND (p_to IS NULL OR transaction_date <= p_to) END)
  GROUP BY 1;
$$;
GRANT EXECUTE ON FUNCTION public.ar_to_invoice_daily_totals(text, date, date, date[]) TO authenticated;
CREATE INDEX IF NOT EXISTS idx_ar_to_invoice_hotel_txdate ON public.ar_to_invoice_entries(hotel_id, transaction_date);