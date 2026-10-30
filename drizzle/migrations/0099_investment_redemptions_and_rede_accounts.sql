CREATE OR REPLACE FUNCTION public.conc_is_investment_redemption(p_description text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public','pg_temp'
AS $$ SELECT regexp_replace(upper(public.unaccent_safe(btrim(coalesce(p_description,'')))),'\s+',' ','g') ~ '^(INT )?(RESGATE|RESG|EST APLIC|ESTORNO APLIC)\M.*\m(TRUST|DI|CDB|APLIC|FUNDO|INVEST|AUT)' $$;

CREATE OR REPLACE FUNCTION public.conc_is_financial_income(p_description text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public','pg_temp'
AS $$ SELECT upper(public.unaccent_safe(btrim(coalesce(p_description,'')))) ~ '^(RENDIMENTOS )?REND PAGO APLIC AUT( MAIS| APR)?$' OR public.conc_is_investment_redemption(p_description) $$;

CREATE OR REPLACE FUNCTION public.conc_income_auto_match(p_hotel text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$ DECLARE b record;mid uuid;actor uuid;n int:=0;BEGIN
IF auth.uid() IS NOT NULL AND (NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel)) THEN RAISE EXCEPTION 'Sem permissão';END IF;
FOR b IN SELECT * FROM public.conc_bank_entries WHERE hotel_id=p_hotel AND amount>0 AND matched_at IS NULL AND NOT income_auto_excluded AND public.conc_is_financial_income(description) ORDER BY id FOR UPDATE LOOP
actor:=coalesce(auth.uid(),(SELECT uploaded_by FROM public.conc_uploads WHERE id=b.upload_id));IF actor IS NULL THEN CONTINUE;END IF;
INSERT INTO public.conc_matches(hotel_id,kind,left_total,right_total,difference,note,matched_by) VALUES(p_hotel,'baixa_bancaria',b.amount,b.amount,0,
 CASE WHEN public.conc_is_investment_redemption(b.description) THEN 'Movimentação de aplicação — resgate/estorno de aplicação identificado no extrato; sem venda operacional'
 ELSE 'Receita financeira — rendimento de aplicação automática identificado no extrato; sem venda operacional' END,actor) RETURNING id INTO mid;
INSERT INTO public.conc_match_items(match_id,side,entry_id,amount) VALUES(mid,'bank',b.id,b.amount);
UPDATE public.conc_bank_entries SET matched_at=now() WHERE id=b.id;n:=n+1;
END LOOP;RETURN n;END $function$;

-- Contas correntes do hotel e de outros hotéis (somente dígitos) para filtrar o relatório da Rede
CREATE OR REPLACE FUNCTION public.conc_rede_account_scope(p_hotel text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$ BEGIN
IF auth.uid() IS NULL OR NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem permissão';END IF;
RETURN jsonb_build_object(
 'own',coalesce((SELECT jsonb_agg(DISTINCT regexp_replace(a->>'account','\D','','g')) FROM public.hotels h, jsonb_array_elements(coalesce(h.bank_accounts,'[]'::jsonb)) a WHERE h.id=p_hotel AND coalesce(a->>'account','')<>''),'[]'::jsonb),
 'foreign',coalesce((SELECT jsonb_agg(DISTINCT regexp_replace(a->>'account','\D','','g')) FROM public.hotels h, jsonb_array_elements(coalesce(h.bank_accounts,'[]'::jsonb)) a WHERE h.id<>p_hotel AND coalesce(a->>'account','')<>''),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.conc_rede_account_scope(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.conc_rede_account_scope(text) TO authenticated;

-- Backfill: resgates já importados
DO $$ DECLARE h text; BEGIN
FOR h IN SELECT DISTINCT hotel_id FROM public.conc_bank_entries WHERE amount>0 AND matched_at IS NULL AND NOT income_auto_excluded AND public.conc_is_financial_income(description) LOOP
 PERFORM public.conc_income_auto_match(h);
END LOOP; END $$;