CREATE TABLE public.conc_pendencias (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id text NOT NULL REFERENCES public.hotels(id),
 entry_id uuid NOT NULL REFERENCES public.conc_bank_entries(id) ON DELETE CASCADE,
 valor numeric NOT NULL, status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','revertida')),
 aberta_em timestamptz NOT NULL DEFAULT now(), revertida_em timestamptz,
 match_id uuid REFERENCES public.conc_matches(id) ON DELETE SET NULL
);
GRANT SELECT ON public.conc_pendencias TO authenticated;
GRANT ALL ON public.conc_pendencias TO service_role;
ALTER TABLE public.conc_pendencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY conc_pending_read ON public.conc_pendencias FOR SELECT TO authenticated USING (public.can_access_conciliacao(auth.uid()) AND public.can_view_hotel_data(auth.uid(),hotel_id));
CREATE UNIQUE INDEX conc_pending_one_open ON public.conc_pendencias(entry_id) WHERE status='aberta';
CREATE INDEX conc_pending_hotel ON public.conc_pendencias(hotel_id,status);

CREATE TABLE public.conc_daily_balances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id text NOT NULL REFERENCES public.hotels(id),
 account_name text NOT NULL DEFAULT '', balance_date date NOT NULL, initial_balance numeric, real_balance numeric,
 source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','extrato')),
 informed_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(hotel_id,account_name,balance_date)
);
GRANT SELECT, INSERT, UPDATE ON public.conc_daily_balances TO authenticated;
GRANT ALL ON public.conc_daily_balances TO service_role;
ALTER TABLE public.conc_daily_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY conc_daily_balance_read ON public.conc_daily_balances FOR SELECT TO authenticated USING (public.can_access_conciliacao(auth.uid()) AND public.can_view_hotel_data(auth.uid(),hotel_id));
CREATE POLICY conc_daily_balance_insert ON public.conc_daily_balances FOR INSERT TO authenticated WITH CHECK (public.can_access_conciliacao(auth.uid()) AND public.can_view_hotel_data(auth.uid(),hotel_id) AND informed_by=auth.uid());
CREATE POLICY conc_daily_balance_update ON public.conc_daily_balances FOR UPDATE TO authenticated USING (public.can_access_conciliacao(auth.uid()) AND public.can_view_hotel_data(auth.uid(),hotel_id)) WITH CHECK (public.can_access_conciliacao(auth.uid()) AND public.can_view_hotel_data(auth.uid(),hotel_id) AND informed_by=auth.uid());

ALTER TABLE public.conc_matches DROP CONSTRAINT conc_matches_kind_check;
ALTER TABLE public.conc_matches ADD CONSTRAINT conc_matches_kind_check CHECK (kind IN ('cartao','pix_extrato','dinheiro','baixa_bancaria'));

CREATE FUNCTION public.conc_sync_bank_pending() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE mid uuid; actor uuid;
BEGIN
 IF NEW.amount > 0 AND NEW.matched_at IS NULL THEN
  INSERT INTO public.conc_pendencias(hotel_id,entry_id,valor) VALUES(NEW.hotel_id,NEW.id,-abs(NEW.amount))
   ON CONFLICT(entry_id) WHERE status='aberta' DO UPDATE SET valor=excluded.valor;
 ELSIF NEW.matched_at IS NOT NULL THEN
  SELECT mi.match_id INTO mid FROM public.conc_match_items mi JOIN public.conc_matches m ON m.id=mi.match_id
   WHERE mi.side='bank' AND mi.entry_id=NEW.id AND m.hotel_id=NEW.hotel_id ORDER BY m.matched_at DESC LIMIT 1;
  IF mid IS NULL AND NEW.amount>0 THEN
   actor:=coalesce(auth.uid(),(SELECT uploaded_by FROM public.conc_uploads WHERE id=NEW.upload_id));
   IF actor IS NOT NULL THEN
    INSERT INTO public.conc_matches(hotel_id,kind,left_total,right_total,difference,note,matched_by)
     VALUES(NEW.hotel_id,'baixa_bancaria',NEW.amount,NEW.amount,0,'Baixa bancária — fechamento diário',actor) RETURNING id INTO mid;
    INSERT INTO public.conc_match_items(match_id,side,entry_id,amount) VALUES(mid,'bank',NEW.id,NEW.amount);
   END IF;
  END IF;
  UPDATE public.conc_pendencias SET status='revertida',revertida_em=NEW.matched_at,match_id=mid WHERE entry_id=NEW.id AND status='aberta';
 ELSE
  UPDATE public.conc_pendencias SET status='revertida',revertida_em=now() WHERE entry_id=NEW.id AND status='aberta';
 END IF;
 IF TG_OP='UPDATE' AND OLD.matched_at IS NOT NULL AND NEW.matched_at IS NULL THEN
  DELETE FROM public.conc_matches WHERE kind='baixa_bancaria' AND id IN (SELECT match_id FROM public.conc_match_items WHERE side='bank' AND entry_id=NEW.id);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.conc_sync_bank_pending() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.conc_sync_bank_pending() TO service_role;
