ALTER TABLE public.conc_bank_entries ADD COLUMN income_auto_excluded boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.conc_is_financial_income(p_description text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$ SELECT upper(public.unaccent_safe(btrim(coalesce(p_description,'')))) ~ '^(RENDIMENTOS )?REND PAGO APLIC AUT( MAIS)?$'; $$;
REVOKE ALL ON FUNCTION public.conc_is_financial_income(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_is_financial_income(text) TO authenticated,service_role,supabase_read_only_user;
CREATE FUNCTION public.conc_income_auto_match(p_hotel text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE b record;mid uuid;actor uuid;n int:=0;BEGIN
IF auth.uid() IS NOT NULL AND (NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel)) THEN RAISE EXCEPTION 'Sem permissão';END IF;
FOR b IN SELECT * FROM public.conc_bank_entries WHERE hotel_id=p_hotel AND amount>0 AND matched_at IS NULL AND NOT income_auto_excluded AND public.conc_is_financial_income(description) ORDER BY id FOR UPDATE LOOP
actor:=coalesce(auth.uid(),(SELECT uploaded_by FROM public.conc_uploads WHERE id=b.upload_id));IF actor IS NULL THEN CONTINUE;END IF;
INSERT INTO public.conc_matches(hotel_id,kind,left_total,right_total,difference,note,matched_by) VALUES(p_hotel,'baixa_bancaria',b.amount,b.amount,0,'Receita financeira — rendimento de aplicação automática identificado no extrato; sem venda operacional',actor) RETURNING id INTO mid;
INSERT INTO public.conc_match_items(match_id,side,entry_id,amount) VALUES(mid,'bank',b.id,b.amount);
UPDATE public.conc_bank_entries SET matched_at=now() WHERE id=b.id;n:=n+1;
END LOOP;RETURN n;END $$;
REVOKE ALL ON FUNCTION public.conc_income_auto_match(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.conc_income_auto_match(text) TO service_role;
CREATE FUNCTION public.conc_exclude_income_on_undo() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN IF OLD.matched_at IS NOT NULL AND NEW.matched_at IS NULL AND public.conc_is_financial_income(OLD.description) THEN NEW.income_auto_excluded:=true; END IF; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.conc_exclude_income_on_undo() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER conc_income_undo BEFORE UPDATE OF matched_at ON public.conc_bank_entries FOR EACH ROW EXECUTE FUNCTION public.conc_exclude_income_on_undo();
CREATE OR REPLACE FUNCTION public.conc_auto_reconcile(_hotel_id text DEFAULT NULL) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE n int;h record;BEGIN
IF auth.uid() IS NULL OR NOT public.can_access_conciliacao(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão';END IF;
IF _hotel_id IS NOT NULL AND NOT public.can_view_hotel_data(auth.uid(),_hotel_id) THEN RAISE EXCEPTION 'Sem permissão';END IF;
n:=public.conc_auto_reconcile_impl(_hotel_id);
FOR h IN SELECT id FROM public.hotels WHERE (_hotel_id IS NULL OR id=_hotel_id) AND public.can_view_hotel_data(auth.uid(),id) LOOP n:=n+public.conc_boleto_auto_match_impl(h.id)+public.conc_income_auto_match(h.id); END LOOP;RETURN n;END $$;
CREATE OR REPLACE FUNCTION public.conc_guard_bank_settlement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE n int;ok boolean;BEGIN
IF NEW.amount>0 AND NEW.matched_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.matched_at IS NULL OR NEW.amount IS DISTINCT FROM OLD.amount) AND (public.conc_is_rede_bank(NEW.hotel_id,NEW.description) OR NEW.description ILIKE 'ZOOP%' OR EXISTS(SELECT 1 FROM public.conc_rede_recebidos WHERE matched_bank_id=NEW.id) OR EXISTS(SELECT 1 FROM public.conc_b2b_receipts WHERE matched_bank_id=NEW.id)) AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions WHERE source='bank' AND entry_id=NEW.id AND hotel_id=NEW.hotel_id AND undone_at IS NULL) THEN
SELECT count(*),bool_and(public.conc_batch_ready(source,entry_id)) INTO n,ok FROM public.conc_bank_batches(NEW.id);
IF n<>1 OR NOT coalesce(ok,false) THEN RAISE EXCEPTION 'Baixa bloqueada: composição comprovada e todas as vendas conciliadas no Ópera são obrigatórias';END IF;
END IF;RETURN NEW;END $$;
CREATE OR REPLACE FUNCTION public.conc_recheck_settlements(p_hotel text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE b record;BEGIN
FOR b IN SELECT be.* FROM public.conc_bank_entries be WHERE be.hotel_id=p_hotel AND be.matched_at IS NOT NULL AND (EXISTS(SELECT 1 FROM public.conc_rede_recebidos r WHERE r.matched_bank_id=be.id) OR EXISTS(SELECT 1 FROM public.conc_b2b_receipts d WHERE d.matched_bank_id=be.id)) AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions WHERE source='bank' AND entry_id=be.id AND undone_at IS NULL) AND (
(SELECT count(*) FROM public.conc_bank_batches(be.id))<>1 OR EXISTS(SELECT 1 FROM public.conc_bank_batches(be.id) x WHERE NOT public.conc_batch_ready(x.source,x.entry_id) OR round((public.conc_batch_summary(x.source,x.entry_id)->>'amount')::numeric,2)<>round(be.amount,2))) FOR UPDATE LOOP
INSERT INTO public.conc_settlement_rechecks(hotel_id,bank_id,previous_state,reason) VALUES(b.hotel_id,b.id,to_jsonb(b),'Baixa reaberta: composição alterada, ambígua ou sem prova integral');
UPDATE public.conc_bank_entries SET matched_at=NULL WHERE id=b.id;
UPDATE public.conc_rede_recebidos SET matched_bank_id=NULL,matched_at=NULL WHERE matched_bank_id=b.id;
UPDATE public.conc_b2b_receipts SET matched_at=NULL WHERE deposit_id IN(SELECT id FROM public.conc_b2b_receipts WHERE matched_bank_id=b.id);
UPDATE public.conc_b2b_receipts SET matched_bank_id=NULL,matched_at=NULL WHERE matched_bank_id=b.id;
END LOOP;END $$;
CREATE FUNCTION public.conc_recheck_composition_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE h text;BEGIN
IF pg_trigger_depth()>1 THEN RETURN NULL;END IF;
IF TG_OP<>'DELETE' THEN h:=NEW.hotel_id;PERFORM public.conc_recheck_settlements(h);END IF;
IF TG_OP<>'INSERT' AND (TG_OP='DELETE' OR OLD.hotel_id IS DISTINCT FROM NEW.hotel_id) THEN PERFORM public.conc_recheck_settlements(OLD.hotel_id);END IF;
RETURN NULL;END $$;
REVOKE ALL ON FUNCTION public.conc_recheck_composition_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER conc_rede_payment_recheck AFTER INSERT OR UPDATE OR DELETE ON public.conc_rede_pagamentos FOR EACH STATEMENT EXECUTE FUNCTION public.conc_recheck_composition_change();
