CREATE OR REPLACE FUNCTION public.conc_auto_allocate_rede_routine(p_receipt uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE r record; alloc jsonb; liquid numeric; gap numeric; routine numeric; has_other boolean;
BEGIN
  SELECT * INTO r FROM public.conc_rede_recebidos WHERE id=p_receipt AND matched_bank_id IS NULL;
  IF NOT FOUND OR coalesce(r.valor_depositado,0)<=0 THEN RETURN false; END IF;
  -- twin batches need individual proof
  IF (SELECT count(*) FROM public.conc_rede_recebidos x WHERE x.hotel_id=r.hotel_id AND x.data=r.data
      AND upper(public.unaccent_safe(x.bandeira))=upper(public.unaccent_safe(r.bandeira))
      AND upper(public.unaccent_safe(x.modalidade))=upper(public.unaccent_safe(r.modalidade)))<>1 THEN RETURN false; END IF;
  alloc := public.conc_rede_deduction_allocation(p_receipt);
  SELECT sum(net) INTO liquid FROM public.conc_batch_rows('rede',p_receipt);
  IF liquid IS NULL THEN RETURN false; END IF;
  gap := round(liquid - coalesce((alloc->>'deduction_total')::numeric,0) - r.valor_depositado,2);
  IF gap<=0 THEN RETURN false; END IF;
  SELECT coalesce(sum((v->>'amount')::numeric),0),
         bool_or(NOT (v->>'kind'='ajuste' AND upper(public.unaccent_safe(v->>'label')) ~ '(ANTECIPA|ALUGUEL|POS|EQUIPAMENTO|MENSALIDADE|TARIFA)'))
    INTO routine, has_other
  FROM jsonb_array_elements(alloc->'candidates') v
  WHERE NOT (v->>'allocated')::boolean
    AND v->>'kind'='ajuste' AND upper(public.unaccent_safe(v->>'label')) ~ '(ANTECIPA|ALUGUEL|POS|EQUIPAMENTO|MENSALIDADE|TARIFA)';
  IF round(routine,2)<>gap THEN RETURN false; END IF;
  INSERT INTO public.conc_rede_deduction_links(hotel_id,receipt_id,component_id,kind,amount,note,created_by)
  SELECT r.hotel_id,p_receipt,(v->>'id')::uuid,'ajuste',(v->>'amount')::numeric,
         'Alocação automática: '||coalesce(v->>'label','ajuste de rotina Rede'),
         coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid)
  FROM jsonb_array_elements(alloc->'candidates') v
  WHERE NOT (v->>'allocated')::boolean
    AND v->>'kind'='ajuste' AND upper(public.unaccent_safe(v->>'label')) ~ '(ANTECIPA|ALUGUEL|POS|EQUIPAMENTO|MENSALIDADE|TARIFA)';
  RETURN true;
END $function$;
REVOKE ALL ON FUNCTION public.conc_auto_allocate_rede_routine(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.conc_rede_match_proven(p_hotel text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ DECLARE v int:=0;blocked int:=0;auto_alloc int:=0;r record;b uuid;candidates uuid[];BEGIN
IF auth.uid() IS NOT NULL AND (NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel)) THEN RAISE EXCEPTION 'Sem permissão';END IF;
PERFORM pg_advisory_xact_lock(hashtext('settlement:'||p_hotel));
FOR r IN SELECT * FROM public.conc_rede_recebidos rr WHERE hotel_id=p_hotel AND matched_bank_id IS NULL AND coalesce(valor_depositado,0)>0 AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions t WHERE t.source='rede' AND t.entry_id=rr.id AND t.undone_at IS NULL) ORDER BY data,id FOR UPDATE LOOP
IF NOT public.conc_batch_ready('rede',r.id) THEN
  IF public.conc_auto_allocate_rede_routine(r.id) THEN auto_alloc:=auto_alloc+1; END IF;
  IF NOT public.conc_batch_ready('rede',r.id) THEN blocked:=blocked+1;CONTINUE;END IF;
END IF;
SELECT array_agg(be.id) INTO candidates FROM public.conc_bank_entries be WHERE be.hotel_id=p_hotel AND be.matched_at IS NULL AND be.amount>0 AND be.line_date BETWEEN r.data-1 AND r.data+3 AND round(be.amount,2)=round(r.valor_depositado,2) AND EXISTS(SELECT 1 FROM public.conc_bank_batches(be.id) c WHERE c.source='rede' AND c.entry_id=r.id) AND (SELECT count(*) FROM public.conc_bank_batches(be.id))=1;
IF cardinality(candidates)=1 THEN b:=candidates[1];PERFORM 1 FROM public.conc_bank_entries WHERE id=b AND matched_at IS NULL FOR UPDATE;IF FOUND THEN UPDATE public.conc_bank_entries SET matched_at=now() WHERE id=b;UPDATE public.conc_rede_recebidos SET matched_bank_id=b,matched_at=now() WHERE id=r.id;v:=v+1;END IF;ELSE blocked:=blocked+1;END IF;
END LOOP;RETURN jsonb_build_object('matched',v,'blocked',blocked,'auto_allocated',auto_alloc);END $function$;