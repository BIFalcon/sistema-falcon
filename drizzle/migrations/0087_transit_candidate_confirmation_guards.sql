CREATE FUNCTION public.conc_confirm_transit_candidates(p_hotel text,p_bank uuid,p_opera uuid[],p_note text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE b record;o record;n int:=0;total numeric:=0;typ text;mid uuid;BEGIN
IF auth.uid() IS NULL OR NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem permissão';END IF;
IF cardinality(p_opera) IS NULL OR cardinality(p_opera)=0 OR length(btrim(coalesce(p_note,'')))<10 THEN RAISE EXCEPTION 'Selecione recebimentos e justifique a conciliação';END IF;
PERFORM pg_advisory_xact_lock(hashtext('settlement:'||p_hotel));
SELECT * INTO b FROM public.conc_bank_entries WHERE id=p_bank AND hotel_id=p_hotel AND matched_at IS NULL AND amount>0 FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Crédito indisponível';END IF;
typ:=CASE WHEN public.conc_is_pix_bank(b.description) AND NOT b.billing_pix AND NOT public.conc_is_rede_bank(p_hotel,b.description) THEN 'PIX' WHEN upper(public.unaccent_safe(b.description)) ~ '\m(DEP|DN|DIN|DINHEIRO|DEPOSITO)\M' THEN 'DINHEIRO' ELSE NULL END;
IF typ IS NULL THEN RAISE EXCEPTION 'Crédito não elegível para conciliação operacional';END IF;
FOR o IN SELECT * FROM public.conc_opera_entries WHERE id=ANY(p_opera) AND hotel_id=p_hotel AND matched_at IS NULL AND base_conciliacao=typ AND NOT direct_bank AND business_date BETWEEN b.line_date-1 AND b.line_date+1 FOR UPDATE LOOP n:=n+1;total:=total+o.amount;END LOOP;
IF n<>cardinality(p_opera) OR round(total,2)<>round(b.amount,2) THEN RAISE EXCEPTION 'Recebimentos inválidos, já conciliados ou soma diferente do crédito';END IF;
INSERT INTO public.conc_matches(hotel_id,kind,left_total,right_total,difference,note,matched_by) VALUES(p_hotel,CASE WHEN typ='PIX' THEN 'pix_extrato' ELSE 'dinheiro' END,total,b.amount,0,'Conferência explícita da transitória D−1/D+1 — '||btrim(p_note),auth.uid()) RETURNING id INTO mid;
INSERT INTO public.conc_match_items(match_id,side,entry_id,amount) SELECT mid,'opera',id,amount FROM public.conc_opera_entries WHERE id=ANY(p_opera) AND hotel_id=p_hotel;
INSERT INTO public.conc_match_items(match_id,side,entry_id,amount) VALUES(mid,'bank',b.id,b.amount);
UPDATE public.conc_opera_entries SET matched_at=now() WHERE id=ANY(p_opera) AND hotel_id=p_hotel;
UPDATE public.conc_bank_entries SET matched_at=now() WHERE id=b.id;
RETURN mid;END $$;
REVOKE ALL ON FUNCTION public.conc_confirm_transit_candidates(text,uuid,uuid[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_confirm_transit_candidates(text,uuid,uuid[],text) TO authenticated,service_role;
CREATE FUNCTION public.conc_guard_settled_bank_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
IF OLD.matched_at IS NOT NULL AND (NEW.hotel_id IS DISTINCT FROM OLD.hotel_id OR NEW.line_date IS DISTINCT FROM OLD.line_date OR NEW.description IS DISTINCT FROM OLD.description OR NEW.amount IS DISTINCT FROM OLD.amount) THEN RAISE EXCEPTION 'Desfaça a baixa antes de alterar a identificação ou o valor bancário';END IF;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION public.conc_guard_settled_bank_identity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER conc_settled_identity_guard BEFORE UPDATE OF hotel_id,line_date,description,amount ON public.conc_bank_entries FOR EACH ROW EXECUTE FUNCTION public.conc_guard_settled_bank_identity();