CREATE TRIGGER conc_bank_pending AFTER INSERT OR UPDATE OF matched_at,amount ON public.conc_bank_entries FOR EACH ROW EXECUTE FUNCTION public.conc_sync_bank_pending();

INSERT INTO public.conc_pendencias(hotel_id,entry_id,valor)
 SELECT hotel_id,id,-abs(amount) FROM public.conc_bank_entries WHERE amount>0 AND matched_at IS NULL;

CREATE FUNCTION public.conc_daily_closing(p_hotel text,p_from date DEFAULT NULL,p_to date DEFAULT NULL,p_dates date[] DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem acesso ao fechamento diário'; END IF;
 WITH days AS (
  SELECT line_date AS day FROM public.conc_bank_entries WHERE hotel_id=p_hotel AND line_date IS NOT NULL
  UNION SELECT balance_date FROM public.conc_daily_balances WHERE hotel_id=p_hotel
 ), selected AS (
  SELECT day FROM days WHERE CASE WHEN coalesce(cardinality(p_dates),0)>0 THEN day=ANY(p_dates) ELSE (p_from IS NULL OR day>=p_from) AND (p_to IS NULL OR day<=p_to) END
 ), accounts AS (
  SELECT DISTINCT coalesce(account_name_raw,'') AS account_name FROM public.conc_bank_entries WHERE hotel_id=p_hotel
  UNION SELECT account_name FROM public.conc_daily_balances WHERE hotel_id=p_hotel AND account_name<>'*'
 ), totals AS (
 SELECT d.day,coalesce(sum(b.amount) FILTER(WHERE b.amount>0),0) AS credits,
  coalesce(sum(b.amount) FILTER(WHERE b.amount>0 AND b.matched_at IS NOT NULL),0) AS received,
  coalesce(-sum(b.amount) FILTER(WHERE b.amount<0),0) AS paid,
  coalesce(sum(p.valor),0) AS pending
 FROM selected d LEFT JOIN public.conc_bank_entries b ON b.hotel_id=p_hotel AND b.line_date=d.day
 LEFT JOIN public.conc_pendencias p ON p.entry_id=b.id AND p.status='aberta' GROUP BY d.day
 ), balances AS (
 SELECT d.day,
  CASE WHEN count(*)=count(coalesce(s.initial_balance,prev.real_balance)) THEN sum(coalesce(s.initial_balance,prev.real_balance)) END AS initial,
  CASE WHEN count(*)=count(s.real_balance) THEN sum(s.real_balance) END AS real
 FROM selected d CROSS JOIN accounts a
 LEFT JOIN public.conc_daily_balances s ON s.hotel_id=p_hotel AND s.account_name=a.account_name AND s.balance_date=d.day
 LEFT JOIN public.conc_daily_balances prev ON prev.hotel_id=p_hotel AND prev.account_name=a.account_name AND prev.balance_date=d.day-1
 GROUP BY d.day
 ), rows AS (
 SELECT t.day,t.credits,t.received,t.paid,t.pending,coalesce(o.initial_balance,b.initial) AS initial,coalesce(o.real_balance,b.real) AS real
 FROM totals t LEFT JOIN balances b USING(day)
 LEFT JOIN public.conc_daily_balances o ON o.hotel_id=p_hotel AND o.account_name='*' AND o.balance_date=t.day
 )
 SELECT jsonb_build_object('days',coalesce((SELECT jsonb_agg(jsonb_build_object('day',day,'credits',credits,'received',received,'paid',paid,'pending',pending,'initial',initial,'real',real,'final',initial+credits+pending-paid,'difference',initial+credits+pending-paid-real) ORDER BY day DESC) FROM rows),'[]'::jsonb),
 'pending',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'entry_id',p.entry_id,'day',e.line_date,'description',e.description,'valor',p.valor,'status',p.status,'aberta_em',p.aberta_em,'revertida_em',p.revertida_em,'match_id',p.match_id) ORDER BY e.line_date DESC,p.aberta_em DESC)
 FROM public.conc_pendencias p JOIN public.conc_bank_entries e ON e.id=p.entry_id JOIN selected d ON d.day=e.line_date WHERE p.hotel_id=p_hotel),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.conc_daily_closing(text,date,date,date[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.conc_daily_closing(text,date,date,date[]) TO authenticated,service_role;
COMMENT ON TABLE public.conc_pendencias IS 'Credit-only transit adjustments: debits are already subtracted as paid. Reopening reconciliation creates a new open cycle.';