CREATE OR REPLACE FUNCTION public.conc_rede_auto_match(p_hotel text,p_bank_prefix text,p_brand_map jsonb,p_mod_map jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v int:=0; blocked int:=0; r record; b uuid; v_brand text; v_mod text;
BEGIN
IF NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
FOR r IN SELECT * FROM public.conc_rede_recebidos rr WHERE hotel_id=p_hotel AND matched_bank_id IS NULL AND coalesce(valor_depositado,0)>0 AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions t WHERE t.source='rede' AND t.entry_id=rr.id AND t.undone_at IS NULL) ORDER BY data,id FOR UPDATE LOOP
IF NOT public.conc_batch_ready('rede',r.id) THEN blocked:=blocked+1; CONTINUE; END IF;
v_brand:=p_brand_map->>upper(public.unaccent_safe(r.bandeira)); v_mod:=p_mod_map->>upper(public.unaccent_safe(r.modalidade)); b:=NULL;
SELECT be.id INTO b FROM public.conc_bank_entries be WHERE be.hotel_id=p_hotel AND be.matched_at IS NULL AND be.amount>0 AND round(be.amount,2)=round(r.valor_depositado,2) AND upper(btrim(be.description)) LIKE upper(p_bank_prefix)||'%' AND (v_brand IS NULL OR upper(be.description) LIKE '%'||v_brand||'%') AND (v_mod IS NULL OR upper(be.description) ~ (' ('||CASE WHEN v_mod='CD' THEN 'CD|AT' ELSE v_mod END||')[0-9]')) AND be.line_date BETWEEN r.data-1 AND r.data+3 AND (SELECT count(*) FROM public.conc_bank_batches(be.id))=1 ORDER BY abs(be.line_date-r.data),be.line_date,be.id LIMIT 1 FOR UPDATE SKIP LOCKED;
IF b IS NOT NULL THEN UPDATE public.conc_bank_entries SET matched_at=now() WHERE id=b; UPDATE public.conc_rede_recebidos SET matched_bank_id=b,matched_at=now() WHERE id=r.id; v:=v+1; END IF;
END LOOP;
RETURN jsonb_build_object('matched',v,'blocked',blocked);
END $$;
CREATE OR REPLACE FUNCTION public.conc_b2b_auto_match(p_hotel text,p_bank_prefix text DEFAULT 'ZOOP') RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_sales int:=0; v_lots int:=0; v_dep int:=0; r record; b uuid; cut date;
BEGIN
IF NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
SELECT cutoff_date INTO cut FROM public.conc_settlement_cutoffs WHERE hotel_id=p_hotel AND provider='b2b';
WITH c AS (SELECT rc.id,a.id aid FROM public.conc_b2b_receipts rc JOIN public.conc_acquirer_entries a ON a.hotel_id=rc.hotel_id AND a.source='b2b' AND btrim(a.codigo_reserva)=btrim(rc.localizador_reserva) AND round(a.amount,2)=round(rc.valor_total_transacao,2) WHERE rc.hotel_id=p_hotel AND rc.tipo_lancamento='charge' AND rc.matched_acquirer_id IS NULL AND coalesce(rc.localizador_reserva,'')<>'' AND (cut IS NULL OR a.sale_date>=cut) AND (SELECT count(*) FROM public.conc_acquirer_entries ax WHERE ax.hotel_id=rc.hotel_id AND ax.source='b2b' AND btrim(ax.codigo_reserva)=btrim(rc.localizador_reserva) AND round(ax.amount,2)=round(rc.valor_total_transacao,2) AND (cut IS NULL OR ax.sale_date>=cut))=1 AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions t WHERE t.source='b2b' AND t.entry_id=rc.id AND t.undone_at IS NULL)) UPDATE public.conc_b2b_receipts t SET matched_acquirer_id=c.aid FROM c WHERE t.id=c.id; GET DIAGNOSTICS v_sales=ROW_COUNT;
UPDATE public.conc_b2b_receipts t SET deposit_id=d.id FROM public.conc_b2b_receipts d WHERE t.hotel_id=p_hotel AND t.tipo_lancamento='charge' AND t.deposit_id IS NULL AND d.hotel_id=t.hotel_id AND d.tipo_lancamento='deposit' AND d.data_operacao=t.data_operacao AND (SELECT count(*) FROM public.conc_b2b_receipts dx WHERE dx.hotel_id=t.hotel_id AND dx.tipo_lancamento='deposit' AND dx.data_operacao=t.data_operacao)=1 AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions tr WHERE tr.source='b2b' AND tr.entry_id IN(t.id,d.id) AND tr.undone_at IS NULL); GET DIAGNOSTICS v_lots=ROW_COUNT;
FOR r IN SELECT id,data_operacao,abs(valor_recebivel_liquido) v FROM public.conc_b2b_receipts d WHERE hotel_id=p_hotel AND tipo_lancamento='deposit' AND matched_bank_id IS NULL AND valor_recebivel_liquido IS NOT NULL AND public.conc_batch_ready('b2b',d.id) AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions t WHERE t.source='b2b' AND t.entry_id=d.id AND t.undone_at IS NULL) ORDER BY data_operacao FOR UPDATE LOOP
b:=NULL; SELECT be.id INTO b FROM public.conc_bank_entries be WHERE be.hotel_id=p_hotel AND be.matched_at IS NULL AND be.amount>0 AND round(be.amount,2)=round(r.v,2) AND upper(btrim(be.description)) LIKE 'ZOOP%' AND (p_bank_prefix IS NULL OR upper(btrim(be.description)) LIKE upper(p_bank_prefix)||'%') AND be.line_date BETWEEN r.data_operacao-5 AND r.data_operacao+10 AND (SELECT count(*) FROM public.conc_bank_batches(be.id))=1 ORDER BY abs(be.line_date-r.data_operacao),be.line_date LIMIT 1 FOR UPDATE SKIP LOCKED;
IF b IS NOT NULL THEN UPDATE public.conc_bank_entries SET matched_at=now() WHERE id=b; UPDATE public.conc_b2b_receipts SET matched_bank_id=b,matched_at=now() WHERE id=r.id; UPDATE public.conc_b2b_receipts ch SET matched_at=now() WHERE deposit_id=r.id; v_dep:=v_dep+1; END IF;
END LOOP;
RETURN jsonb_build_object('sales_linked',v_sales,'lots_linked',v_lots,'deposits_matched',v_dep);
END $$;
GRANT EXECUTE ON FUNCTION public.conc_bank_batches(uuid) TO authenticated;
CREATE TABLE public.conc_settlement_rechecks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),hotel_id text NOT NULL REFERENCES public.hotels(id),bank_id uuid NOT NULL,previous_state jsonb NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.conc_settlement_rechecks TO authenticated;
GRANT ALL ON public.conc_settlement_rechecks TO service_role;
ALTER TABLE public.conc_settlement_rechecks ENABLE ROW LEVEL SECURITY;
CREATE POLICY settlement_rechecks_read ON public.conc_settlement_rechecks FOR SELECT TO authenticated USING(public.can_access_conciliacao(auth.uid()) AND public.can_view_hotel_data(auth.uid(),hotel_id));
CREATE FUNCTION public.conc_recheck_settlements(p_hotel text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b record;
BEGIN
FOR b IN SELECT be.* FROM public.conc_bank_entries be WHERE be.hotel_id=p_hotel AND be.matched_at IS NOT NULL AND (EXISTS(SELECT 1 FROM public.conc_rede_recebidos r WHERE r.matched_bank_id=be.id) OR EXISTS(SELECT 1 FROM public.conc_b2b_receipts d WHERE d.matched_bank_id=be.id)) AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions WHERE source='bank' AND entry_id=be.id AND undone_at IS NULL) AND EXISTS(SELECT 1 FROM public.conc_bank_batches(be.id) x WHERE NOT public.conc_batch_ready(x.source,x.entry_id)) FOR UPDATE LOOP
INSERT INTO public.conc_settlement_rechecks(hotel_id,bank_id,previous_state,reason) VALUES(b.hotel_id,b.id,to_jsonb(b)||jsonb_build_object('batches',(SELECT jsonb_agg(public.conc_batch_summary(source,entry_id)) FROM public.conc_bank_batches(b.id))),'Baixa reaberta: vendas sem conciliação integral no Ópera');
UPDATE public.conc_bank_entries SET matched_at=NULL WHERE id=b.id;
UPDATE public.conc_rede_recebidos SET matched_bank_id=NULL,matched_at=NULL WHERE matched_bank_id=b.id;
UPDATE public.conc_b2b_receipts SET matched_at=NULL WHERE deposit_id IN(SELECT id FROM public.conc_b2b_receipts WHERE matched_bank_id=b.id);
UPDATE public.conc_b2b_receipts SET matched_bank_id=NULL,matched_at=NULL WHERE matched_bank_id=b.id;
END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.conc_recheck_settlements(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.conc_recheck_settlements(text) TO service_role;
CREATE FUNCTION public.conc_recheck_after_unmatch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h text;
BEGIN
IF TG_TABLE_NAME='conc_match_items' THEN
IF OLD.side='bank' THEN RETURN OLD; END IF;
SELECT hotel_id INTO h FROM public.conc_matches WHERE id=OLD.match_id;
IF h IS NULL AND OLD.side='acquirer' THEN SELECT hotel_id INTO h FROM public.conc_acquirer_entries WHERE id=OLD.entry_id; ELSIF h IS NULL AND OLD.side='opera' THEN SELECT hotel_id INTO h FROM public.conc_opera_entries WHERE id=OLD.entry_id; END IF;
ELSE IF OLD.matched_at IS NULL OR NEW.matched_at IS NOT NULL THEN RETURN NEW; END IF; h:=NEW.hotel_id; END IF;
IF h IS NOT NULL THEN PERFORM public.conc_recheck_settlements(h); END IF;
RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.conc_recheck_after_unmatch() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.conc_recheck_after_unmatch() TO service_role;
CREATE TRIGGER conc_acquirer_unmatch_settlement AFTER UPDATE OF matched_at ON public.conc_acquirer_entries FOR EACH ROW EXECUTE FUNCTION public.conc_recheck_after_unmatch();
CREATE TRIGGER conc_opera_unmatch_settlement AFTER UPDATE OF matched_at ON public.conc_opera_entries FOR EACH ROW EXECUTE FUNCTION public.conc_recheck_after_unmatch();
CREATE TRIGGER conc_match_delete_settlement AFTER DELETE ON public.conc_match_items FOR EACH ROW EXECUTE FUNCTION public.conc_recheck_after_unmatch();