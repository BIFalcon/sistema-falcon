CREATE OR REPLACE FUNCTION public.conc_divergence_items(p_hotel text)
RETURNS TABLE(id uuid, side text, kind text, date date, amount numeric, title text, subtitle text, tag text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_justify_conciliacao(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem acesso ao hotel' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 SELECT o.id,'opera'::text,CASE o.base_conciliacao WHEN 'CARTAO' THEN 'cartao' WHEN 'PIX' THEN 'pix_extrato' ELSE 'dinheiro' END,o.business_date,o.amount,coalesce(o.trx_desc,o.trx_code),concat_ws(' · ',o.guest_full_name,o.room,o.receipt_no),o.categoria_omie
 FROM public.conc_opera_entries o WHERE o.hotel_id=p_hotel AND o.matched_at IS NULL AND NOT coalesce(o.direct_bank,false) AND NOT coalesce(o.b2b,false) AND o.cash_paid_at IS NULL AND o.base_conciliacao IN ('CARTAO','PIX','DINHEIRO')
 UNION ALL
 SELECT a.id,'acquirer',CASE WHEN upper(coalesce(a.categoria,'')) LIKE '%PIX%' THEN 'pix_extrato' ELSE 'cartao' END,a.sale_date,a.amount,coalesce(a.categoria,a.bandeira,'Adquirente'),concat_ws(' · ',a.modalidade,a.status,a.establishment_raw),a.categoria
 FROM public.conc_acquirer_entries a WHERE a.hotel_id=p_hotel AND a.matched_at IS NULL AND NOT coalesce(a.b2b,false)
 UNION ALL
 SELECT b.id,'bank',CASE WHEN upper(coalesce(b.description,'')) LIKE '%PIX%' THEN 'pix_extrato' ELSE 'dinheiro' END,b.line_date,b.amount,coalesce(b.description,'Banco'),b.account_name_raw,NULL::text
 FROM public.conc_bank_entries b JOIN public.hotels h ON h.id=b.hotel_id
 WHERE b.hotel_id=p_hotel AND b.matched_at IS NULL AND NOT coalesce(b.billing_pix,false) AND b.amount>0 AND (
 upper(coalesce(b.description,'')) LIKE '%PIX%' OR
 translate(upper(coalesce(b.description,'')),'ÁÀÂÃÉÊÍÓÔÕÚÇ','AAAAEEIOOOUC') ~ '\m(DEP|DN|DIN|DINHEIRO|DEPOSITOS?|DEPOSITADO)\M' OR
 (upper(coalesce(b.description,'')) ~ '\mBOLETOS?\M' AND nullif(regexp_replace(coalesce(b.cpf_cnpj,''),'[^0-9]','','g'),'') IS NOT NULL AND regexp_replace(coalesce(b.cpf_cnpj,''),'[^0-9]','','g')=regexp_replace(coalesce(h.cnpj,''),'[^0-9]','','g')));
END $$;
REVOKE ALL ON FUNCTION public.conc_divergence_items(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_divergence_items(text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.conc_divergence_summary(p_hotel text DEFAULT NULL)
RETURNS TABLE(hotel_id text, hotel_name text, cartao bigint, pix bigint, dinheiro bigint, inadimplente bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h record; c record; ar record;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE='42501'; END IF;
 FOR h IN SELECT ht.id,ht.name FROM public.hotels ht WHERE (p_hotel IS NULL OR ht.id=p_hotel) AND (
 (p_hotel IS NOT NULL AND public.can_justify_conciliacao(auth.uid(),ht.id)) OR
 (p_hotel IS NULL AND (public.has_role(auth.uid(),'gg') OR public.has_role(auth.uid(),'adm')) AND EXISTS(SELECT 1 FROM public.user_hotels uh WHERE uh.user_id=auth.uid() AND uh.hotel_id=ht.id))) LOOP
 SELECT count(*) FILTER(WHERE i.kind='cartao') a,count(*) FILTER(WHERE i.kind='pix_extrato') b,count(*) FILTER(WHERE i.kind='dinheiro') c INTO c FROM public.conc_divergence_items(h.id) i;
 SELECT s.inadimplente INTO ar FROM public.ar_to_invoice_status_counts(p_hotel_id=>h.id) s;
 hotel_id:=h.id; hotel_name:=h.name; cartao:=c.a; pix:=c.b; dinheiro:=c.c; inadimplente:=coalesce(ar.inadimplente,0); RETURN NEXT;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.conc_divergence_summary(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_divergence_summary(text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.conc_send_divergences(p_hotel text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s record; n integer; link text; body text; batch uuid:=gen_random_uuid();
BEGIN
 IF auth.uid() IS NULL OR NOT (public.can_access_conciliacao(auth.uid()) OR public.has_role(auth.uid(),'financeiro')) OR NOT public.can_justify_conciliacao(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem permissão para enviar divergências' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('conc-divergences:'||p_hotel));
 SELECT * INTO s FROM public.conc_divergence_summary(p_hotel);
 IF s.hotel_id IS NULL THEN RAISE EXCEPTION 'Hotel não autorizado'; END IF;
 IF s.cartao+s.pix+s.dinheiro+s.inadimplente=0 THEN RETURN jsonb_build_object('queued',0,'empty',true); END IF;
 IF EXISTS(SELECT 1 FROM public.notification_queue q WHERE q.event='conc_divergences_to_hotel' AND q.hotel_id=p_hotel AND q.status='pending') THEN RETURN jsonb_build_object('queued',0,'already_pending',true); END IF;
 link:='/financeiro/contas-receber?aba=conciliacao&divergencias=1&hotel='||p_hotel;
 body:='**Pendências de '||s.hotel_name||'**'||chr(10)||chr(10)||'Cartão não conciliado: '||s.cartao||chr(10)||'PIX não conciliado: '||s.pix||chr(10)||'Dinheiro não conciliado: '||s.dinheiro||chr(10)||'Faturamento inadimplente: '||s.inadimplente||chr(10)||chr(10)||'[Abrir pendências e registrar justificativa]('||link||')';
 n:=public.enqueue_ar_notification('conc_divergences_to_hotel',p_hotel,ARRAY['gg','adm']::public.app_role[],NULL,'Divergências e inadimplência — '||s.hotel_name,body,link,jsonb_build_object('batch_id',batch,'cartao',s.cartao,'pix',s.pix,'dinheiro',s.dinheiro,'inadimplente',s.inadimplente));
 -- Um usuário com ambos os papéis recebe apenas uma mensagem por envio.
 DELETE FROM public.notification_queue q USING public.notification_queue earlier WHERE q.event='conc_divergences_to_hotel' AND q.payload->>'batch_id'=batch::text AND earlier.payload->>'batch_id'=batch::text AND q.recipient_user_id=earlier.recipient_user_id AND q.id>earlier.id;
 SELECT count(*) INTO n FROM public.notification_queue q WHERE q.payload->>'batch_id'=batch::text;
 RETURN jsonb_build_object('queued',n,'empty',false,'batch_id',batch);
END $$;
REVOKE ALL ON FUNCTION public.conc_send_divergences(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_send_divergences(text) TO authenticated,service_role;