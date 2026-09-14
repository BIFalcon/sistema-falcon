create or replace function public.ar_to_invoice_totals(
  p_hotel_id text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_dates date[] default null
)
returns table(hotel_id text, ym text, total numeric, cnt bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select e.hotel_id,
         to_char(e.transaction_date, 'YYYY-MM') as ym,
         coalesce(sum(e.amount), 0)::numeric as total,
         count(*)::bigint as cnt
  from public.ar_to_invoice_entries e
  where (p_hotel_id is null or e.hotel_id = p_hotel_id)
    and (
      case when p_dates is not null and array_length(p_dates, 1) > 0
        then e.transaction_date = any(p_dates)
        else (p_date_from is null or e.transaction_date >= p_date_from)
         and (p_date_to is null or e.transaction_date <= p_date_to)
      end
    )
  group by 1, 2
$$;

create or replace function public.ar_to_invoice_status_counts(
  p_hotel_id text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_dates date[] default null
)
returns table(
  todos bigint,
  pendente bigint,
  faturado bigint,
  pago bigint,
  inadimplente bigint,
  nao_faturavel bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select e.*,
      coalesce(e.paid_date is not null or e.is_paid = true or e.gg_status::text = 'pago', false) as f_paid,
      coalesce(e.gg_status::text = 'nao_faturavel' or e.is_not_billable = true, false) as f_notbill,
      coalesce(e.boleto_due_date, e.estimated_due_date) as f_due,
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
    where (p_hotel_id is null or e.hotel_id = p_hotel_id)
      and (
        case when p_dates is not null and array_length(p_dates, 1) > 0
          then e.transaction_date = any(p_dates)
          else (p_date_from is null or e.transaction_date >= p_date_from)
           and (p_date_to is null or e.transaction_date <= p_date_to)
        end
      )
  )
  select
    count(*)::bigint,
    count(*) filter (where coalesce(gg_status::text, 'pendente') <> 'faturado' and not f_notbill and not f_paid)::bigint,
    count(*) filter (where gg_status::text = 'faturado')::bigint,
    count(*) filter (where f_paid)::bigint,
    count(*) filter (
      where not f_paid and not f_notbill
        and (f_stale or (f_billed and f_due is not null and f_due < current_date))
    )::bigint,
    count(*) filter (where f_notbill)::bigint
  from base
$$;

revoke all on function public.ar_to_invoice_totals(text, date, date, date[]) from public;
revoke all on function public.ar_to_invoice_status_counts(text, date, date, date[]) from public;
grant execute on function public.ar_to_invoice_totals(text, date, date, date[]) to authenticated, service_role;
grant execute on function public.ar_to_invoice_status_counts(text, date, date, date[]) to authenticated, service_role;