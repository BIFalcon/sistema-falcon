create or replace function public.ar_to_invoice_totals(
  p_hotel_id text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_dates date[] default null,
  p_status text default null
)
returns table(hotel_id text, ym text, total numeric, cnt bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select e.*,
      coalesce(e.paid_date is not null or e.is_paid = true or e.gg_status::text = 'pago', false) as f_paid,
      coalesce(e.gg_status::text = 'nao_faturavel' or e.is_not_billable = true, false) as f_notbill,
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
      and (
        case when p_dates is not null and array_length(p_dates, 1) > 0
          then e.transaction_date = any(p_dates)
          else (p_date_from is null or e.transaction_date >= p_date_from)
           and (p_date_to is null or e.transaction_date <= p_date_to)
        end
      )
  )
  select b.hotel_id,
         to_char(b.transaction_date, 'YYYY-MM') as ym,
         coalesce(sum(b.amount), 0)::numeric as total,
         count(*)::bigint as cnt
  from base b
  where p_status is null or p_status = 'todos'
     or (p_status = 'pago' and b.f_paid)
     or (p_status = 'nao_faturavel' and b.f_notbill)
     or (p_status = 'faturado' and b.gg_status::text = 'faturado')
     or (p_status = 'pendente'
         and coalesce(b.gg_status::text, 'pendente') not in ('faturado', 'nao_faturavel')
         and b.is_not_billable is not true and not b.f_paid)
     or (p_status = 'inadimplente' and not b.f_paid and not b.f_notbill
         and (b.f_stale or (b.f_billed and b.f_due is not null and b.f_due < current_date)))
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
  select
    (select cnt from (select coalesce(sum(cnt), 0)::bigint as cnt from public.ar_to_invoice_totals(p_hotel_id, p_date_from, p_date_to, p_dates, 'todos')) x),
    (select coalesce(sum(cnt), 0)::bigint from public.ar_to_invoice_totals(p_hotel_id, p_date_from, p_date_to, p_dates, 'pendente')),
    (select coalesce(sum(cnt), 0)::bigint from public.ar_to_invoice_totals(p_hotel_id, p_date_from, p_date_to, p_dates, 'faturado')),
    (select coalesce(sum(cnt), 0)::bigint from public.ar_to_invoice_totals(p_hotel_id, p_date_from, p_date_to, p_dates, 'pago')),
    (select coalesce(sum(cnt), 0)::bigint from public.ar_to_invoice_totals(p_hotel_id, p_date_from, p_date_to, p_dates, 'inadimplente')),
    (select coalesce(sum(cnt), 0)::bigint from public.ar_to_invoice_totals(p_hotel_id, p_date_from, p_date_to, p_dates, 'nao_faturavel'))
$$;

revoke all on function public.ar_to_invoice_totals(text, date, date, date[], text) from public;
revoke all on function public.ar_to_invoice_status_counts(text, date, date, date[]) from public;
grant execute on function public.ar_to_invoice_totals(text, date, date, date[], text) to authenticated, service_role;
grant execute on function public.ar_to_invoice_status_counts(text, date, date, date[]) to authenticated, service_role;