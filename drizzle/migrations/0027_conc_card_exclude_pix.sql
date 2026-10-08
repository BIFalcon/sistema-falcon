DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.conc_auto_reconcile_impl'::regproc);
  d := replace(d, $x$          AND lower(btrim(categoria)) NOT LIKE '%dinheiro%'
          AND (_hotel_id IS NULL OR hotel_id = _hotel_id)
      )$x$, $x$          AND lower(btrim(categoria)) NOT LIKE '%dinheiro%'
          AND lower(btrim(categoria)) NOT LIKE '%pix%'
          AND (_hotel_id IS NULL OR hotel_id = _hotel_id)
      )$x$);
  EXECUTE d;
END $$;

-- Desfaz pares PIX classificados erroneamente como cartão
WITH bad AS (
  SELECT DISTINCT m.id FROM public.conc_matches m
  JOIN public.conc_match_items mi ON mi.match_id = m.id AND mi.side = 'opera'
  JOIN public.conc_opera_entries o ON o.id = mi.entry_id
  WHERE m.kind = 'cartao' AND lower(btrim(o.categoria)) LIKE '%pix%'
), items AS (
  SELECT mi.* FROM public.conc_match_items mi JOIN bad ON bad.id = mi.match_id
), u1 AS (
  UPDATE public.conc_opera_entries SET matched_at = NULL WHERE id IN (SELECT entry_id FROM items WHERE side='opera') RETURNING 1
), u2 AS (
  UPDATE public.conc_acquirer_entries SET matched_at = NULL WHERE id IN (SELECT entry_id FROM items WHERE side='acquirer') RETURNING 1
), u3 AS (
  UPDATE public.conc_bank_entries SET matched_at = NULL WHERE id IN (SELECT entry_id FROM items WHERE side='bank') RETURNING 1
), d1 AS (
  DELETE FROM public.conc_match_items WHERE match_id IN (SELECT id FROM bad) RETURNING 1
)
DELETE FROM public.conc_matches WHERE id IN (SELECT id FROM bad);