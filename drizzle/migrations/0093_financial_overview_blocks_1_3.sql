CREATE OR REPLACE FUNCTION public.financial_card_term_days(p_value text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path=public AS $$ SELECT CASE WHEN trim(p_value) ~* '^(\d+\s*(dias?(\s+(úteis|útil|cada parcela))?)?|disponível em D\+\d+)$' AND length(substring(p_value from '[0-9]+')) <= 5 THEN CASE WHEN substring(p_value from '[0-9]+')::integer <= 36500 THEN substring(p_value from '[0-9]+')::integer END END $$;
REVOKE ALL ON FUNCTION public.financial_card_term_days(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.financial_card_term_days(text) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.financial_overview(p_hotel_ids text[], p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL, p_dates date[] DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; v_result jsonb;
BEGIN
 IF v_uid IS NULL OR NOT (is_master(v_uid) OR has_role(v_uid,'controladoria') OR has_role(v_uid,'patronos') OR has_role(v_uid,'gg') OR has_role(v_uid,'gop') OR has_role(v_uid,'adm') OR has_role(v_uid,'viewer')) THEN RAISE EXCEPTION 'Sem permissão para consultar o financeiro'; END IF;
 IF EXISTS (SELECT 1 FROM unnest(p_hotel_ids) id WHERE NOT can_view_hotel_data(v_uid,id)) THEN RAISE EXCEPTION 'Hotel não autorizado'; END IF;
 IF coalesce(cardinality(p_dates),0)=0 AND p_date_from>p_date_to THEN RAISE EXCEPTION 'Período inválido'; END IF;
 WITH hotels_scope AS MATERIALIZED (
 SELECT h.id, h.id=ANY(ARRAY['ibis-arcoverde','ibis-budget-divinopolis','ibis-budget-manhuacu','ibis-budget-patos','ibis-cuiaba','ibis-juiz-de-fora','ibis-serra-talhada','ibis-styles-garanhuns','ibis-styles-tres-rios','ibis-caruaru']) auto_card FROM hotels h WHERE h.id=ANY(p_hotel_ids) AND can_view_hotel_data(v_uid,h.id) AND coalesce(h.rh_only,false)=false
 ), ap AS MATERIALIZED (
 SELECT e.hotel_id, e.amount, e.due_date, v_today-e.due_date age FROM ap_entries e JOIN hotels_scope h ON h.id=e.hotel_id WHERE e.archived_at IS NULL AND e.payment_status::text NOT IN ('pago','quitado') AND e.gg_approval::text<>'rejected'
 ), ar_base AS MATERIALIZED (
 SELECT e.*, coalesce(e.boleto_due_date,e.estimated_due_date, e.gg_confirmed_at::date+ct.term, e.billed_at::date+ct.term,e.transaction_date+ct.term) due,
 coalesce(e.paid_date IS NOT NULL OR e.is_paid OR e.gg_status::text='pago',false) paid_flag,
 coalesce(e.is_not_billable OR e.gg_status::text='nao_faturavel',false) notbill,
 coalesce(e.gg_status::text IN ('faturado','documentos_enviados','inadimplente') OR e.billed_at IS NOT NULL OR e.invoice_file_1 IS NOT NULL OR e.invoice_file_2 IS NOT NULL,false) billed,
 coalesce(e.invoice_file_1 IS NULL AND e.invoice_file_2 IS NULL AND e.proof_file IS NULL AND e.billed_at IS NULL AND e.gg_confirmed_at IS NULL AND e.nota_number IS NULL AND e.boleto_number IS NULL AND e.boleto_due_date IS NULL AND e.gg_note IS NULL AND e.documents_problem_at IS NULL AND NOT e.is_not_billable AND (e.gg_status IS NULL OR e.gg_status::text='pendente') AND coalesce(e.created_at::date,e.transaction_date)<v_today-30,false) stale
 FROM ar_to_invoice_entries e JOIN hotels_scope h ON h.id=e.hotel_id LEFT JOIN LATERAL (SELECT c.payment_term_days term FROM ar_client_contracts c WHERE c.hotel_id=e.hotel_id AND ((e.account_number IS NOT NULL AND c.account_number=e.account_number) OR (c.account_number IS NULL AND e.account_name IS NOT NULL AND lower(c.account_name)=lower(e.account_name))) ORDER BY (e.account_number IS NOT NULL AND c.account_number=e.account_number) DESC LIMIT 1) ct ON true
 ), ar AS MATERIALIZED (
 SELECT a.*, NOT paid_flag AND NOT notbill AND (stale OR (billed AND due<v_today)) default_flag, v_today-coalesce(due,created_at::date,transaction_date) age FROM ar_base a
 ), folio AS MATERIALIZED (
 SELECT e.hotel_id,e.balance, CASE WHEN e.departure_date IS NOT NULL THEN greatest(0,v_today-e.departure_date) WHEN e.days_open IS NOT NULL AND e.extraction_date IS NOT NULL THEN greatest(0,e.days_open+v_today-e.extraction_date) END age FROM ar_open_folio_entries e JOIN hotels_scope h ON h.id=e.hotel_id WHERE e.archived_at IS NULL
 ), card AS MATERIALIZED (
 SELECT e.hotel_id, coalesce(e.valor_liquido,e.amount) amount, e.sale_date+CASE WHEN e.source='b2b' THEN 31 ELSE financial_card_term_days(e.prazo_recebimento) END receipt FROM conc_acquirer_entries e JOIN hotels_scope h ON h.id=e.hotel_id AND h.auto_card WHERE e.source IN ('rede','b2b') AND e.sale_date IS NOT NULL AND (coalesce(cardinality(p_dates),0)>0 OR p_date_to IS NULL OR e.sale_date<=p_date_to) AND (coalesce(cardinality(p_dates),0)=0 OR e.sale_date<=(SELECT max(d) FROM unnest(p_dates) d))
 ), latest_balance AS MATERIALIZED (
 SELECT DISTINCT ON (e.hotel_id,e.bank_name) e.hotel_id,e.amount FROM ap_bank_balance e JOIN hotels_scope h ON h.id=e.hotel_id ORDER BY e.hotel_id,e.bank_name,e.balance_date DESC,e.updated_at DESC
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
 'hotel_id',h.id,'automatic_card',h.auto_card,
 'payable',coalesce(pa.payable,0),'overdue',coalesce(pa.overdue,0),'overdue_lt7',coalesce(pa.lt7,0),'overdue_d7_30',coalesce(pa.d7_30,0),'overdue_gt30',coalesce(pa.gt30,0),
 'defaulting',coalesce(ra.defaulting,0),'defaulting_lt7',coalesce(ra.lt7,0),'defaulting_d7_30',coalesce(ra.d7_30,0),'defaulting_gt30',coalesce(ra.gt30,0),'defaulting_unknown',coalesce(ra.unknown,0),'to_invoice',coalesce(ra.to_invoice,0),
 'open_folio',coalesce(fo.total,0),'folio_lt7',coalesce(fo.lt7,0),'folio_d7_30',coalesce(fo.d7_30,0),'folio_gt30',coalesce(fo.gt30,0),'folio_unknown',coalesce(fo.unknown,0),
 'card_receivable',CASE WHEN h.auto_card THEN coalesce(ca.total,0) ELSE coalesce(man.total,0) END,'invalid_card_terms',coalesce(ca.invalid,0),
 'bank_balance',coalesce(ba.total,0),'paid_interest',coalesce(ju.total,0),'anticipated',coalesce(an.total,0),'anticipation_charge',coalesce(an.charge,0)) ORDER BY h.id),'[]'::jsonb) INTO v_result
 FROM hotels_scope h
 LEFT JOIN LATERAL (SELECT sum(amount) FILTER(WHERE due_date>=v_today AND CASE WHEN coalesce(cardinality(p_dates),0)>0 THEN due_date=ANY(p_dates) ELSE (p_date_from IS NULL OR due_date>=p_date_from) AND (p_date_to IS NULL OR due_date<=p_date_to) END) payable, sum(amount) FILTER(WHERE age>0) overdue,sum(amount) FILTER(WHERE age>0 AND age<7) lt7,sum(amount) FILTER(WHERE age BETWEEN 7 AND 30) d7_30,sum(amount) FILTER(WHERE age>30) gt30 FROM ap WHERE hotel_id=h.id) pa ON true
 LEFT JOIN LATERAL (SELECT sum(coalesce(ar_open,amount)) FILTER(WHERE default_flag) defaulting, sum(coalesce(ar_open,amount)) FILTER(WHERE default_flag AND age<7) lt7,sum(coalesce(ar_open,amount)) FILTER(WHERE default_flag AND age BETWEEN 7 AND 30) d7_30,sum(coalesce(ar_open,amount)) FILTER(WHERE default_flag AND age>30) gt30,sum(coalesce(ar_open,amount)) FILTER(WHERE default_flag AND age IS NULL) unknown, sum(coalesce(ar_open,amount)) FILTER(WHERE CASE WHEN coalesce(cardinality(p_dates),0)>0 THEN estimated_due_date=ANY(p_dates) ELSE (p_date_from IS NULL OR estimated_due_date>=p_date_from) AND (p_date_to IS NULL OR estimated_due_date<=p_date_to) END) to_invoice FROM ar WHERE hotel_id=h.id) ra ON true
 LEFT JOIN LATERAL (SELECT sum(balance) total,sum(balance) FILTER(WHERE age<7) lt7,sum(balance) FILTER(WHERE age BETWEEN 7 AND 30) d7_30,sum(balance) FILTER(WHERE age>30) gt30,sum(balance) FILTER(WHERE age IS NULL) unknown FROM folio WHERE hotel_id=h.id) fo ON true
 LEFT JOIN LATERAL (SELECT sum(amount) FILTER(WHERE CASE WHEN coalesce(cardinality(p_dates),0)>0 THEN receipt=ANY(p_dates) ELSE (p_date_from IS NULL OR receipt>=p_date_from) AND (p_date_to IS NULL OR receipt<=p_date_to) END) total,count(*) FILTER(WHERE receipt IS NULL) invalid FROM card WHERE hotel_id=h.id) ca ON true
 LEFT JOIN LATERAL (SELECT sum(amount) total FROM ap_card_receivable e WHERE e.hotel_id=h.id AND CASE WHEN coalesce(cardinality(p_dates),0)>0 THEN EXISTS(SELECT 1 FROM unnest(p_dates) d WHERE d BETWEEN e.date_from AND e.date_to) ELSE (p_date_from IS NULL OR e.date_to>=p_date_from) AND (p_date_to IS NULL OR e.date_from<=p_date_to) END) man ON true
 LEFT JOIN LATERAL (SELECT sum(amount) total FROM latest_balance WHERE hotel_id=h.id) ba ON true
 LEFT JOIN LATERAL (SELECT sum(paid_interest) total FROM ap_entries e WHERE e.hotel_id=h.id AND e.payment_status::text='pago' AND CASE WHEN coalesce(cardinality(p_dates),0)>0 THEN e.payment_paid_at::date=ANY(p_dates) ELSE (p_date_from IS NULL OR e.payment_paid_at::date>=p_date_from) AND (p_date_to IS NULL OR e.payment_paid_at::date<=p_date_to) END) ju ON true
 LEFT JOIN LATERAL (SELECT sum(anticipated_amount) total,sum(valor_descontado) charge FROM ap_anticipation e WHERE e.hotel_id=h.id AND (e.status IS NULL OR e.status='confirmada') AND CASE WHEN coalesce(cardinality(p_dates),0)>0 THEN data_antecipacao=ANY(p_dates) ELSE (p_date_from IS NULL OR data_antecipacao>=p_date_from) AND (p_date_to IS NULL OR data_antecipacao<=p_date_to) END) an ON true;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.financial_overview(text[],date,date,date[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financial_overview(text[],date,date,date[]) TO authenticated;
COMMENT ON FUNCTION public.financial_overview(text[],date,date,date[]) IS 'Read-only hotel-authorized financial aggregates; structural aging ignores period, temporal metrics use exact days before range; no individual AP data exposed.';