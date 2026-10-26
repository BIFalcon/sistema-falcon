CREATE FUNCTION public.conc_batch_rows(p_source text,p_id uuid) RETURNS TABLE(payment_id uuid,nsu text,sale_date date,gross numeric,net numeric,acquirer_id uuid,status text,opera jsonb) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
WITH lines AS (
SELECT p.id,p.hotel_id,p.nsu_cv nsu,p.data_original_venda dt,p.valor_bruto_parcela_original gross,p.valor_liquido_parcela net,NULL::uuid aid,'rede'::text provider,p.bandeira,p.modalidade FROM public.conc_rede_recebidos r JOIN public.conc_rede_pagamentos p ON p.hotel_id=r.hotel_id AND p.data_recebimento=r.data AND upper(public.unaccent_safe(btrim(p.bandeira)))=upper(public.unaccent_safe(btrim(r.bandeira))) AND upper(public.unaccent_safe(btrim(p.modalidade)))=upper(public.unaccent_safe(btrim(r.modalidade))) WHERE p_source='rede' AND r.id=p_id
UNION ALL SELECT c.id,c.hotel_id,c.nsu_autorizacao,coalesce(c.data_transacao,a.sale_date),c.valor_total_transacao,c.valor_recebivel_liquido,c.matched_acquirer_id,'b2b',c.bandeira,NULL FROM public.conc_b2b_receipts d JOIN public.conc_b2b_receipts c ON c.deposit_id=d.id AND c.hotel_id=d.hotel_id AND c.tipo_lancamento='charge' LEFT JOIN public.conc_acquirer_entries a ON a.id=c.matched_acquirer_id AND a.hotel_id=c.hotel_id WHERE p_source='b2b' AND d.id=p_id AND d.tipo_lancamento='deposit'
), resolved AS (
SELECT l.*,a.ids FROM lines l LEFT JOIN LATERAL(SELECT array_agg(x.id) ids FROM public.conc_acquirer_entries x WHERE x.hotel_id=l.hotel_id AND x.adjusts_entry_id IS NULL AND ((l.provider='b2b' AND x.id=l.aid) OR (l.provider='rede' AND x.source='rede' AND nullif(btrim(x.nsu),'')=nullif(btrim(l.nsu),'') AND x.sale_date=l.dt AND upper(public.unaccent_safe(btrim(x.bandeira)))=upper(public.unaccent_safe(btrim(l.bandeira))) AND upper(public.unaccent_safe(btrim(x.modalidade)))=upper(public.unaccent_safe(btrim(l.modalidade))) AND x.amount>=l.gross)))a ON true
), verified AS (
SELECT l.*,a.id sale_id,a.matched_at,coalesce(o.rows,'[]'::jsonb) ops FROM resolved l LEFT JOIN public.conc_acquirer_entries a ON cardinality(l.ids)=1 AND a.id=l.ids[1] LEFT JOIN LATERAL(
SELECT jsonb_agg(DISTINCT jsonb_build_object('id',op.id,'date',op.business_date,'amount',op.amount,'guest',op.guest_full_name,'room',op.room,'receipt',op.receipt_no,'category',op.trx_desc)) rows FROM public.conc_match_items mi JOIN public.conc_matches m ON m.id=mi.match_id AND m.hotel_id=l.hotel_id AND m.kind='cartao' AND abs(m.difference)<0.01 JOIN public.conc_match_items oi ON oi.match_id=mi.match_id AND oi.side='opera' JOIN public.conc_opera_entries op ON op.id=oi.entry_id AND op.hotel_id=l.hotel_id AND op.matched_at IS NOT NULL WHERE mi.side='acquirer' AND mi.entry_id=a.id)o ON true
) SELECT id,nsu,dt,gross,net,sale_id,CASE WHEN coalesce(cardinality(ids),0)=0 THEN 'Venda não encontrada' WHEN cardinality(ids)>1 THEN 'Venda ambígua' WHEN matched_at IS NULL OR jsonb_array_length(ops)=0 THEN 'Falta conciliar no Ópera' ELSE 'Conciliado' END,ops FROM verified;
$$;
REVOKE ALL ON FUNCTION public.conc_batch_rows(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.conc_batch_rows(text,uuid) TO service_role;
CREATE FUNCTION public.conc_batch_summary(p_source text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record; n int; ok int; liquid numeric; missing int; unique_group boolean:=true;
BEGIN
IF p_source='rede' THEN SELECT id,hotel_id,data dt,concat_ws(' · ',bandeira,modalidade) label,valor_depositado amount INTO r FROM public.conc_rede_recebidos WHERE id=p_id;
IF FOUND THEN SELECT count(*)=1 INTO unique_group FROM public.conc_rede_recebidos x JOIN public.conc_rede_recebidos y ON y.id=p_id WHERE x.hotel_id=y.hotel_id AND x.data=y.data AND upper(public.unaccent_safe(btrim(x.bandeira)))=upper(public.unaccent_safe(btrim(y.bandeira))) AND upper(public.unaccent_safe(btrim(x.modalidade)))=upper(public.unaccent_safe(btrim(y.modalidade))); END IF;
ELSIF p_source='b2b' THEN SELECT id,hotel_id,data_operacao dt,descricao label,abs(valor_recebivel_liquido) amount INTO r FROM public.conc_b2b_receipts WHERE id=p_id AND tipo_lancamento='deposit'; ELSE RETURN NULL; END IF;
IF r.id IS NULL THEN RETURN NULL; END IF;
SELECT count(*),count(*) FILTER(WHERE status='Conciliado'),sum(net),count(*) FILTER(WHERE net IS NULL) INTO n,ok,liquid,missing FROM public.conc_batch_rows(p_source,p_id);
RETURN jsonb_build_object('source',p_source,'id',r.id,'label',r.label,'date',r.dt,'amount',r.amount,'total',n,'reconciled',ok,'net',liquid,'complete',n>0 AND missing=0 AND unique_group AND round(liquid,2)=round(r.amount,2),'ready',n>0 AND n=ok AND missing=0 AND unique_group AND round(liquid,2)=round(r.amount,2),'reason',CASE WHEN NOT unique_group THEN 'Mais de um lote na mesma data, bandeira e modalidade: composição não comprovada' WHEN n=0 THEN 'Relatório de vendas integrantes não encontrado' WHEN missing>0 OR round(liquid,2) IS DISTINCT FROM round(r.amount,2) THEN 'Soma líquida das parcelas não confere com o lote' WHEN n<>ok THEN 'Há vendas sem conciliação com o Ópera' ELSE '100% conciliado com o Ópera' END);
END $$;
REVOKE ALL ON FUNCTION public.conc_batch_summary(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.conc_batch_summary(text,uuid) TO service_role;
CREATE FUNCTION public.conc_batch_ready(p_source text,p_id uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h text;
BEGIN
IF p_source='rede' THEN SELECT hotel_id INTO h FROM public.conc_rede_recebidos WHERE id=p_id; ELSE SELECT hotel_id INTO h FROM public.conc_b2b_receipts WHERE id=p_id; END IF;
IF auth.uid() IS NOT NULL AND (NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),h)) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
RETURN coalesce((public.conc_batch_summary(p_source,p_id)->>'ready')::boolean,false);
END $$;
REVOKE ALL ON FUNCTION public.conc_batch_ready(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_batch_ready(text,uuid) TO authenticated,service_role;
CREATE FUNCTION public.conc_bank_batches(p_bank uuid) RETURNS TABLE(source text,entry_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
SELECT 'rede'::text,r.id FROM public.conc_bank_entries b JOIN public.conc_rede_recebidos r ON r.hotel_id=b.hotel_id WHERE b.id=p_bank AND (r.matched_bank_id=b.id OR (b.description ILIKE 'RECEBIMENTO REDE%' AND r.matched_bank_id IS NULL AND b.line_date BETWEEN r.data-1 AND r.data+3 AND round(b.amount,2)=round(r.valor_depositado,2) AND upper(b.description) LIKE '%'||CASE upper(public.unaccent_safe(r.bandeira)) WHEN 'MASTERCARD' THEN 'MAST' WHEN 'AMERICAN EXPRESS' THEN 'AMEX' ELSE upper(public.unaccent_safe(r.bandeira)) END||'%' AND upper(b.description) ~ (' ('||CASE upper(public.unaccent_safe(r.modalidade)) WHEN 'CREDITO' THEN 'CD|AT' WHEN 'DEBITO' THEN 'DB' WHEN 'ANTECIPADO' THEN 'AT' ELSE 'INVALID' END||')[0-9]')))
UNION ALL SELECT 'b2b',d.id FROM public.conc_bank_entries b JOIN public.conc_b2b_receipts d ON d.hotel_id=b.hotel_id AND d.tipo_lancamento='deposit' WHERE b.id=p_bank AND (d.matched_bank_id=b.id OR (b.description ILIKE 'ZOOP%' AND d.matched_bank_id IS NULL AND b.line_date BETWEEN d.data_operacao-5 AND d.data_operacao+10 AND round(b.amount,2)=round(abs(d.valor_recebivel_liquido),2)));
$$;
REVOKE ALL ON FUNCTION public.conc_bank_batches(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.conc_bank_batches(uuid) TO service_role;
CREATE FUNCTION public.conc_settlement_batch_details(p_hotel text,p_source text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
IF auth.uid() IS NULL OR NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
IF NOT ((p_source='bank' AND EXISTS(SELECT 1 FROM public.conc_bank_entries WHERE id=p_id AND hotel_id=p_hotel)) OR (p_source='rede' AND EXISTS(SELECT 1 FROM public.conc_rede_recebidos WHERE id=p_id AND hotel_id=p_hotel)) OR (p_source='b2b' AND EXISTS(SELECT 1 FROM public.conc_b2b_receipts WHERE id=p_id AND hotel_id=p_hotel))) THEN RAISE EXCEPTION 'Lote indisponível'; END IF;
WITH ids AS (SELECT source,entry_id FROM public.conc_bank_batches(p_id) WHERE p_source='bank' UNION ALL SELECT p_source,p_id WHERE p_source IN ('rede','b2b')) SELECT jsonb_build_object('batches',coalesce(jsonb_agg(public.conc_batch_summary(source,entry_id)||jsonb_build_object('sales',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY sale_date,payment_id),'[]'::jsonb) FROM public.conc_batch_rows(source,entry_id)x))),'[]'::jsonb),'ambiguous',count(*)>1,'transition',EXISTS(SELECT 1 FROM public.conc_settlement_transitions WHERE source=p_source AND entry_id=p_id AND undone_at IS NULL)) INTO result FROM ids;
RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.conc_settlement_batch_details(text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_settlement_batch_details(text,text,uuid) TO authenticated,service_role;
CREATE FUNCTION public.conc_guard_bank_settlement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n int; ok boolean;
BEGIN
IF NEW.amount>0 AND NEW.matched_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.matched_at IS NULL OR NEW.amount IS DISTINCT FROM OLD.amount) AND (NEW.description ILIKE 'RECEBIMENTO REDE%' OR NEW.description ILIKE 'ZOOP%' OR EXISTS(SELECT 1 FROM public.conc_rede_recebidos WHERE matched_bank_id=NEW.id) OR EXISTS(SELECT 1 FROM public.conc_b2b_receipts WHERE matched_bank_id=NEW.id)) AND NOT EXISTS(SELECT 1 FROM public.conc_settlement_transitions WHERE source='bank' AND entry_id=NEW.id AND hotel_id=NEW.hotel_id AND undone_at IS NULL) THEN
SELECT count(*),bool_and(public.conc_batch_ready(source,entry_id)) INTO n,ok FROM public.conc_bank_batches(NEW.id);
IF n<>1 OR NOT coalesce(ok,false) THEN RAISE EXCEPTION 'Baixa bloqueada: composição comprovada e 100%% das vendas conciliadas no Ópera são obrigatórias'; END IF;
END IF;
RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.conc_guard_bank_settlement() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.conc_guard_bank_settlement() TO service_role;
CREATE TRIGGER conc_bank_settlement_guard BEFORE INSERT OR UPDATE OF matched_at,amount ON public.conc_bank_entries FOR EACH ROW EXECUTE FUNCTION public.conc_guard_bank_settlement();