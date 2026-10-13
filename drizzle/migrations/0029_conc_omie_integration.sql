ALTER TABLE public.conc_acquirer_entries
  ADD COLUMN IF NOT EXISTS valor_liquido numeric,
  ADD COLUMN IF NOT EXISTS valor_original numeric,
  ADD COLUMN IF NOT EXISTS nsu text,
  ADD COLUMN IF NOT EXISTS prazo_recebimento text,
  ADD COLUMN IF NOT EXISTS codigo_reserva text,
  ADD COLUMN IF NOT EXISTS omie_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS omie_sent_by uuid;

CREATE OR REPLACE FUNCTION public.conc_fill_acquirer_extra(_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.conc_acquirer_entries a SET
    valor_liquido = COALESCE(a.valor_liquido, (r->>'valor_liquido')::numeric),
    valor_original = COALESCE(a.valor_original, (r->>'valor_original')::numeric),
    nsu = COALESCE(a.nsu, NULLIF(r->>'nsu','')),
    prazo_recebimento = COALESCE(a.prazo_recebimento, NULLIF(r->>'prazo_recebimento','')),
    codigo_reserva = COALESCE(a.codigo_reserva, NULLIF(r->>'codigo_reserva',''))
  FROM jsonb_array_elements(_rows) r
  WHERE a.entry_key = r->>'entry_key';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.conc_fill_acquirer_extra(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conc_fill_acquirer_extra(jsonb) TO authenticated, service_role;