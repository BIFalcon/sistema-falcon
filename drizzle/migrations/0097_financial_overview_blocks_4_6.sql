DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.financial_overview(text[],date,date,date[])'::regprocedure) INTO definition;
 IF strpos(definition, 'unmatched_opera_count')>0 THEN RAISE EXCEPTION 'Overview extension already exists'; END IF;
 definition := replace(definition, '), latest_balance AS MATERIALIZED (', '), opera_period AS MATERIALIZED (
 SELECT e.hotel_id,e.amount,e.matched_at,e.base_conciliacao FROM public.conc_opera_entries e JOIN hotels_scope h ON h.id=e.hotel_id WHERE CASE WHEN coalesce(cardinality(p_dates),0)>0 THEN e.business_date=ANY(p_dates) ELSE (p_date_from IS NULL OR e.business_date>=p_date_from) AND (p_date_to IS NULL OR e.business_date<=p_date_to) END
 ), acquirer_period AS MATERIALIZED (
 SELECT e.hotel_id,e.amount FROM public.conc_acquirer_entries e JOIN hotels_scope h ON h.id=e.hotel_id WHERE e.matched_at IS NULL AND CASE WHEN coalesce(cardinality(p_dates),0)>0 THEN e.sale_date=ANY(p_dates) ELSE (p_date_from IS NULL OR e.sale_date>=p_date_from) AND (p_date_to IS NULL OR e.sale_date<=p_date_to) END
 ), latest_balance AS MATERIALIZED (');
 definition := replace(definition, '''bank_balance'',coalesce(ba.total,0)', '''unmatched_opera_count'',coalesce(op.pending_count,0),''unmatched_opera_amount'',coalesce(op.pending_amount,0),''unmatched_acquirer_count'',coalesce(aq.pending_count,0),''unmatched_acquirer_amount'',coalesce(aq.pending_amount,0),''pix_receivable'',coalesce(op.pix,0),''cash_receivable'',coalesce(op.cash,0),''invoice_receivable'',coalesce(ra.invoice_receivable,0),''bank_balance'',coalesce(ba.total,0)');
 definition := replace(definition, 'to_invoice FROM ar WHERE hotel_id=h.id) ra ON true', 'to_invoice, sum(coalesce(ar_open,amount)) FILTER(WHERE NOT paid_flag AND NOT notbill AND NOT default_flag AND due>=v_today AND CASE WHEN coalesce(cardinality(p_dates),0)>0 THEN due=ANY(p_dates) ELSE (p_date_from IS NULL OR due>=p_date_from) AND (p_date_to IS NULL OR due<=p_date_to) END) invoice_receivable FROM ar WHERE hotel_id=h.id) ra ON true');
 definition := replace(definition, 'LEFT JOIN LATERAL (SELECT sum(amount) total FROM latest_balance', 'LEFT JOIN LATERAL (SELECT count(*) FILTER(WHERE matched_at IS NULL) pending_count,sum(amount) FILTER(WHERE matched_at IS NULL) pending_amount,sum(amount) FILTER(WHERE matched_at IS NULL AND base_conciliacao=''PIX'') pix,sum(amount) FILTER(WHERE matched_at IS NULL AND base_conciliacao=''DINHEIRO'') cash FROM opera_period WHERE hotel_id=h.id) op ON true
 LEFT JOIN LATERAL (SELECT count(*) pending_count,sum(amount) pending_amount FROM acquirer_period WHERE hotel_id=h.id) aq ON true
 LEFT JOIN LATERAL (SELECT sum(amount) total FROM latest_balance');
 IF strpos(definition,'invoice_receivable FROM ar')=0 OR strpos(definition,'FROM opera_period WHERE')=0 OR strpos(definition,'unmatched_opera_count')=0 THEN RAISE EXCEPTION 'Overview extension source mismatch'; END IF;
 EXECUTE definition;
END $migration$;
CREATE INDEX IF NOT EXISTS conc_opera_overview_pending_idx ON public.conc_opera_entries(hotel_id,business_date) WHERE matched_at IS NULL;
CREATE INDEX IF NOT EXISTS conc_acquirer_overview_pending_idx ON public.conc_acquirer_entries(hotel_id,sale_date) WHERE matched_at IS NULL;
COMMENT ON FUNCTION public.financial_overview(text[],date,date,date[]) IS 'Hotel-authorized read-only aggregates: period-scoped unmatched Opera/acquirer and invoice/card/PIX/cash receivables; structural aging remains current. PIX/cash use unmatched Opera routing to avoid double-counting bank or acquirer sides.';