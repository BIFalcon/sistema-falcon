CREATE FUNCTION public.conc_rede_match_proven(p_hotel text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE v int:=0;blocked int:=0;r record;b uuid;candidates uuid[];BEGIN
IF auth.uid() IS NOT NULL AND (NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel)) THEN RAISE EXCEPTION 'Sem permissão';END IF;
PERFORM pg_advisory_xact_lock(hashtext('settlement:'||p_hotel));
FOR r IN SELECT * FROM public.conc_rede_recebidos rr WHERE hotel_id=p_hotel AND matched_bank_id IS NULL AND coalesce(valor_depositado,0)>0 AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions t WHERE t.source='rede' AND t.entry_id=rr.id AND t.undone_at IS NULL) ORDER BY data,id FOR UPDATE LOOP
IF NOT public.conc_batch_ready('rede',r.id) THEN blocked:=blocked+1;CONTINUE;END IF;
SELECT array_agg(be.id) INTO candidates FROM public.conc_bank_entries be WHERE be.hotel_id=p_hotel AND be.matched_at IS NULL AND be.amount>0 AND EXISTS(SELECT 1 FROM public.conc_bank_batches(be.id) c WHERE c.source='rede' AND c.entry_id=r.id) AND (SELECT count(*) FROM public.conc_bank_batches(be.id))=1;
IF cardinality(candidates)=1 THEN b:=candidates[1];PERFORM 1 FROM public.conc_bank_entries WHERE id=b AND matched_at IS NULL FOR UPDATE;IF FOUND THEN UPDATE public.conc_bank_entries SET matched_at=now() WHERE id=b;UPDATE public.conc_rede_recebidos SET matched_bank_id=b,matched_at=now() WHERE id=r.id;v:=v+1;END IF;ELSE blocked:=blocked+1;END IF;
END LOOP;RETURN jsonb_build_object('matched',v,'blocked',blocked);END $$;
REVOKE ALL ON FUNCTION public.conc_rede_match_proven(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.conc_rede_match_proven(text) TO service_role;
CREATE OR REPLACE FUNCTION public.conc_rede_auto_match(p_hotel text,p_bank_prefix text,p_brand_map jsonb,p_mod_map jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN IF auth.uid() IS NULL OR NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem permissão';END IF;RETURN public.conc_rede_match_proven(p_hotel);END $$;
CREATE FUNCTION public.conc_guard_receipt_link() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE b record;source text;v numeric;ok boolean;BEGIN
IF NEW.matched_bank_id IS NULL THEN RETURN NEW;END IF;
source:=CASE WHEN TG_TABLE_NAME='conc_rede_recebidos' THEN 'rede' ELSE 'b2b' END;
IF TG_OP='UPDATE' AND NEW.matched_bank_id IS NOT DISTINCT FROM OLD.matched_bank_id AND NEW.hotel_id IS NOT DISTINCT FROM OLD.hotel_id THEN RETURN NEW;END IF;
IF source='b2b' AND NEW.tipo_lancamento<>'deposit' THEN RAISE EXCEPTION 'Somente depósito pode vincular crédito bancário';END IF;
SELECT * INTO b FROM public.conc_bank_entries WHERE id=NEW.matched_bank_id AND hotel_id=NEW.hotel_id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Banco de outro hotel ou indisponível';END IF;
IF EXISTS(SELECT 1 FROM public.conc_settlement_transitions WHERE source='bank' AND entry_id=b.id AND hotel_id=b.hotel_id AND undone_at IS NULL) THEN RETURN NEW;END IF;
v:=CASE WHEN source='rede' THEN (to_jsonb(NEW)->>'valor_depositado')::numeric ELSE abs((to_jsonb(NEW)->>'valor_recebivel_liquido')::numeric) END;
IF b.amount<=0 OR round(b.amount,2) IS DISTINCT FROM round(v,2) OR NOT public.conc_batch_ready(source,NEW.id) OR EXISTS(SELECT 1 FROM public.conc_rede_recebidos WHERE matched_bank_id=b.id AND id<>NEW.id) OR EXISTS(SELECT 1 FROM public.conc_b2b_receipts WHERE matched_bank_id=b.id AND id<>NEW.id) THEN RAISE EXCEPTION 'Vínculo bancário não comprovado, incompleto ou já utilizado';END IF;
RETURN NEW;END $$;
REVOKE ALL ON FUNCTION public.conc_guard_receipt_link() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER conc_rede_link_guard BEFORE INSERT OR UPDATE OF matched_bank_id,hotel_id ON public.conc_rede_recebidos FOR EACH ROW EXECUTE FUNCTION public.conc_guard_receipt_link();
CREATE TRIGGER conc_b2b_link_guard BEFORE INSERT OR UPDATE OF matched_bank_id,hotel_id ON public.conc_b2b_receipts FOR EACH ROW EXECUTE FUNCTION public.conc_guard_receipt_link();