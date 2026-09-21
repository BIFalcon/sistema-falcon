-- Faturamento (Contas a Receber):
-- 1. Totais e contadores por situação passam a varrer a base uma única vez
--    (antes ar_to_invoice_status_counts chamava ar_to_invoice_totals 6x).
-- 2. Escopo de hotéis visíveis (GG/GOP) aplicado no banco, para os contadores
--    baterem exatamente com a lista exibida.
-- 3. "Pendente" passa a excluir tudo que já tem outra situação (faturado,
--    documentos enviados, pago, não faturável e inadimplente).

CREATE OR REPLACE FUNCTION public.ar_to_invoice_totals(
  p_hotel_id text DEFAULT NULL::text,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_dates date[] DEFAULT NULL::date[],
  p_status text DEFAULT NULL::text,
  p_hotel_ids text[] DEFAULT NULL::text[]
)
RETURNS TABLE(hotel_id text, ym text, total numeric, cnt bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  with base as (
    select e.hotel_id, e.transaction_date, e.amount,
      coalesce(e.paid_date is not null or e.is_paid = true or e.gg_status::text = 'pago', false) as f_paid,
      coalesce(e.gg_status::text = 'nao_faturavel' or e.is_not_billable = true, false) as f_notbill,
      coalesce(e.gg_status::text = 'faturado', false) as f_faturado,
      coalesce(
        e.boleto_due_date,
        e.estimated_due_date,
        case when ct.term is not null and e.gg_confirmed_at is not null then e.gg_confirmed_at::date + ct.term end,
        case when ct.term is not null and e.billed_at is not null then e.billed_at::date + ct.term end,
        case when ct.term is not null and e.transaction_date is not null then e.transaction_date + ct.term end
      ) as f_due,
      coalesce(
        e.gg_status::text in ('faturado', 'documentos_enviados', 'inadimplente')
        or e.billed_at is not null
        or e.invoice_file_1 is not null
        or e.invoice_file_2 is not null
      , false) as f_billed,
      coalesce(
        e.invoice_file_1 is null and e.invoice_file_2 is null and e.proof_file is null
        and e.billed_at is null and e.gg_confirmed_at is null
        and e.nota_number is null and e.boleto_number is null and e.boleto_due_date is null
        and e.gg_note is null and e.documents_problem_at is null
        and e.is_not_billable is not true
        and not coalesce(e.paid_date is not null or e.is_paid = true or e.gg_status::text = 'pago', false)
        and (e.gg_status is null or e.gg_status::text = 'pendente')
        and coalesce(e.created_at::date, e.transaction_date) < (current_date - 30)
      , false) as f_stale
    from public.ar_to_invoice_entries e
    left join lateral (
      select c.payment_term_days as term
      from public.ar_client_contracts c
      where p_hotel_id is not null
        and c.hotel_id = e.hotel_id
        and (
          (e.account_number is not null and c.account_number = e.account_number)
          or (c.account_number is null and e.account_name is not null
              and lower(c.account_name) = lower(e.account_name))
        )
      order by (e.account_number is not null and c.account_number = e.account_number) desc
      limit 1
    ) ct on true
    where (p_hotel_id is null or e.hotel_id = p_hotel_id)
      and (p_hotel_ids is null or e.hotel_id = any(p_hotel_ids))
      and (
        case when p_dates is not null and array_length(p_dates, 1) > 0
          then e.transaction_date = any(p_dates)
          else (p_date_from is null or e.transaction_date >= p_date_from)
           and (p_date_to is null or e.transaction_date <= p_date_to)
        end
      )
  ), flagged as (
    select b.*,
      (not b.f_paid and not b.f_notbill
        and (b.f_stale or (b.f_billed and b.f_due is not null and b.f_due < current_date))) as f_default
    from base b
  )
  select f.hotel_id,
         to_char(f.transaction_date, 'YYYY-MM') as ym,
         coalesce(sum(f.amount), 0)::numeric as total,
         count(*)::bigint as cnt
  from flagged f
  where p_status is null or p_status = 'todos'
     or (p_status = 'pago' and f.f_paid)
     or (p_status = 'nao_faturavel' and f.f_notbill)
     or (p_status = 'faturado' and f.f_faturado)
     or (p_status = 'inadimplente' and f.f_default)
     or (p_status = 'pendente'
         and not f.f_paid and not f.f_notbill and not f.f_billed and not f.f_default)
  group by 1, 2
$function$;

CREATE OR REPLACE FUNCTION public.ar_to_invoice_status_counts(
  p_hotel_id text DEFAULT NULL::text,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_dates date[] DEFAULT NULL::date[],
  p_hotel_ids text[] DEFAULT NULL::text[]
)
RETURNS TABLE(todos bigint, pendente bigint, faturado bigint, pago bigint, inadimplente bigint, nao_faturavel bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  with base as (
    select
      coalesce(e.paid_date is not null or e.is_paid = true or e.gg_status::text = 'pago', false) as f_paid,
      coalesce(e.gg_status::text = 'nao_faturavel' or e.is_not_billable = true, false) as f_notbill,
      coalesce(e.gg_status::text = 'faturado', false) as f_faturado,
      coalesce(
        e.boleto_due_date,
        e.estimated_due_date,
        case when ct.term is not null and e.gg_confirmed_at is not null then e.gg_confirmed_at::date + ct.term end,
        case when ct.term is not null and e.billed_at is not null then e.billed_at::date + ct.term end,
        case when ct.term is not null and e.transaction_date is not null then e.transaction_date + ct.term end
      ) as f_due,
      coalesce(
        e.gg_status::text in ('faturado', 'documentos_enviados', 'inadimplente')
        or e.billed_at is not null
        or e.invoice_file_1 is not null
        or e.invoice_file_2 is not null
      , false) as f_billed,
      coalesce(
        e.invoice_file_1 is null and e.invoice_file_2 is null and e.proof_file is null
        and e.billed_at is null and e.gg_confirmed_at is null
        and e.nota_number is null and e.boleto_number is null and e.boleto_due_date is null
        and e.gg_note is null and e.documents_problem_at is null
        and e.is_not_billable is not true
        and not coalesce(e.paid_date is not null or e.is_paid = true or e.gg_status::text = 'pago', false)
        and (e.gg_status is null or e.gg_status::text = 'pendente')
        and coalesce(e.created_at::date, e.transaction_date) < (current_date - 30)
      , false) as f_stale
    from public.ar_to_invoice_entries e
    left join lateral (
      select c.payment_term_days as term
      from public.ar_client_contracts c
      where p_hotel_id is not null
        and c.hotel_id = e.hotel_id
        and (
          (e.account_number is not null and c.account_number = e.account_number)
          or (c.account_number is null and e.account_name is not null
              and lower(c.account_name) = lower(e.account_name))
        )
      order by (e.account_number is not null and c.account_number = e.account_number) desc
      limit 1
    ) ct on true
    where (p_hotel_id is null or e.hotel_id = p_hotel_id)
      and (p_hotel_ids is null or e.hotel_id = any(p_hotel_ids))
      and (
        case when p_dates is not null and array_length(p_dates, 1) > 0
          then e.transaction_date = any(p_dates)
          else (p_date_from is null or e.transaction_date >= p_date_from)
           and (p_date_to is null or e.transaction_date <= p_date_to)
        end
      )
  ), flagged as (
    select b.*,
      (not b.f_paid and not b.f_notbill
        and (b.f_stale or (b.f_billed and b.f_due is not null and b.f_due < current_date))) as f_default
    from base b
  )
  select
    count(*)::bigint,
    count(*) filter (where not f_paid and not f_notbill and not f_billed and not f_default)::bigint,
    count(*) filter (where f_faturado)::bigint,
    count(*) filter (where f_paid)::bigint,
    count(*) filter (where f_default)::bigint,
    count(*) filter (where f_notbill)::bigint
  from flagged
$function$;

GRANT EXECUTE ON FUNCTION public.ar_to_invoice_totals(text, date, date, date[], text, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ar_to_invoice_status_counts(text, date, date, date[], text[]) TO authenticated, service_role;
