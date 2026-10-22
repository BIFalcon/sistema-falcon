ALTER TABLE public.conc_opera_entries ADD COLUMN IF NOT EXISTS base_conciliacao text, ADD COLUMN IF NOT EXISTS categoria_omie text;
ALTER TABLE public.conc_opera_entries ADD CONSTRAINT conc_opera_base_check CHECK (base_conciliacao IS NULL OR base_conciliacao IN ('CARTAO','PIX','DINHEIRO','FATURADO'));
CREATE OR REPLACE FUNCTION public.conc_category_key(_value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
WITH n AS (SELECT nullif(btrim(regexp_replace(upper(translate(coalesce(_value,''),'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^A-Z0-9]+',' ','g')), '') AS v)
SELECT CASE WHEN v IN ('AMERICAN EXPRESS','AMERICAN EXPRESS CREDITO','AMEX','AMEX CREDITO') THEN 'AMEX CREDITO' WHEN v IN ('DINERS','DINERS CLUB','DINERS CREDITO','DINERS CLUB CREDITO') THEN 'DINERS' ELSE v END FROM n;
$fn$;
CREATE OR REPLACE FUNCTION public.conc_classify_opera() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE m public.trx_code_mapping%ROWTYPE;
BEGIN
 SELECT * INTO m FROM public.trx_code_mapping WHERE btrim(trx_code)=btrim(NEW.trx_code);
 IF FOUND AND coalesce(NEW.raw->>'source','') <> 'totvs' THEN
  NEW.base_conciliacao := m.categoria;
  NEW.categoria_omie := nullif(btrim(m.categoria_omie),'');
  NEW.categoria := public.conc_category_key(m.categoria_omie);
 ELSE
  NEW.base_conciliacao := coalesce(NEW.base_conciliacao, CASE WHEN NEW.categoria ILIKE '%pix%' THEN 'PIX' WHEN NEW.categoria ILIKE '%dinheiro%' THEN 'DINHEIRO' WHEN nullif(btrim(NEW.categoria),'') IS NOT NULL THEN 'CARTAO' END);
  NEW.categoria_omie := coalesce(NEW.categoria_omie, NEW.categoria);
  NEW.categoria := public.conc_category_key(NEW.categoria_omie);
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER conc_classify_opera BEFORE INSERT OR UPDATE OF trx_code, categoria, categoria_omie, base_conciliacao ON public.conc_opera_entries FOR EACH ROW EXECUTE FUNCTION public.conc_classify_opera();
UPDATE public.conc_opera_entries SET categoria = categoria;
CREATE OR REPLACE FUNCTION public.conc_sync_trx_classification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
 UPDATE public.conc_opera_entries SET base_conciliacao=NEW.categoria, categoria_omie=NEW.categoria_omie, categoria=public.conc_category_key(NEW.categoria_omie)
 WHERE btrim(trx_code)=btrim(NEW.trx_code) AND coalesce(raw->>'source','') <> 'totvs';
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER conc_sync_trx_classification AFTER INSERT OR UPDATE OF categoria,categoria_omie,trx_code ON public.trx_code_mapping FOR EACH ROW EXECUTE FUNCTION public.conc_sync_trx_classification();
REVOKE ALL ON FUNCTION public.conc_classify_opera() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.conc_sync_trx_classification() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.conc_classify_opera(), public.conc_sync_trx_classification() TO service_role;
DO $migration$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef('public.conc_auto_reconcile_impl(text)'::regprocedure) INTO d;
 d := replace(d, 'lower(btrim(o.categoria)) = lower(btrim(a.categoria))', 'public.conc_category_key(o.categoria_omie) = public.conc_category_key(a.categoria)');
 d := replace(d, E'AND lower(btrim(o.categoria)) NOT LIKE ''%dinheiro%''\n        AND lower(btrim(o.categoria)) NOT LIKE ''%pix%''', 'AND o.base_conciliacao = ''CARTAO''');
 d := replace(d, E'AND lower(btrim(categoria)) NOT LIKE ''%dinheiro%''\n        AND lower(btrim(categoria)) NOT LIKE ''%pix%''', 'AND base_conciliacao = ''CARTAO''');
 d := replace(d, 'lower(btrim(coalesce(categoria, ''''))) LIKE ''%pix%'' AND direct_bank = false', 'base_conciliacao = ''PIX'' AND direct_bank = false');
 d := replace(d, 'business_date AS d, lower(btrim(categoria)) AS cat,', 'business_date AS d, public.conc_category_key(categoria_omie) AS cat,');
 d := replace(d, 'sale_date AS d, lower(btrim(categoria)) AS cat,', 'sale_date AS d, public.conc_category_key(categoria) AS cat,');
 d := replace(d, 'PARTITION BY hotel_id, sale_date, lower(btrim(categoria)), amount', 'PARTITION BY hotel_id, sale_date, public.conc_category_key(categoria), amount');
 d := replace(d, E'upper(btrim(coalesce(guest_full_name, ''''))) AS g, amount\n      FROM public.conc_opera_entries', E'upper(btrim(coalesce(guest_full_name, ''''))) AS g, amount, base_conciliacao AS base\n      FROM public.conc_opera_entries');
 d := replace(d, 'PARTITION BY hotel_id, d, cat, g, abs(amount)', 'PARTITION BY hotel_id, d, base, cat, g, abs(amount)');
 d := replace(d, 'SELECT p.hotel_id, p.cat, p.amount, p.id AS pos_id, n.id AS neg_id', 'SELECT p.hotel_id, p.cat, p.base, p.amount, p.id AS pos_id, n.id AS neg_id');
 d := replace(d, 'n.cat = p.cat AND n.g = p.g', 'n.cat = p.cat AND n.base = p.base AND n.g = p.g');
 d := replace(d, 'CASE WHEN r.cat LIKE ''%dinheiro%'' THEN ''dinheiro'' ELSE ''cartao'' END', 'CASE WHEN r.base = ''DINHEIRO'' THEN ''dinheiro'' WHEN r.base = ''PIX'' THEN ''pix_extrato'' ELSE ''cartao'' END');
 EXECUTE d;
END;
$migration$;
COMMENT ON COLUMN public.conc_opera_entries.categoria IS 'Normalized OMIE matching key; routing is exclusively base_conciliacao, displayed OMIE label is categoria_omie.';