CREATE OR REPLACE FUNCTION public.conc_is_pix_bank(description text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT coalesce(upper(description),'') !~ '\mBOLETOS?\M' AND coalesce(upper(description),'') ~ '(PIX|\mRECEBIDOS\M|\mRECEBIMENTOS\M)';
$$;
REVOKE ALL ON FUNCTION public.conc_is_pix_bank(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_is_pix_bank(text) TO authenticated,service_role;
DO $ddl$
DECLARE def text;
BEGIN
 SELECT pg_get_functiondef('public.conc_auto_reconcile_impl(text)'::regprocedure) INTO def;
 IF position('description ILIKE ''%pix%''' in def)=0 THEN RAISE EXCEPTION 'PIX predicate not found'; END IF;
 EXECUTE replace(def,'description ILIKE ''%pix%''','public.conc_is_pix_bank(description)');
 SELECT pg_get_functiondef('public.conc_b2b_auto_match(text,text)'::regprocedure) INTO def;
 EXECUTE replace(def,'DEFAULT ''ZOP''::text','DEFAULT ''ZOOP''::text');
END $ddl$;
CREATE OR REPLACE FUNCTION public.conc_divergence_items(p_hotel text)
RETURNS TABLE(id uuid, side text, kind text, date date, amount numeric, title text, subtitle text, tag text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_justify_conciliacao(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem acesso ao hotel' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 SELECT o.id,'opera'::text,CASE o.base_conciliacao WHEN 'CARTAO' THEN 'cartao' WHEN 'PIX' THEN 'pix_extrato' ELSE 'dinheiro' END,o.business_date,o.amount,coalesce(o.trx_desc,o.trx_code),concat_ws(' · ',o.guest_full_name,o.room,o.receipt_no),concat_ws(' · ',o.categoria_omie,CASE WHEN o.b2b THEN 'B2B' END)
 FROM public.conc_opera_entries o WHERE o.hotel_id=p_hotel AND o.matched_at IS NULL AND NOT coalesce(o.direct_bank,false) AND o.cash_paid_at IS NULL AND o.base_conciliacao IN ('CARTAO','PIX','DINHEIRO')
 UNION ALL
 SELECT a.id,'acquirer',CASE WHEN upper(coalesce(a.categoria,'')) LIKE '%PIX%' THEN 'pix_extrato' ELSE 'cartao' END,a.sale_date,a.amount,coalesce(a.categoria,a.bandeira,'Adquirente'),concat_ws(' · ',a.modalidade,a.status,a.establishment_raw),concat_ws(' · ',a.categoria,CASE WHEN a.b2b OR a.source='b2b' THEN 'B2B' END)
 FROM public.conc_acquirer_entries a WHERE a.hotel_id=p_hotel AND a.matched_at IS NULL
 UNION ALL
 SELECT b.id,'bank',CASE WHEN public.conc_is_pix_bank(b.description) THEN 'pix_extrato' ELSE 'dinheiro' END,b.line_date,b.amount,coalesce(b.description,'Banco'),b.account_name_raw,NULL::text
 FROM public.conc_bank_entries b JOIN public.hotels h ON h.id=b.hotel_id
 WHERE b.hotel_id=p_hotel AND b.matched_at IS NULL AND NOT coalesce(b.billing_pix,false) AND b.amount>0 AND (
 public.conc_is_pix_bank(b.description) OR
 translate(upper(coalesce(b.description,'')),'ÁÀÂÃÉÊÍÓÔÕÚÇ','AAAAEEIOOOUC') ~ '\m(DEP|DN|DIN|DINHEIRO|DEPOSITOS?|DEPOSITADO)\M' OR
 (upper(coalesce(b.description,'')) ~ '\mBOLETOS?\M' AND nullif(regexp_replace(coalesce(b.cpf_cnpj,''),'[^0-9]','','g'),'') IS NOT NULL AND regexp_replace(coalesce(b.cpf_cnpj,''),'[^0-9]','','g')=regexp_replace(coalesce(h.cnpj,''),'[^0-9]','','g')));
END $$;
REVOKE ALL ON FUNCTION public.conc_divergence_items(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_divergence_items(text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.conc_notification_items(p_hotel text)
RETURNS TABLE(id uuid, side text, kind text, date date, amount numeric, title text, subtitle text, tag text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_justify_conciliacao(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem acesso ao hotel' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT * FROM public.conc_divergence_items(p_hotel);
 RETURN QUERY
 WITH base AS (
 SELECT e.*, coalesce(e.paid_date IS NOT NULL OR e.is_paid=true OR e.gg_status::text='pago',false) f_paid,
 coalesce(e.gg_status::text='nao_faturavel' OR e.is_not_billable=true,false) f_notbill,
 coalesce(e.boleto_due_date,e.estimated_due_date,
 CASE WHEN ct.term IS NOT NULL AND e.gg_confirmed_at IS NOT NULL THEN e.gg_confirmed_at::date+ct.term END,
 CASE WHEN ct.term IS NOT NULL AND e.billed_at IS NOT NULL THEN e.billed_at::date+ct.term END,
 CASE WHEN ct.term IS NOT NULL AND e.transaction_date IS NOT NULL THEN e.transaction_date+ct.term END) f_due,
 coalesce(e.gg_status::text IN ('faturado','documentos_enviados','inadimplente') OR e.billed_at IS NOT NULL OR e.invoice_file_1 IS NOT NULL OR e.invoice_file_2 IS NOT NULL,false) f_billed,
 coalesce(e.invoice_file_1 IS NULL AND e.invoice_file_2 IS NULL AND e.proof_file IS NULL AND e.billed_at IS NULL AND e.gg_confirmed_at IS NULL AND e.nota_number IS NULL AND e.boleto_number IS NULL AND e.boleto_due_date IS NULL AND e.gg_note IS NULL AND e.documents_problem_at IS NULL AND e.is_not_billable IS NOT true AND NOT coalesce(e.paid_date IS NOT NULL OR e.is_paid=true OR e.gg_status::text='pago',false) AND (e.gg_status IS NULL OR e.gg_status::text='pendente') AND coalesce(e.created_at::date,e.transaction_date)<current_date-30,false) f_stale
 FROM public.ar_to_invoice_entries e
 LEFT JOIN LATERAL (SELECT c.payment_term_days term FROM public.ar_client_contracts c WHERE c.hotel_id=e.hotel_id AND ((e.account_number IS NOT NULL AND c.account_number=e.account_number) OR (c.account_number IS NULL AND e.account_name IS NOT NULL AND lower(c.account_name)=lower(e.account_name))) ORDER BY (e.account_number IS NOT NULL AND c.account_number=e.account_number) DESC LIMIT 1) ct ON true
 WHERE e.hotel_id=p_hotel
 ) SELECT e.id,'invoice'::text,'inadimplente'::text,e.transaction_date,coalesce(e.amount,0),coalesce(e.account_name,'Faturamento'),concat_ws(' · ',e.invoice_number,e.boleto_number,CASE WHEN e.f_due IS NOT NULL THEN 'Vencimento '||to_char(e.f_due,'DD/MM/YYYY') END),NULL::text
 FROM base e WHERE NOT e.f_paid AND NOT e.f_notbill AND (e.f_stale OR (e.f_billed AND e.f_due IS NOT NULL AND e.f_due<current_date));
END $$;
REVOKE ALL ON FUNCTION public.conc_notification_items(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_notification_items(text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.conc_send_divergences_selected(p_hotel text,p_keys text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer; total_count integer; total_amount numeric; hotel_name text; body text; details text; link text; batch uuid:=gen_random_uuid(); selected jsonb; counts jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.can_access_conciliacao(auth.uid()) OR public.has_role(auth.uid(),'financeiro')) OR NOT public.can_justify_conciliacao(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem permissão para enviar divergências' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('conc-divergences:'||p_hotel));
 SELECT h.name INTO hotel_name FROM public.hotels h WHERE h.id=p_hotel;
 IF hotel_name IS NULL THEN RAISE EXCEPTION 'Hotel não encontrado'; END IF;
 WITH items AS MATERIALIZED (SELECT i.*,i.side||':'||i.id::text item_key FROM public.conc_notification_items(p_hotel) i)
 SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.kind,i.date,i.side,i.id),'[]'::jsonb) INTO selected FROM items i WHERE p_keys IS NULL OR i.item_key=ANY(p_keys);
 total_count:=jsonb_array_length(selected);
 IF p_keys IS NOT NULL AND total_count<>(SELECT count(DISTINCT k) FROM unnest(p_keys) k) THEN RAISE EXCEPTION 'Algumas pendências mudaram. Atualize a lista e selecione novamente.'; END IF;
 IF total_count=0 THEN RETURN jsonb_build_object('queued',0,'empty',true); END IF;
 IF EXISTS(SELECT 1 FROM public.notification_queue q WHERE q.event='conc_divergences_to_hotel' AND q.hotel_id=p_hotel AND q.status='pending') THEN RETURN jsonb_build_object('queued',0,'already_pending',true); END IF;
 SELECT sum((v->>'amount')::numeric),string_agg('- '||CASE v->>'kind' WHEN 'cartao' THEN 'Cartão' WHEN 'pix_extrato' THEN 'PIX' WHEN 'dinheiro' THEN 'Dinheiro' ELSE 'Faturamento inadimplente' END||' · '||(v->>'side')||' · '||coalesce(to_char((v->>'date')::date,'DD/MM/YYYY'),'Sem data')||' · '||regexp_replace(coalesce(v->>'title',''),'[\r\n]',' ','g')||' · '||regexp_replace(coalesce(v->>'subtitle',''),'[\r\n]',' ','g')||' · R$ '||replace(to_char((v->>'amount')::numeric,'FM999999999990D00'),'.',','),chr(10)) INTO total_amount,details FROM jsonb_array_elements(selected) v;
 SELECT jsonb_build_object('cartao',count(*) FILTER(WHERE v->>'kind'='cartao'),'pix',count(*) FILTER(WHERE v->>'kind'='pix_extrato'),'dinheiro',count(*) FILTER(WHERE v->>'kind'='dinheiro'),'inadimplente',count(*) FILTER(WHERE v->>'kind'='inadimplente')) INTO counts FROM jsonb_array_elements(selected) v;
 link:='/financeiro/contas-receber?aba=conciliacao&divergencias=1&hotel='||p_hotel;
 body:='**Pendências de '||hotel_name||'**'||chr(10)||chr(10)||'**Total de pendências selecionadas: '||total_count||'**'||chr(10)||'**Valor total dos lançamentos: R$ '||replace(to_char(total_amount,'FM999999999990D00'),'.',',')||'**'||chr(10)||chr(10)||details||chr(10)||chr(10)||'[Abrir pendências e registrar justificativa]('||link||')';
 n:=public.enqueue_ar_notification('conc_divergences_to_hotel',p_hotel,ARRAY['gg','adm']::public.app_role[],NULL,'Divergências e inadimplência — '||hotel_name,body,link,counts||jsonb_build_object('batch_id',batch,'total_count',total_count,'total_amount',total_amount,'selected_items',selected));
 DELETE FROM public.notification_queue q USING public.notification_queue earlier WHERE q.event='conc_divergences_to_hotel' AND q.payload->>'batch_id'=batch::text AND earlier.payload->>'batch_id'=batch::text AND q.recipient_user_id=earlier.recipient_user_id AND q.id>earlier.id;
 SELECT count(*) INTO n FROM public.notification_queue q WHERE q.payload->>'batch_id'=batch::text;
 RETURN jsonb_build_object('queued',n,'empty',false,'batch_id',batch,'total_count',total_count,'total_amount',total_amount);
END $$;
REVOKE ALL ON FUNCTION public.conc_send_divergences_selected(text,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_send_divergences_selected(text,text[]) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.conc_send_divergences(p_hotel text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT public.conc_send_divergences_selected(p_hotel,NULL); $$;
REVOKE ALL ON FUNCTION public.conc_send_divergences(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_send_divergences(text) TO authenticated,service_role;