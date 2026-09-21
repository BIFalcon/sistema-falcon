CREATE OR REPLACE FUNCTION public.ar_to_invoice_totals(
  p_hotel_id text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_dates date[] DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_hotel_ids text[] DEFAULT NULL
)
RETURNS TABLE(hotel_id text, ym text, total numeric, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH access AS MATERIALIZED (
    SELECT auth.uid() AS uid,
           public.has_global_data_access(auth.uid()) AS global_access,
           public.has_role(auth.uid(), 'ri') AS is_ri
  ), base AS MATERIALIZED (
    SELECT e.hotel_id, e.transaction_date, e.amount,
      coalesce(e.paid_date IS NOT NULL OR e.is_paid = true OR e.gg_status::text = 'pago', false) AS f_paid,
      coalesce(e.gg_status::text = 'nao_faturavel' OR e.is_not_billable = true, false) AS f_notbill,
      coalesce(e.gg_status::text = 'faturado', false) AS f_faturado,
      coalesce(
        e.boleto_due_date,
        e.estimated_due_date,
        CASE WHEN ct.term IS NOT NULL AND e.gg_confirmed_at IS NOT NULL THEN e.gg_confirmed_at::date + ct.term END,
        CASE WHEN ct.term IS NOT NULL AND e.billed_at IS NOT NULL THEN e.billed_at::date + ct.term END,
        CASE WHEN ct.term IS NOT NULL AND e.transaction_date IS NOT NULL THEN e.transaction_date + ct.term END
      ) AS f_due,
      coalesce(
        e.gg_status::text IN ('faturado', 'documentos_enviados', 'inadimplente')
        OR e.billed_at IS NOT NULL OR e.invoice_file_1 IS NOT NULL OR e.invoice_file_2 IS NOT NULL,
        false
      ) AS f_billed,
      coalesce(
        e.invoice_file_1 IS NULL AND e.invoice_file_2 IS NULL AND e.proof_file IS NULL
        AND e.billed_at IS NULL AND e.gg_confirmed_at IS NULL
        AND e.nota_number IS NULL AND e.boleto_number IS NULL AND e.boleto_due_date IS NULL
        AND e.gg_note IS NULL AND e.documents_problem_at IS NULL
        AND e.is_not_billable IS NOT true
        AND NOT coalesce(e.paid_date IS NOT NULL OR e.is_paid = true OR e.gg_status::text = 'pago', false)
        AND (e.gg_status IS NULL OR e.gg_status::text = 'pendente')
        AND coalesce(e.created_at::date, e.transaction_date) < (current_date - 30),
        false
      ) AS f_stale
    FROM public.ar_to_invoice_entries e
    CROSS JOIN access a
    LEFT JOIN LATERAL (
      SELECT c.payment_term_days AS term
      FROM public.ar_client_contracts c
      WHERE p_hotel_id IS NOT NULL
        AND c.hotel_id = e.hotel_id
        AND ((e.account_number IS NOT NULL AND c.account_number = e.account_number)
          OR (c.account_number IS NULL AND e.account_name IS NOT NULL AND lower(c.account_name) = lower(e.account_name)))
      ORDER BY (e.account_number IS NOT NULL AND c.account_number = e.account_number) DESC
      LIMIT 1
    ) ct ON true
    WHERE a.uid IS NOT NULL AND NOT a.is_ri
      AND (a.global_access OR public.is_hotel_allowed(a.uid, e.hotel_id))
      AND (p_hotel_id IS NULL OR e.hotel_id = p_hotel_id)
      AND (p_hotel_ids IS NULL OR e.hotel_id = ANY(p_hotel_ids))
      AND (CASE WHEN p_dates IS NOT NULL AND array_length(p_dates, 1) > 0
        THEN e.transaction_date = ANY(p_dates)
        ELSE (p_date_from IS NULL OR e.transaction_date >= p_date_from)
          AND (p_date_to IS NULL OR e.transaction_date <= p_date_to)
      END)
  ), flagged AS (
    SELECT b.*,
      (NOT b.f_paid AND NOT b.f_notbill
        AND (b.f_stale OR (b.f_billed AND b.f_due IS NOT NULL AND b.f_due < current_date))) AS f_default
    FROM base b
  )
  SELECT f.hotel_id,
         to_char(f.transaction_date, 'YYYY-MM') AS ym,
         coalesce(sum(f.amount), 0)::numeric AS total,
         count(*)::bigint AS cnt
  FROM flagged f
  WHERE p_status IS NULL OR p_status = 'todos'
     OR (p_status = 'pago' AND f.f_paid)
     OR (p_status = 'nao_faturavel' AND f.f_notbill)
     OR (p_status = 'faturado' AND f.f_faturado)
     OR (p_status = 'inadimplente' AND f.f_default)
     OR (p_status = 'pendente' AND NOT f.f_paid AND NOT f.f_notbill AND NOT f.f_billed AND NOT f.f_default)
  GROUP BY 1, 2
$function$;

CREATE OR REPLACE FUNCTION public.ar_to_invoice_status_counts(
  p_hotel_id text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_dates date[] DEFAULT NULL,
  p_hotel_ids text[] DEFAULT NULL
)
RETURNS TABLE(todos bigint, pendente bigint, faturado bigint, pago bigint, inadimplente bigint, nao_faturavel bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH access AS MATERIALIZED (
    SELECT auth.uid() AS uid,
           public.has_global_data_access(auth.uid()) AS global_access,
           public.has_role(auth.uid(), 'ri') AS is_ri
  ), base AS MATERIALIZED (
    SELECT
      coalesce(e.paid_date IS NOT NULL OR e.is_paid = true OR e.gg_status::text = 'pago', false) AS f_paid,
      coalesce(e.gg_status::text = 'nao_faturavel' OR e.is_not_billable = true, false) AS f_notbill,
      coalesce(e.gg_status::text = 'faturado', false) AS f_faturado,
      coalesce(e.boleto_due_date, e.estimated_due_date,
        CASE WHEN ct.term IS NOT NULL AND e.gg_confirmed_at IS NOT NULL THEN e.gg_confirmed_at::date + ct.term END,
        CASE WHEN ct.term IS NOT NULL AND e.billed_at IS NOT NULL THEN e.billed_at::date + ct.term END,
        CASE WHEN ct.term IS NOT NULL AND e.transaction_date IS NOT NULL THEN e.transaction_date + ct.term END) AS f_due,
      coalesce(e.gg_status::text IN ('faturado', 'documentos_enviados', 'inadimplente')
        OR e.billed_at IS NOT NULL OR e.invoice_file_1 IS NOT NULL OR e.invoice_file_2 IS NOT NULL, false) AS f_billed,
      coalesce(e.invoice_file_1 IS NULL AND e.invoice_file_2 IS NULL AND e.proof_file IS NULL
        AND e.billed_at IS NULL AND e.gg_confirmed_at IS NULL
        AND e.nota_number IS NULL AND e.boleto_number IS NULL AND e.boleto_due_date IS NULL
        AND e.gg_note IS NULL AND e.documents_problem_at IS NULL
        AND e.is_not_billable IS NOT true
        AND NOT coalesce(e.paid_date IS NOT NULL OR e.is_paid = true OR e.gg_status::text = 'pago', false)
        AND (e.gg_status IS NULL OR e.gg_status::text = 'pendente')
        AND coalesce(e.created_at::date, e.transaction_date) < (current_date - 30), false) AS f_stale
    FROM public.ar_to_invoice_entries e
    CROSS JOIN access a
    LEFT JOIN LATERAL (
      SELECT c.payment_term_days AS term
      FROM public.ar_client_contracts c
      WHERE p_hotel_id IS NOT NULL AND c.hotel_id = e.hotel_id
        AND ((e.account_number IS NOT NULL AND c.account_number = e.account_number)
          OR (c.account_number IS NULL AND e.account_name IS NOT NULL AND lower(c.account_name) = lower(e.account_name)))
      ORDER BY (e.account_number IS NOT NULL AND c.account_number = e.account_number) DESC
      LIMIT 1
    ) ct ON true
    WHERE a.uid IS NOT NULL AND NOT a.is_ri
      AND (a.global_access OR public.is_hotel_allowed(a.uid, e.hotel_id))
      AND (p_hotel_id IS NULL OR e.hotel_id = p_hotel_id)
      AND (p_hotel_ids IS NULL OR e.hotel_id = ANY(p_hotel_ids))
      AND (CASE WHEN p_dates IS NOT NULL AND array_length(p_dates, 1) > 0
        THEN e.transaction_date = ANY(p_dates)
        ELSE (p_date_from IS NULL OR e.transaction_date >= p_date_from)
          AND (p_date_to IS NULL OR e.transaction_date <= p_date_to)
      END)
  ), flagged AS (
    SELECT b.*, (NOT b.f_paid AND NOT b.f_notbill
      AND (b.f_stale OR (b.f_billed AND b.f_due IS NOT NULL AND b.f_due < current_date))) AS f_default
    FROM base b
  )
  SELECT count(*)::bigint,
    count(*) FILTER (WHERE NOT f_paid AND NOT f_notbill AND NOT f_billed AND NOT f_default)::bigint,
    count(*) FILTER (WHERE f_faturado)::bigint,
    count(*) FILTER (WHERE f_paid)::bigint,
    count(*) FILTER (WHERE f_default)::bigint,
    count(*) FILTER (WHERE f_notbill)::bigint
  FROM flagged
$function$;

REVOKE ALL ON FUNCTION public.ar_to_invoice_totals(text,date,date,date[],text,text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ar_to_invoice_status_counts(text,date,date,date[],text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ar_to_invoice_totals(text,date,date,date[],text,text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ar_to_invoice_status_counts(text,date,date,date[],text[]) TO authenticated, service_role;