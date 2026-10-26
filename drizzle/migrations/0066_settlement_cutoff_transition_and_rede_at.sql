CREATE TABLE public.conc_settlement_cutoffs (hotel_id text NOT NULL REFERENCES public.hotels(id), provider text NOT NULL CHECK(provider IN ('rede','b2b')), cutoff_date date NOT NULL, updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(hotel_id,provider));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.conc_settlement_cutoffs TO authenticated;
GRANT ALL ON public.conc_settlement_cutoffs TO service_role;
ALTER TABLE public.conc_settlement_cutoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY settlement_cutoff_access ON public.conc_settlement_cutoffs FOR ALL TO authenticated USING(public.can_access_conciliacao(auth.uid()) AND public.can_view_hotel_data(auth.uid(),hotel_id)) WITH CHECK(public.can_access_conciliacao(auth.uid()) AND public.can_view_hotel_data(auth.uid(),hotel_id) AND updated_by=auth.uid());
CREATE TABLE public.conc_settlement_transitions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id text NOT NULL REFERENCES public.hotels(id), provider text NOT NULL CHECK(provider IN ('rede','b2b')), source text NOT NULL CHECK(source IN ('bank','rede','b2b')), entry_id uuid NOT NULL, cutoff_date date NOT NULL, amount numeric NOT NULL, note text NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), undone_by uuid, undone_at timestamptz);
CREATE UNIQUE INDEX settlement_transition_active ON public.conc_settlement_transitions(source,entry_id) WHERE undone_at IS NULL;
GRANT SELECT ON public.conc_settlement_transitions TO authenticated;
GRANT ALL ON public.conc_settlement_transitions TO service_role;
ALTER TABLE public.conc_settlement_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY settlement_transition_read ON public.conc_settlement_transitions FOR SELECT TO authenticated USING(public.can_access_conciliacao(auth.uid()) AND public.can_view_hotel_data(auth.uid(),hotel_id));
CREATE OR REPLACE FUNCTION public.conc_settlement_items(p_hotel text,p_provider text) RETURNS TABLE(source text,entry_id uuid,item_date date,original_date date,label text,amount numeric,eligibility text,transition_id uuid) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
 RETURN QUERY WITH items AS (
 SELECT 'bank'::text src,b.id eid,b.line_date dt,NULL::date orig,b.description lbl,b.amount val,'sem_origem'::text eligible FROM public.conc_bank_entries b WHERE b.hotel_id=p_hotel AND b.amount>0 AND ((p_provider='rede' AND upper(btrim(b.description)) LIKE 'RECEBIMENTO REDE%') OR (p_provider='b2b' AND upper(btrim(b.description)) LIKE 'ZOOP%')) AND (b.matched_at IS NULL OR EXISTS(SELECT 1 FROM public.conc_settlement_transitions t WHERE t.source='bank' AND t.entry_id=b.id AND t.undone_at IS NULL))
 UNION ALL
 SELECT 'rede',r.id,r.data,ps.first_sale,concat_ws(' · ',r.bandeira,r.modalidade),r.valor_depositado,
 CASE WHEN ps.current_count>0 THEN 'atual' WHEN ps.unknown_count>0 OR ps.first_sale IS NULL THEN 'sem_origem' WHEN ps.last_sale<c.cutoff_date THEN 'anterior' ELSE 'atual' END
 FROM public.conc_rede_recebidos r LEFT JOIN public.conc_settlement_cutoffs c ON c.hotel_id=r.hotel_id AND c.provider='rede'
 LEFT JOIN LATERAL (SELECT min(p.data_original_venda) first_sale,max(p.data_original_venda) last_sale,count(*) FILTER(WHERE p.data_original_venda>=c.cutoff_date) current_count,count(*) FILTER(WHERE p.data_original_venda IS NULL) unknown_count FROM public.conc_rede_pagamentos p WHERE p.hotel_id=r.hotel_id AND p.data_recebimento=r.data AND upper(public.unaccent_safe(p.bandeira))=upper(public.unaccent_safe(r.bandeira)) AND upper(public.unaccent_safe(p.modalidade))=upper(public.unaccent_safe(r.modalidade))) ps ON true
 WHERE p_provider='rede' AND r.hotel_id=p_hotel AND r.valor_depositado>0 AND r.matched_bank_id IS NULL
 UNION ALL
 SELECT 'b2b',r.id,r.data_operacao,coalesce(a.sale_date,r.data_transacao),concat_ws(' · ',r.tipo_lancamento,r.localizador_reserva,r.descricao),abs(coalesce(r.valor_recebivel_liquido,0)),
 CASE WHEN coalesce(a.sale_date,r.data_transacao) IS NULL THEN 'sem_origem' WHEN coalesce(a.sale_date,r.data_transacao)<c.cutoff_date THEN 'anterior' ELSE 'atual' END
 FROM public.conc_b2b_receipts r LEFT JOIN public.conc_acquirer_entries a ON a.id=r.matched_acquirer_id LEFT JOIN public.conc_settlement_cutoffs c ON c.hotel_id=r.hotel_id AND c.provider='b2b'
 WHERE p_provider='b2b' AND r.hotel_id=p_hotel AND r.matched_at IS NULL AND (r.tipo_lancamento='charge' OR (r.tipo_lancamento='deposit' AND NOT EXISTS(SELECT 1 FROM public.conc_b2b_receipts ch WHERE ch.deposit_id=r.id)))
 ) SELECT i.src,i.eid,i.dt,i.orig,i.lbl,i.val,i.eligible,t.id FROM items i LEFT JOIN public.conc_settlement_transitions t ON t.source=i.src AND t.entry_id=i.eid AND t.undone_at IS NULL ORDER BY i.dt,i.eid;
