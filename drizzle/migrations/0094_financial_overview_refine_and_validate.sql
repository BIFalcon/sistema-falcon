DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.financial_overview(text[],date,date,date[])'::regprocedure) INTO definition;
 definition := replace(definition, 'SELECT e.*, coalesce(e.boleto_due_date', 'SELECT e.*, coalesce(e.boleto_due_date');
 definition := replace(definition, 'v_today-coalesce(due,created_at::date,transaction_date) age', 'greatest(0,v_today-CASE WHEN stale THEN coalesce(created_at::date,transaction_date) ELSE coalesce(due,created_at::date,transaction_date) END) age');
 definition := replace(definition, 'SELECT sum(amount) total FROM ap_card_receivable e WHERE e.hotel_id=h.id AND CASE', 'SELECT amount total FROM ap_card_receivable e WHERE e.hotel_id=h.id AND CASE');
 definition := replace(definition, '(p_date_to IS NULL OR e.date_from<=p_date_to) END) man', '(p_date_to IS NULL OR e.date_from<=p_date_to) END ORDER BY e.created_at DESC LIMIT 1) man');
 definition := replace(definition, 'AND e.sale_date IS NOT NULL AND (coalesce', 'AND e.sale_date IS NOT NULL AND (coalesce(cardinality(p_dates),0)>0 OR p_date_from IS NULL OR e.sale_date>=p_date_from-36500) AND (coalesce(cardinality(p_dates),0)=0 OR e.sale_date>=(SELECT min(d) FROM unnest(p_dates) d)-36500) AND (coalesce');
 EXECUTE definition;
END $migration$;
CREATE INDEX IF NOT EXISTS conc_acquirer_financial_receipt_idx ON public.conc_acquirer_entries (hotel_id, (sale_date + CASE WHEN source='b2b' THEN 31 ELSE public.financial_card_term_days(prazo_recebimento) END)) WHERE source IN ('rede','b2b');
DO $validation$
DECLARE uid uuid; result jsonb; specific jsonb; other_period jsonb; item jsonb; hotel text;
BEGIN
 IF public.financial_card_term_days('31  dias cada parcela') IS DISTINCT FROM 31 OR public.financial_card_term_days('disponível em D+1') IS DISTINCT FROM 1 OR public.financial_card_term_days('Cancelado') IS NOT NULL OR public.financial_card_term_days(NULL) IS NOT NULL THEN RAISE EXCEPTION 'Card term validation failed'; END IF;
 SELECT user_id INTO uid FROM public.user_roles WHERE role='processos' LIMIT 1;
 IF uid IS NULL THEN RAISE EXCEPTION 'No authorized account for aggregate validation'; END IF;
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
 SELECT id INTO hotel FROM public.hotels WHERE id='ibis-serra-talhada';
 result := public.financial_overview(ARRAY[hotel],'2026-10-01','2026-10-31',NULL);
 other_period := public.financial_overview(ARRAY[hotel],'2026-01-01','2026-01-31',NULL);
 specific := public.financial_overview(ARRAY[hotel],'2026-01-01','2026-01-31',ARRAY['2026-10-29'::date]);
 IF jsonb_array_length(result)<>1 OR jsonb_array_length(specific)<>1 THEN RAISE EXCEPTION 'Aggregate row validation failed'; END IF;
 item := result->0;
 IF item->'overdue' IS DISTINCT FROM other_period->0->'overdue' OR item->'defaulting' IS DISTINCT FROM other_period->0->'defaulting' OR item->'open_folio' IS DISTINCT FROM other_period->0->'open_folio' THEN RAISE EXCEPTION 'Structural totals incorrectly depend on period'; END IF;
 IF (item->>'overdue')::numeric <> (item->>'overdue_lt7')::numeric+(item->>'overdue_d7_30')::numeric+(item->>'overdue_gt30')::numeric THEN RAISE EXCEPTION 'AP aging does not sum to total'; END IF;
 IF (item->>'open_folio')::numeric <> (item->>'folio_lt7')::numeric+(item->>'folio_d7_30')::numeric+(item->>'folio_gt30')::numeric+(item->>'folio_unknown')::numeric THEN RAISE EXCEPTION 'Folio aging does not sum to total'; END IF;
 IF (item->>'defaulting')::numeric <> (item->>'defaulting_lt7')::numeric+(item->>'defaulting_d7_30')::numeric+(item->>'defaulting_gt30')::numeric+(item->>'defaulting_unknown')::numeric THEN RAISE EXCEPTION 'AR aging does not sum to total'; END IF;
 IF specific->0->'card_receivable' IS DISTINCT FROM public.financial_overview(ARRAY[hotel],NULL,NULL,ARRAY['2026-10-29'::date])->0->'card_receivable' THEN RAISE EXCEPTION 'Exact dates must override range'; END IF;
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claims','{}',true);
 BEGIN
  PERFORM public.financial_overview(ARRAY[hotel],NULL,NULL,NULL);
  RAISE EXCEPTION 'Unauthenticated access was not denied';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Sem permissão para consultar o financeiro' THEN RAISE; END IF;
 END;
END $validation$;