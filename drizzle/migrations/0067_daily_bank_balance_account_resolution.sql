CREATE OR REPLACE FUNCTION public.conc_daily_closing(p_hotel text,p_from date DEFAULT NULL,p_to date DEFAULT NULL,p_dates date[] DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_access_conciliacao(auth.uid()) OR NOT public.can_view_hotel_data(auth.uid(),p_hotel) THEN RAISE EXCEPTION 'Sem acesso ao fechamento diário'; END IF;
 WITH days AS (
  SELECT line_date AS day FROM public.conc_bank_entries WHERE hotel_id=p_hotel AND line_date IS NOT NULL
  UNION SELECT balance_date FROM public.conc_daily_balances WHERE hotel_id=p_hotel
 ), selected AS (
  SELECT day FROM days WHERE CASE WHEN coalesce(cardinality(p_dates),0)>0 THEN day=ANY(p_dates) ELSE (p_from IS NULL OR day>=p_from) AND (p_to IS NULL OR day<=p_to) END
 ), account_sources AS (
  SELECT nullif(btrim(account_name_raw),'') AS account_name FROM public.conc_bank_entries WHERE hotel_id=p_hotel
  UNION SELECT nullif(btrim(account_name),'') FROM public.conc_daily_balances WHERE hotel_id=p_hotel AND account_name<>'*'
 ), named_accounts AS (
  SELECT account_name FROM account_sources WHERE account_name IS NOT NULL
 ), account_scope AS (
  SELECT count(*) AS named_count,min(account_name) AS single_name FROM named_accounts
 ), accounts AS (
  SELECT DISTINCT CASE WHEN s.account_name IS NULL AND n.named_count=1 THEN n.single_name ELSE coalesce(s.account_name,'') END AS account_name
  FROM account_sources s CROSS JOIN account_scope n
 ), snapshots AS (
  SELECT DISTINCT ON (account_name,balance_date) account_name,balance_date,initial_balance,real_balance
  FROM (
   SELECT CASE WHEN nullif(btrim(s.account_name),'') IS NULL AND n.named_count=1 THEN n.single_name ELSE btrim(s.account_name) END AS account_name,
    s.balance_date,s.initial_balance,s.real_balance,s.updated_at,s.id,
    CASE WHEN nullif(btrim(s.account_name),'') IS NULL THEN 1 ELSE 0 END AS unnamed
   FROM public.conc_daily_balances s CROSS JOIN account_scope n WHERE s.hotel_id=p_hotel AND s.account_name<>'*'
  ) normalized ORDER BY account_name,balance_date,unnamed,updated_at DESC,id
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
 LEFT JOIN snapshots s ON s.account_name=a.account_name AND s.balance_date=d.day
 LEFT JOIN LATERAL (
  SELECT prior.real_balance FROM snapshots prior
  WHERE prior.account_name=a.account_name AND prior.balance_date<d.day AND prior.real_balance IS NOT NULL
  ORDER BY prior.balance_date DESC LIMIT 1
 ) prev ON true
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