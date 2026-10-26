CREATE OR REPLACE FUNCTION public.conc_batch_summary(p_source text, p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record; n int; ok int; liquid numeric; missing int; unique_group boolean:=true; group_amount numeric; target numeric; is_at boolean:=false; fee numeric:=0; sums_ok boolean;
BEGIN
IF p_source='rede' THEN SELECT id,hotel_id,data dt,concat_ws(' · ',bandeira,modalidade) label,valor_depositado amount,bandeira,modalidade INTO r FROM public.conc_rede_recebidos WHERE id=p_id;
IF FOUND THEN
  SELECT count(*)=1, sum(x.valor_depositado) INTO unique_group, group_amount FROM public.conc_rede_recebidos x JOIN public.conc_rede_recebidos y ON y.id=p_id WHERE x.hotel_id=y.hotel_id AND x.data=y.data AND upper(public.unaccent_safe(btrim(x.bandeira)))=upper(public.unaccent_safe(btrim(y.bandeira))) AND upper(public.unaccent_safe(btrim(x.modalidade)))=upper(public.unaccent_safe(btrim(y.modalidade)));
  is_at := upper(public.unaccent_safe(coalesce(r.modalidade,''))) LIKE '%ANTECIP%' OR EXISTS(SELECT 1 FROM public.conc_bank_entries b WHERE b.hotel_id=r.hotel_id AND b.line_date BETWEEN r.dt-1 AND r.dt+3 AND upper(b.description) ~ ' AT[0-9]' AND round(b.amount,2) IN (round(r.amount,2), round(group_amount,2)));
END IF;
ELSIF p_source='b2b' THEN SELECT id,hotel_id,data_operacao dt,descricao label,abs(valor_recebivel_liquido) amount INTO r FROM public.conc_b2b_receipts WHERE id=p_id AND tipo_lancamento='deposit'; group_amount:=r.amount; ELSE RETURN NULL; END IF;
IF r.id IS NULL THEN RETURN NULL; END IF;
SELECT count(*),count(*) FILTER(WHERE status='Conciliado'),sum(net),count(*) FILTER(WHERE net IS NULL) INTO n,ok,liquid,missing FROM public.conc_batch_rows(p_source,p_id);
-- Twin lots (same date/brand/modality) share one composition: validate the whole group.
target := CASE WHEN unique_group THEN r.amount ELSE group_amount END;
IF round(liquid,2)=round(target,2) THEN sums_ok:=true;
ELSIF is_at AND liquid>target AND (liquid-target)<=liquid*0.06 THEN sums_ok:=true; fee:=round(liquid-target,2);
ELSE sums_ok:=false; END IF;
RETURN jsonb_build_object('source',p_source,'id',r.id,'label',r.label,'date',r.dt,'amount',r.amount,'group_amount',target,'twins',NOT unique_group,'anticipation_fee',fee,'total',n,'reconciled',ok,'net',liquid,
 'complete',n>0 AND missing=0 AND sums_ok,
 'ready',n>0 AND n=ok AND missing=0 AND sums_ok,
 'reason',CASE WHEN n=0 THEN 'Relatório de vendas integrantes não encontrado'
  WHEN missing>0 OR NOT sums_ok THEN CASE WHEN unique_group THEN 'Soma líquida das parcelas não confere com o lote' ELSE 'Soma líquida das parcelas não confere com os lotes da mesma data, bandeira e modalidade' END
  WHEN n<>ok THEN 'Há vendas sem conciliação com o Ópera'
  ELSE '100% conciliado com o Ópera' || CASE WHEN fee>0 THEN ' · taxa de antecipação R$ '||to_char(fee,'FM999G990D00') ELSE '' END || CASE WHEN NOT unique_group THEN ' · lotes da mesma data/bandeira/modalidade validados em conjunto' ELSE '' END END);
END $function$;