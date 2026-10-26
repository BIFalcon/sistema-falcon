-- Transactional integration test: fixtures are removed; failures roll back the entire block.
DO $$
DECLARE aid uuid:=gen_random_uuid(); aid2 uuid:=gen_random_uuid(); bid uuid:=gen_random_uuid(); fid uuid:=gen_random_uuid(); fid2 uuid:=gen_random_uuid(); au uuid; bu uuid; h text:='ibis-serra-talhada'; n int;
BEGIN
 SELECT upload_id INTO au FROM public.ar_to_invoice_entries WHERE hotel_id=h LIMIT 1;
 SELECT id INTO bu FROM public.conc_uploads WHERE hotel_id=h AND kind='bank' AND uploaded_by IS NOT NULL LIMIT 1;
 IF au IS NULL OR bu IS NULL THEN RAISE EXCEPTION 'Required integration fixture source missing'; END IF;
 INSERT INTO public.ar_to_invoice_entries(id,upload_id,hotel_id,property_name_raw,entry_key,amount,francesinha_status)
 VALUES(aid,au,h,'TEST BOLETO',aid::text,253.26,'liquidado'),(aid2,au,h,'TEST BOLETO',aid2::text,1666.14,'liquidado');
 INSERT INTO public.conc_bank_entries(id,hotel_id,upload_id,entry_key,line_date,description,amount)
 VALUES(bid,h,bu,bid::text,'2099-01-04','BOLETOS RECEBIDOS 01/01S',1919.40);
 INSERT INTO public.conc_francesinha_entries(id,hotel_id,entry_key,data_movimento,valor_inicial,valor_final,acao,matched_ar_id)
 VALUES(fid,h,fid::text,'2099-01-01',253.26,253.26,'liquidacao',aid),
 (fid2,h,fid2::text,'2099-01-01',1666.14,1666.14,'liquidacao',NULL);
 PERFORM public.conc_boleto_auto_match_impl(h);
 IF EXISTS(SELECT 1 FROM public.conc_bank_entries WHERE id=bid AND matched_at IS NOT NULL) THEN RAISE EXCEPTION 'Incomplete batch was settled'; END IF;
 IF EXISTS(SELECT 1 FROM public.ar_to_invoice_entries WHERE id=aid AND is_paid) THEN RAISE EXCEPTION 'Invoice paid before bank validation'; END IF;
 UPDATE public.conc_francesinha_entries SET matched_ar_id=aid2 WHERE id=fid2;
 PERFORM public.conc_boleto_auto_match_impl(h);
 SELECT count(*) INTO n FROM public.ar_to_invoice_entries WHERE id IN(aid,aid2) AND is_paid AND gg_status='pago' AND paid_date='2099-01-04';
 IF n<>2 THEN RAISE EXCEPTION 'Payment must use the bank credit date, not movement date'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.conc_pendencias WHERE entry_id=bid AND status='revertida' AND match_id IS NOT NULL) THEN RAISE EXCEPTION 'Transit pending was not reverted'; END IF;
 IF (SELECT count(*) FROM public.conc_francesinha_entries WHERE id IN(fid,fid2) AND matched_bank_id=bid)<>2 THEN RAISE EXCEPTION 'N:1 lineage missing'; END IF;
 DELETE FROM public.conc_matches WHERE kind='baixa_bancaria' AND id IN(SELECT match_id FROM public.conc_match_items WHERE side='bank' AND entry_id=bid);
 DELETE FROM public.conc_francesinha_entries WHERE id IN(fid,fid2);
 DELETE FROM public.conc_bank_entries WHERE id=bid;
 DELETE FROM public.ar_to_invoice_entries WHERE id IN(aid,aid2);
END $$;