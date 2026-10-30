CREATE OR REPLACE FUNCTION public.conc_affected_settlement_banks(p_hotel text,p_acquirer_ids uuid[]) RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
SELECT coalesce(array_agg(DISTINCT bank_id),'{}'::uuid[]) FROM (
 SELECT r.matched_bank_id bank_id FROM public.conc_acquirer_entries a JOIN public.conc_rede_pagamentos p ON p.hotel_id=a.hotel_id AND nullif(btrim(p.nsu_cv),'')=nullif(btrim(a.nsu),'') AND p.data_original_venda=a.sale_date AND upper(public.unaccent_safe(btrim(p.bandeira)))=upper(public.unaccent_safe(btrim(a.bandeira))) AND upper(public.unaccent_safe(btrim(p.modalidade)))=upper(public.unaccent_safe(btrim(a.modalidade))) JOIN public.conc_rede_recebidos r ON r.hotel_id=p.hotel_id AND r.data=p.data_recebimento AND upper(public.unaccent_safe(btrim(r.bandeira)))=upper(public.unaccent_safe(btrim(p.bandeira))) AND upper(public.unaccent_safe(btrim(r.modalidade)))=upper(public.unaccent_safe(btrim(p.modalidade))) WHERE a.hotel_id=p_hotel AND a.id=ANY(p_acquirer_ids) AND a.source='rede' AND a.adjusts_entry_id IS NULL AND r.matched_bank_id IS NOT NULL
 UNION ALL SELECT d.matched_bank_id FROM public.conc_b2b_receipts c JOIN public.conc_b2b_receipts d ON d.id=c.deposit_id AND d.hotel_id=c.hotel_id WHERE c.hotel_id=p_hotel AND c.matched_acquirer_id=ANY(p_acquirer_ids) AND c.tipo_lancamento='charge' AND d.matched_bank_id IS NOT NULL
) affected;
$$;
REVOKE ALL ON FUNCTION public.conc_affected_settlement_banks(text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.conc_affected_settlement_banks(text,uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.conc_recheck_bank_ids(p_hotel text,p_bank_ids uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b record; batches jsonb; summary jsonb; invalid boolean; x record; previous_defer text;
BEGIN
FOR b IN SELECT be.* FROM public.conc_bank_entries be WHERE be.hotel_id=p_hotel AND be.id=ANY(p_bank_ids) AND be.matched_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions t WHERE t.source='bank' AND t.entry_id=be.id AND t.undone_at IS NULL) ORDER BY be.id FOR UPDATE LOOP
 SELECT jsonb_agg(jsonb_build_object('source',source,'entry_id',entry_id)) INTO batches FROM public.conc_bank_batches(b.id);
 invalid:=coalesce(jsonb_array_length(batches),0)<>1;
 IF NOT invalid THEN
  FOR x IN SELECT * FROM jsonb_to_recordset(batches) AS z(source text,entry_id uuid) LOOP
   summary:=public.conc_batch_summary(x.source,x.entry_id);
   invalid:=NOT coalesce((summary->>'ready')::boolean,false) OR round((summary->>'amount')::numeric,2) IS DISTINCT FROM round(b.amount,2);
  END LOOP;
 END IF;
 IF invalid THEN
  INSERT INTO public.conc_settlement_rechecks(hotel_id,bank_id,previous_state,reason) VALUES(b.hotel_id,b.id,to_jsonb(b)||jsonb_build_object('batches',batches),'Baixa reaberta: conciliação da venda desfeita ou composição sem prova integral');
  previous_defer:=coalesce(current_setting('app.conc_undo_deferred',true),'');
  PERFORM set_config('app.conc_undo_deferred','on',true);
  UPDATE public.conc_bank_entries SET matched_at=NULL WHERE id=b.id;
  UPDATE public.conc_rede_recebidos SET matched_bank_id=NULL,matched_at=NULL WHERE hotel_id=p_hotel AND matched_bank_id=b.id;
  UPDATE public.conc_b2b_receipts SET matched_at=NULL WHERE hotel_id=p_hotel AND deposit_id IN(SELECT id FROM public.conc_b2b_receipts WHERE hotel_id=p_hotel AND matched_bank_id=b.id);
  UPDATE public.conc_b2b_receipts SET matched_bank_id=NULL,matched_at=NULL WHERE hotel_id=p_hotel AND matched_bank_id=b.id;
  PERFORM set_config('app.conc_undo_deferred',previous_defer,true);
 END IF;
END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.conc_recheck_bank_ids(text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.conc_recheck_bank_ids(text,uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.conc_recheck_after_unmatch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h text; aids uuid[]; kind text;
BEGIN
 IF current_setting('app.conc_undo_deferred',true)='on' THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='conc_match_items' THEN
  IF OLD.side='bank' THEN RETURN NULL; END IF;
  SELECT m.hotel_id,m.kind INTO h,kind FROM public.conc_matches m WHERE m.id=OLD.match_id;
  IF kind IS NOT NULL AND kind<>'cartao' THEN RETURN NULL; END IF;
  IF OLD.side='acquirer' THEN
   SELECT hotel_id INTO h FROM public.conc_acquirer_entries WHERE id=OLD.entry_id AND coalesce(categoria,'')<>'PIX';
   aids:=ARRAY[OLD.entry_id];
  ELSE
   SELECT hotel_id INTO h FROM public.conc_opera_entries WHERE id=OLD.entry_id AND base_conciliacao='CARTAO';
   SELECT array_agg(entry_id) INTO aids FROM public.conc_match_items WHERE match_id=OLD.match_id AND side='acquirer';
  END IF;
 ELSE
  IF OLD.matched_at IS NULL OR NEW.matched_at IS NOT NULL THEN RETURN NULL; END IF;
  h:=OLD.hotel_id;
  IF TG_TABLE_NAME='conc_acquirer_entries' THEN
   IF OLD.categoria='PIX' THEN RETURN NULL; END IF;
   aids:=ARRAY[OLD.id];
  ELSE
   IF OLD.base_conciliacao IS DISTINCT FROM 'CARTAO' THEN RETURN NULL; END IF;
   SELECT array_agg(DISTINCT ai.entry_id) INTO aids FROM public.conc_match_items oi JOIN public.conc_matches m ON m.id=oi.match_id AND m.kind='cartao' AND m.hotel_id=h JOIN public.conc_match_items ai ON ai.match_id=m.id AND ai.side='acquirer' WHERE oi.side='opera' AND oi.entry_id=OLD.id;
  END IF;
 END IF;
 IF h IS NOT NULL AND cardinality(aids)>0 THEN PERFORM public.conc_recheck_bank_ids(h,public.conc_affected_settlement_banks(h,aids)); END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.conc_recheck_composition_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE h text;BEGIN
IF pg_trigger_depth()>1 OR current_setting('app.conc_undo_deferred',true)='on' THEN RETURN NULL;END IF;
IF TG_OP<>'DELETE' THEN h:=NEW.hotel_id;PERFORM public.conc_recheck_settlements(h);END IF;
IF TG_OP<>'INSERT' AND (TG_OP='DELETE' OR OLD.hotel_id IS DISTINCT FROM NEW.hotel_id) THEN PERFORM public.conc_recheck_settlements(OLD.hotel_id);END IF;
RETURN NULL;END $$;

CREATE OR REPLACE FUNCTION public.conc_undo_matches(p_match_ids uuid[]) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h text; m record; ids uuid[]; items jsonb; aids uuid[]; bank_ids uuid[]; previous_defer text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_access_conciliacao(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para desfazer conciliações' USING ERRCODE='42501'; END IF;
 SELECT array_agg(DISTINCT id ORDER BY id) INTO ids FROM unnest(p_match_ids) id;
 IF coalesce(cardinality(ids),0)=0 OR cardinality(ids)>100 THEN RAISE EXCEPTION 'Selecione de 1 a 100 conciliações'; END IF;
 SELECT hotel_id INTO h FROM public.conc_matches WHERE id=ids[1];
 IF h IS NULL OR NOT public.can_view_hotel_data(auth.uid(),h) THEN RAISE EXCEPTION 'Conciliação indisponível ou sem acesso ao hotel' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('conc_undo:'||h,0));
 FOR m IN SELECT * FROM public.conc_matches WHERE id=ANY(ids) ORDER BY id FOR UPDATE LOOP
  IF m.hotel_id<>h THEN RAISE EXCEPTION 'As conciliações devem pertencer ao mesmo hotel' USING ERRCODE='42501'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM public.conc_matches WHERE id=ANY(ids))<>cardinality(ids) THEN RAISE EXCEPTION 'Conciliação já desfeita ou indisponível'; END IF;
 PERFORM 1 FROM public.conc_match_items WHERE match_id=ANY(ids) ORDER BY id FOR UPDATE;
 SELECT jsonb_agg(to_jsonb(i)) INTO items FROM public.conc_match_items i WHERE match_id=ANY(ids);
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(items) z(side text,entry_id uuid) LEFT JOIN public.conc_opera_entries o ON z.side='opera' AND o.id=z.entry_id LEFT JOIN public.conc_acquirer_entries a ON z.side='acquirer' AND a.id=z.entry_id LEFT JOIN public.conc_bank_entries b ON z.side='bank' AND b.id=z.entry_id WHERE z.side NOT IN('opera','acquirer','bank') OR coalesce(o.hotel_id,a.hotel_id,b.hotel_id,'')<>h) THEN RAISE EXCEPTION 'Vínculo inconsistente; nenhum lançamento foi alterado'; END IF;
 SELECT array_agg(DISTINCT i.entry_id) INTO aids FROM public.conc_match_items i JOIN public.conc_matches cm ON cm.id=i.match_id WHERE cm.id=ANY(ids) AND cm.kind='cartao' AND i.side='acquirer';
 bank_ids:=public.conc_affected_settlement_banks(h,aids);
 previous_defer:=coalesce(current_setting('app.conc_undo_deferred',true),'');
 PERFORM set_config('app.conc_undo_deferred','on',true);
 DELETE FROM public.conc_matches WHERE id=ANY(ids);
 UPDATE public.conc_opera_entries e SET matched_at=NULL WHERE e.hotel_id=h AND e.id IN(SELECT entry_id FROM jsonb_to_recordset(items) z(side text,entry_id uuid) WHERE side='opera') AND NOT EXISTS(SELECT 1 FROM public.conc_match_items i WHERE i.side='opera' AND i.entry_id=e.id);
 UPDATE public.conc_acquirer_entries e SET matched_at=NULL WHERE e.hotel_id=h AND e.id IN(SELECT entry_id FROM jsonb_to_recordset(items) z(side text,entry_id uuid) WHERE side='acquirer') AND NOT EXISTS(SELECT 1 FROM public.conc_match_items i WHERE i.side='acquirer' AND i.entry_id=e.id);
 UPDATE public.conc_bank_entries e SET matched_at=NULL WHERE e.hotel_id=h AND e.id IN(SELECT entry_id FROM jsonb_to_recordset(items) z(side text,entry_id uuid) WHERE side='bank') AND NOT EXISTS(SELECT 1 FROM public.conc_match_items i WHERE i.side='bank' AND i.entry_id=e.id);
 PERFORM public.conc_recheck_bank_ids(h,bank_ids);
 PERFORM set_config('app.conc_undo_deferred',previous_defer,true);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.conc_undo_matches(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_undo_matches(uuid[]) TO authenticated,service_role;
CREATE INDEX IF NOT EXISTS conc_match_items_entry_side_lookup ON public.conc_match_items(side,entry_id,match_id);
CREATE INDEX IF NOT EXISTS conc_rede_payments_undo_lookup ON public.conc_rede_pagamentos(hotel_id,nsu_cv,data_original_venda,data_recebimento);
CREATE INDEX IF NOT EXISTS conc_b2b_undo_lookup ON public.conc_b2b_receipts(hotel_id,matched_acquirer_id,deposit_id) WHERE tipo_lancamento='charge';