drop function if exists public.ar_to_invoice_totals(text, date, date, date[]);

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

revoke all on function public.ar_to_invoice_totals(text, date, date, date[], text) from public;
grant execute on function public.ar_to_invoice_totals(text, date, date, date[], text) to authenticated, service_role;