END $$;
REVOKE ALL ON FUNCTION public.conc_settlement_items(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_settlement_items(text,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.conc_settlement_transition(p_hotel text,p_provider text,p_items jsonb,p_note text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cut date; i record; candidate record; n int:=0;
BEGIN
 IF NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
 SELECT cutoff_date INTO cut FROM public.conc_settlement_cutoffs WHERE hotel_id=p_hotel AND provider=p_provider FOR UPDATE;
 IF cut IS NULL THEN RAISE EXCEPTION 'Informe a data de corte'; END IF;
 IF length(btrim(p_note))<10 THEN RAISE EXCEPTION 'Informe uma justificativa de pelo menos 10 caracteres'; END IF;
 IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 OR jsonb_array_length(p_items)>500 THEN RAISE EXCEPTION 'Seleção inválida'; END IF;
 FOR i IN SELECT * FROM jsonb_to_recordset(p_items) AS x(source text,entry_id uuid) LOOP
  IF i.source='bank' THEN PERFORM 1 FROM public.conc_bank_entries WHERE id=i.entry_id AND hotel_id=p_hotel AND matched_at IS NULL FOR UPDATE;
  ELSIF i.source='rede' THEN PERFORM 1 FROM public.conc_rede_recebidos WHERE id=i.entry_id AND hotel_id=p_hotel AND matched_bank_id IS NULL FOR UPDATE;
  ELSIF i.source='b2b' THEN PERFORM 1 FROM public.conc_b2b_receipts WHERE id=i.entry_id AND hotel_id=p_hotel AND matched_at IS NULL FOR UPDATE;
  ELSE RAISE EXCEPTION 'Origem inválida'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item indisponível'; END IF;
  SELECT * INTO candidate FROM public.conc_settlement_items(p_hotel,p_provider) x WHERE x.source=i.source AND x.entry_id=i.entry_id AND x.transition_id IS NULL;
  IF NOT FOUND OR candidate.eligibility NOT IN ('anterior','sem_origem') THEN RAISE EXCEPTION 'Venda a partir do corte não pode receber baixa de transição'; END IF;
  INSERT INTO public.conc_settlement_transitions(hotel_id,provider,source,entry_id,cutoff_date,amount,note,created_by) VALUES(p_hotel,p_provider,i.source,i.entry_id,cut,candidate.amount,btrim(p_note),auth.uid());
  IF i.source='bank' THEN
   UPDATE public.conc_bank_entries SET matched_at=now() WHERE id=i.entry_id;
   UPDATE public.conc_matches SET note='Baixa de transição — '||btrim(p_note) WHERE kind='baixa_bancaria' AND id IN(SELECT match_id FROM public.conc_match_items WHERE side='bank' AND entry_id=i.entry_id);
  END IF;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.conc_settlement_transition(text,text,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_settlement_transition(text,text,jsonb,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.conc_settlement_transition_undo(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t public.conc_settlement_transitions;
BEGIN
 SELECT * INTO t FROM public.conc_settlement_transitions WHERE id=p_id AND undone_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),t.hotel_id) THEN RAISE EXCEPTION 'Sem permissão ou transição indisponível'; END IF;
 IF t.source='bank' THEN UPDATE public.conc_bank_entries SET matched_at=NULL WHERE id=t.entry_id; END IF;
 UPDATE public.conc_settlement_transitions SET undone_by=auth.uid(),undone_at=now() WHERE id=t.id;
END $$;
REVOKE ALL ON FUNCTION public.conc_settlement_transition_undo(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_settlement_transition_undo(uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.conc_rede_auto_match(p_hotel text,p_bank_prefix text,p_brand_map jsonb,p_mod_map jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v int:=0; r record; b uuid; v_brand text; v_mod text;
BEGIN
 IF NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
 FOR r IN SELECT * FROM public.conc_rede_recebidos rr WHERE hotel_id=p_hotel AND matched_bank_id IS NULL AND coalesce(valor_depositado,0)>0 AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions t WHERE t.source='rede' AND t.entry_id=rr.id AND t.undone_at IS NULL) ORDER BY data,id FOR UPDATE LOOP
  v_brand:=p_brand_map->>upper(public.unaccent_safe(r.bandeira)); v_mod:=p_mod_map->>upper(public.unaccent_safe(r.modalidade)); b:=NULL;
  SELECT be.id INTO b FROM public.conc_bank_entries be WHERE be.hotel_id=p_hotel AND be.matched_at IS NULL AND be.amount>0 AND round(be.amount,2)=round(r.valor_depositado,2) AND upper(btrim(be.description)) LIKE upper(p_bank_prefix)||'%' AND (v_brand IS NULL OR upper(be.description) LIKE '%'||v_brand||'%') AND (v_mod IS NULL OR upper(be.description) ~ (' ('||CASE WHEN v_mod='CD' THEN 'CD|AT' ELSE v_mod END||')[0-9]')) AND be.line_date BETWEEN r.data-1 AND r.data+3 ORDER BY abs(be.line_date-r.data),be.line_date,be.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF b IS NOT NULL THEN UPDATE public.conc_bank_entries SET matched_at=now() WHERE id=b; UPDATE public.conc_rede_recebidos SET matched_bank_id=b,matched_at=now() WHERE id=r.id; v:=v+1; END IF;
 END LOOP;
 RETURN jsonb_build_object('matched',v);
END $$;
CREATE OR REPLACE FUNCTION public.conc_b2b_auto_match(p_hotel text,p_bank_prefix text DEFAULT 'ZOOP') RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_sales int:=0; v_lots int:=0; v_dep int:=0; r record; b uuid; cut date;
BEGIN
 IF NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
 SELECT cutoff_date INTO cut FROM public.conc_settlement_cutoffs WHERE hotel_id=p_hotel AND provider='b2b';
 WITH c AS (SELECT DISTINCT ON(rc.id) rc.id,a.id aid FROM public.conc_b2b_receipts rc JOIN public.conc_acquirer_entries a ON a.hotel_id=rc.hotel_id AND a.source='b2b' AND btrim(a.codigo_reserva)=btrim(rc.localizador_reserva) WHERE rc.hotel_id=p_hotel AND rc.tipo_lancamento='charge' AND rc.matched_acquirer_id IS NULL AND coalesce(rc.localizador_reserva,'')<>'' AND (cut IS NULL OR a.sale_date>=cut) AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions t WHERE t.source='b2b' AND t.entry_id=rc.id AND t.undone_at IS NULL) ORDER BY rc.id,(a.amount=rc.valor_total_transacao) DESC,a.sale_date)
 UPDATE public.conc_b2b_receipts t SET matched_acquirer_id=c.aid FROM c WHERE t.id=c.id; GET DIAGNOSTICS v_sales=ROW_COUNT;
 UPDATE public.conc_b2b_receipts t SET deposit_id=d.id FROM public.conc_b2b_receipts d WHERE t.hotel_id=p_hotel AND t.tipo_lancamento='charge' AND t.deposit_id IS NULL AND d.hotel_id=t.hotel_id AND d.tipo_lancamento='deposit' AND d.data_operacao=t.data_operacao AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions tr WHERE tr.source='b2b' AND tr.entry_id IN(t.id,d.id) AND tr.undone_at IS NULL); GET DIAGNOSTICS v_lots=ROW_COUNT;
 FOR r IN SELECT id,data_operacao,abs(valor_recebivel_liquido) v FROM public.conc_b2b_receipts d WHERE hotel_id=p_hotel AND tipo_lancamento='deposit' AND matched_bank_id IS NULL AND valor_recebivel_liquido IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions t WHERE t.source='b2b' AND t.entry_id=d.id AND t.undone_at IS NULL) ORDER BY data_operacao FOR UPDATE LOOP
  b:=NULL; SELECT be.id INTO b FROM public.conc_bank_entries be WHERE be.hotel_id=p_hotel AND be.matched_at IS NULL AND be.amount>0 AND round(be.amount,2)=round(r.v,2) AND (p_bank_prefix IS NULL OR upper(btrim(be.description)) LIKE upper(p_bank_prefix)||'%') AND be.line_date BETWEEN r.data_operacao-5 AND r.data_operacao+10 ORDER BY abs(be.line_date-r.data_operacao),be.line_date LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF b IS NOT NULL THEN UPDATE public.conc_bank_entries SET matched_at=now() WHERE id=b; UPDATE public.conc_b2b_receipts SET matched_bank_id=b,matched_at=now() WHERE id=r.id; UPDATE public.conc_b2b_receipts ch SET matched_at=now() WHERE deposit_id=r.id AND matched_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions t WHERE t.source='b2b' AND t.entry_id=ch.id AND t.undone_at IS NULL); v_dep:=v_dep+1; END IF;
 END LOOP;
 RETURN jsonb_build_object('sales_linked',v_sales,'lots_linked',v_lots,'deposits_matched',v_dep);
END $$;