DO $do$
DECLARE s text; p text;
BEGIN
  s := pg_get_functiondef('public.conc_auto_reconcile_impl(text)'::regprocedure);
  s := replace(s, E'  LOOP\n    FOR r IN\n      WITH o AS (', E'  LOOP\n    v_ok := false;\n    FOR r IN\n      WITH o AS (');
  s := replace(s, E'      v_count := v_count + 1;\n    END LOOP;\n    EXIT WHEN NOT FOUND;', E'      v_count := v_count + 1;\n      v_ok := true;\n    END LOOP;\n    EXIT WHEN NOT v_ok;');
  IF position('EXIT WHEN NOT FOUND' in s) > 0 THEN RAISE EXCEPTION 'patch PIX loop failed'; END IF;
  EXECUTE s;
  p := pg_get_functiondef('public.conc_rede_match_proven(text)'::regprocedure);
  p := replace(p, 'be.amount>0 AND EXISTS', 'be.amount>0 AND be.line_date BETWEEN r.data-1 AND r.data+3 AND round(be.amount,2)=round(r.valor_depositado,2) AND EXISTS');
  IF position('round(be.amount,2)=round(r.valor_depositado,2)' in p) = 0 THEN RAISE EXCEPTION 'patch rede prefilter failed'; END IF;
  EXECUTE p;
END $do$;