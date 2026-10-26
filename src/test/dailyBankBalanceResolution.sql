-- Read-only regression: single account aliases, weekend carry-forward, explicit initial, distinct accounts, no future balance.
WITH bank_fixture(hotel_id,account_name_raw) AS (VALUES ('single',''),('single','Conta A'),('multi','Conta A'),('multi','Conta B'),('multi','')),
balance_fixture(hotel_id,account_name,balance_date,initial_balance,real_balance,updated_at,id) AS (VALUES
 ('single','Conta A',DATE '2026-10-16',NULL::numeric,1000::numeric,TIMESTAMP '2026-10-16',1),
 ('single','',DATE '2026-10-16',NULL::numeric,1000::numeric,TIMESTAMP '2026-10-16',2),
 ('single','',DATE '2026-10-19',NULL::numeric,1200::numeric,TIMESTAMP '2026-10-19',3),
 ('single','Conta A',DATE '2026-10-20',50::numeric,1300::numeric,TIMESTAMP '2026-10-20',4),
 ('single','',DATE '2026-10-20',NULL::numeric,9999::numeric,TIMESTAMP '2026-10-20',5),
 ('multi','Conta A',DATE '2026-10-19',NULL::numeric,100::numeric,TIMESTAMP '2026-10-19',6),
 ('multi','Conta B',DATE '2026-10-19',NULL::numeric,200::numeric,TIMESTAMP '2026-10-19',7)),
scenarios(p_hotel,day,expected_initial,expected_real) AS (VALUES
 ('single',DATE '2026-10-19',1000::numeric,1200::numeric),
 ('single',DATE '2026-10-20',50::numeric,1300::numeric),
 ('single',DATE '2026-10-15',NULL::numeric,NULL::numeric),
 ('multi',DATE '2026-10-19',NULL::numeric,NULL::numeric))
SELECT p_hotel,day, b.initial IS NOT DISTINCT FROM expected_initial AND b.real IS NOT DISTINCT FROM expected_real AS passed
FROM scenarios CROSS JOIN LATERAL (
 WITH selected AS (SELECT scenarios.day), account_sources AS (
  SELECT nullif(btrim(account_name_raw),'') AS account_name FROM bank_fixture WHERE hotel_id=p_hotel
  UNION SELECT nullif(btrim(account_name),'') FROM balance_fixture WHERE hotel_id=p_hotel AND account_name<>'*'
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
   FROM balance_fixture s CROSS JOIN account_scope n WHERE s.hotel_id=p_hotel AND s.account_name<>'*'
  ) normalized ORDER BY account_name,balance_date,unnamed,updated_at DESC,id
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
 ) SELECT initial,real FROM balances
) b;
