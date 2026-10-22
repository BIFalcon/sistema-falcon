DO $migration$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef('public.conc_auto_reconcile_impl(text)'::regprocedure) INTO d;
 d := replace(d, 'AND coalesce(btrim(categoria), '''') <> '''' AND direct_bank = false AND amount <> 0', 'AND coalesce(btrim(categoria), '''') <> '''' AND direct_bank = false AND amount <> 0 AND base_conciliacao IN (''CARTAO'',''PIX'',''DINHEIRO'')');
 EXECUTE d;
END;
$migration$;