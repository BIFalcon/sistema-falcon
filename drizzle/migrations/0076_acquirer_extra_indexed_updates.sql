CREATE OR REPLACE FUNCTION public.conc_fill_acquirer_extra(_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $function$
DECLARE r jsonb; n integer := 0; changed integer;
BEGIN
  FOR r IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    UPDATE public.conc_acquirer_entries a SET
      valor_liquido = COALESCE(a.valor_liquido, (r->>'valor_liquido')::numeric),
      valor_original = COALESCE(a.valor_original, (r->>'valor_original')::numeric),
      nsu = COALESCE(NULLIF(btrim(a.nsu), ''), NULLIF(btrim(r->>'nsu'), '')),
      prazo_recebimento = COALESCE(a.prazo_recebimento, NULLIF(r->>'prazo_recebimento', '')),
      codigo_reserva = COALESCE(a.codigo_reserva, NULLIF(r->>'codigo_reserva', ''))
    WHERE a.entry_key = r->>'entry_key'
      AND ((a.valor_liquido IS NULL AND NULLIF(r->>'valor_liquido','') IS NOT NULL)
        OR (a.valor_original IS NULL AND NULLIF(r->>'valor_original','') IS NOT NULL)
        OR (NULLIF(btrim(a.nsu),'') IS NULL AND NULLIF(btrim(r->>'nsu'),'') IS NOT NULL)
        OR (a.prazo_recebimento IS NULL AND NULLIF(r->>'prazo_recebimento','') IS NOT NULL)
        OR (a.codigo_reserva IS NULL AND NULLIF(r->>'codigo_reserva','') IS NOT NULL));
    GET DIAGNOSTICS changed = ROW_COUNT;
    n := n + changed;
  END LOOP;
  RETURN n;
END $function$;