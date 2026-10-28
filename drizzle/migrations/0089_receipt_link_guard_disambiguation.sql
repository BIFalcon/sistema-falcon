CREATE OR REPLACE FUNCTION public.conc_guard_receipt_link() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE b record;v_source text;v numeric;BEGIN
IF NEW.matched_bank_id IS NULL THEN RETURN NEW;END IF;
v_source:=CASE WHEN TG_TABLE_NAME='conc_rede_recebidos' THEN 'rede' ELSE 'b2b' END;
IF TG_OP='UPDATE' AND NEW.matched_bank_id IS NOT DISTINCT FROM OLD.matched_bank_id AND NEW.hotel_id IS NOT DISTINCT FROM OLD.hotel_id THEN RETURN NEW;END IF;
IF v_source='b2b' AND (to_jsonb(NEW)->>'tipo_lancamento')<>'deposit' THEN RAISE EXCEPTION 'Somente depósito pode vincular crédito bancário';END IF;
SELECT * INTO b FROM public.conc_bank_entries WHERE id=NEW.matched_bank_id AND hotel_id=NEW.hotel_id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Banco de outro hotel ou indisponível';END IF;
IF EXISTS(SELECT 1 FROM public.conc_settlement_transitions t WHERE t.source='bank' AND t.entry_id=b.id AND t.hotel_id=b.hotel_id AND t.undone_at IS NULL) THEN RETURN NEW;END IF;
v:=CASE WHEN v_source='rede' THEN (to_jsonb(NEW)->>'valor_depositado')::numeric ELSE abs((to_jsonb(NEW)->>'valor_recebivel_liquido')::numeric) END;
IF b.amount<=0 OR round(b.amount,2) IS DISTINCT FROM round(v,2) OR NOT public.conc_batch_ready(v_source,NEW.id) OR EXISTS(SELECT 1 FROM public.conc_rede_recebidos WHERE matched_bank_id=b.id AND id<>NEW.id) OR EXISTS(SELECT 1 FROM public.conc_b2b_receipts WHERE matched_bank_id=b.id AND id<>NEW.id) THEN RAISE EXCEPTION 'Vínculo bancário não comprovado, incompleto ou já utilizado';END IF;
RETURN NEW;END $$;