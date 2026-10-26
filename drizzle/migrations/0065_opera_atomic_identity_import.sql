CREATE OR REPLACE FUNCTION public.conc_import_opera(_hotel_id text, _upload_id uuid, _rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE r jsonb; target public.conc_opera_entries%ROWTYPE; t text; key text; legacy_key text; candidate_count integer; incoming_count integer; inserted_count integer := 0; duplicate_count integer := 0; updated_count integer := 0;
BEGIN
  IF NOT public.can_access_conciliacao(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para importar Opera'; END IF;
  IF jsonb_typeof(_rows) <> 'array' THEN RAISE EXCEPTION 'Relatório Opera inválido'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('opera-import:' || _hotel_id, 0));
  IF NOT EXISTS (SELECT 1 FROM public.conc_uploads WHERE id=_upload_id AND hotel_id=_hotel_id AND kind='opera' AND uploaded_by=auth.uid()) THEN RAISE EXCEPTION 'Importação inválida'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    t := nullif(btrim(r->>'trx_no'),'');
    legacy_key := coalesce(r->>'legacy_entry_key',r->>'entry_key');
    key := CASE WHEN t IS NOT NULL THEN _hotel_id || '|opera|trx|' || t ELSE r->>'entry_key' END;
    target := NULL;
    SELECT e.* INTO target FROM public.conc_opera_entries e WHERE e.hotel_id=_hotel_id AND ((t IS NOT NULL AND e.trx_no=t) OR e.entry_key=key OR (e.entry_key=legacy_key AND (nullif(e.trx_no,'') IS NULL OR e.trx_no=t))) ORDER BY (e.trx_no=t) DESC NULLS LAST LIMIT 1 FOR UPDATE;
    IF target.id IS NOT NULL THEN
      IF target.trx_code IS DISTINCT FROM r->>'trx_code' OR target.business_date IS DISTINCT FROM nullif(r->>'business_date','')::date OR target.amount IS DISTINCT FROM (r->>'amount')::numeric THEN RAISE EXCEPTION 'A transação Opera % mudou de data, código ou valor. Confira o relatório antes de importar.',t; END IF;
      IF t IS NOT NULL AND nullif(target.trx_no,'') IS NULL THEN
        UPDATE public.conc_opera_entries SET trx_no=t,entry_key=key,guest_full_name=r->>'guest_full_name' WHERE id=target.id;
        updated_count := updated_count+1;
      END IF;
      duplicate_count := duplicate_count+1;
      CONTINUE;
    END IF;
    SELECT count(*) INTO candidate_count FROM public.conc_opera_entries e WHERE e.hotel_id=_hotel_id AND nullif(e.trx_no,'') IS NULL AND e.business_date=nullif(r->>'business_date','')::date AND e.trx_code=r->>'trx_code' AND e.amount=(r->>'amount')::numeric AND coalesce(e.receipt_no,'')=coalesce(r->>'receipt_no','') AND coalesce(e.room,'')=coalesce(r->>'room','') AND coalesce(e.raw->>'source','') <> 'totvs';
    SELECT count(*) INTO incoming_count FROM jsonb_array_elements(_rows) AS x(v) WHERE v->>'business_date'=r->>'business_date' AND v->>'trx_code'=r->>'trx_code' AND (v->>'amount')::numeric=(r->>'amount')::numeric AND coalesce(v->>'receipt_no','')=coalesce(r->>'receipt_no','') AND coalesce(v->>'room','')=coalesce(r->>'room','');
    IF candidate_count>0 AND (t IS NOT NULL OR coalesce(r->>'receipt_no','')<>'') THEN
      IF candidate_count<>1 OR incoming_count<>1 THEN RAISE EXCEPTION 'Há lançamentos Opera antigos semelhantes em % (código %). Importação não aplicada; confira as transações para evitar duplicidades.',r->>'business_date',r->>'trx_code'; END IF;
      SELECT e.* INTO target FROM public.conc_opera_entries e WHERE e.hotel_id=_hotel_id AND nullif(e.trx_no,'') IS NULL AND e.business_date=nullif(r->>'business_date','')::date AND e.trx_code=r->>'trx_code' AND e.amount=(r->>'amount')::numeric AND coalesce(e.receipt_no,'')=coalesce(r->>'receipt_no','') AND coalesce(e.room,'')=coalesce(r->>'room','') AND coalesce(e.raw->>'source','') <> 'totvs' FOR UPDATE;
      UPDATE public.conc_opera_entries SET trx_no=t,entry_key=key,guest_full_name=r->>'guest_full_name' WHERE id=target.id;
      duplicate_count := duplicate_count+1; updated_count := updated_count+1;
      CONTINUE;
    END IF;
    INSERT INTO public.conc_opera_entries(hotel_id,upload_id,entry_key,trx_code,trx_desc,amount,business_date,room,guest_full_name,receipt_no,trx_no,raw) VALUES(_hotel_id,_upload_id,key,r->>'trx_code',r->>'trx_desc',(r->>'amount')::numeric,nullif(r->>'business_date','')::date,r->>'room',r->>'guest_full_name',r->>'receipt_no',t,r);
    inserted_count := inserted_count+1;
  END LOOP;
  UPDATE public.conc_uploads SET parsed_count=inserted_count,skipped_count=skipped_count+duplicate_count,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('duplicates',duplicate_count,'legacy_updated',updated_count) WHERE id=_upload_id;
  RETURN jsonb_build_object('inserted',inserted_count,'duplicates',duplicate_count,'updated',updated_count);
END $$;
REVOKE ALL ON FUNCTION public.conc_import_opera(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_import_opera(text,uuid,jsonb) TO authenticated,service_role;