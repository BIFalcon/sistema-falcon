CREATE OR REPLACE FUNCTION public.enqueue_ar_missing_due_date_weekly()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h record; v int := 0;
BEGIN
  FOR h IN
    SELECT e.hotel_id, max(ht.name) AS name, count(*) AS n,
      string_agg('- ' || coalesce(e.account_name,'—') || ' · conta ' || coalesce(e.invoice_number,'—') ||
        ' · boleto ' || coalesce(e.boleto_number,'—') || ' · R$ ' || to_char(coalesce(e.amount,0),'FM999G999G990D00'),
        E'\n' ORDER BY e.transaction_date) AS lines
    FROM ar_to_invoice_entries e LEFT JOIN hotels ht ON ht.id = e.hotel_id
    WHERE (e.boleto_number IS NOT NULL OR e.invoice_file_2 IS NOT NULL)
      AND e.boleto_due_date IS NULL AND coalesce(e.is_paid,false) = false AND coalesce(e.is_not_billable,false) = false
    GROUP BY e.hotel_id
  LOOP
    v := v + public.enqueue_ar_notification('ar_boleto_missing_due_date'::notification_event, h.hotel_id,
      NULL, ARRAY['controladoria','patronos']::app_role[],
      coalesce(h.name, h.hotel_id) || ' — ' || h.n || ' boleto(s) sem vencimento lido',
      'Boletos anexados em que o sistema **não conseguiu ler a data de vencimento**:' || E'\n' || h.lines,
      '/financeiro/contas-receber', jsonb_build_object('count', h.n));
  END LOOP;
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION public.enqueue_ar_missing_due_date_weekly() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_ar_missing_due_date_weekly() TO service_role;