-- 1. permitir kind = 'dinheiro'
ALTER TABLE public.conc_matches DROP CONSTRAINT conc_matches_kind_check;
ALTER TABLE public.conc_matches ADD CONSTRAINT conc_matches_kind_check
  CHECK (kind = ANY (ARRAY['cartao'::text, 'pix_extrato'::text, 'dinheiro'::text]));

-- 2. conciliação manual atômica (uma única chamada)
CREATE OR REPLACE FUNCTION public.conc_reconcile_manual(
  _hotel_id text,
  _kind text,
  _items jsonb,
  _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match_id uuid;
  v_left numeric;
  v_right numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.can_access_conciliacao(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para conciliar';
  END IF;
  IF NOT public.can_view_hotel_data(auth.uid(), _hotel_id) THEN
    RAISE EXCEPTION 'Sem acesso a este hotel';
  END IF;

  SELECT
    coalesce(sum(CASE WHEN (i->>'position') = 'left' THEN (i->>'amount')::numeric END), 0),
    coalesce(sum(CASE WHEN (i->>'position') = 'right' THEN (i->>'amount')::numeric END), 0)
  INTO v_left, v_right
  FROM jsonb_array_elements(_items) i;

  INSERT INTO public.conc_matches (hotel_id, kind, left_total, right_total, difference, note, matched_by)
  VALUES (_hotel_id, _kind, v_left, v_right, v_left - v_right, _note, auth.uid())
  RETURNING id INTO v_match_id;

  INSERT INTO public.conc_match_items (match_id, side, entry_id, amount)
  SELECT v_match_id, i->>'side', (i->>'id')::uuid, (i->>'amount')::numeric
  FROM jsonb_array_elements(_items) i;

  UPDATE public.conc_opera_entries SET matched_at = now()
   WHERE id IN (SELECT (i->>'id')::uuid FROM jsonb_array_elements(_items) i WHERE i->>'side' = 'opera');
  UPDATE public.conc_acquirer_entries SET matched_at = now()
   WHERE id IN (SELECT (i->>'id')::uuid FROM jsonb_array_elements(_items) i WHERE i->>'side' = 'acquirer');
  UPDATE public.conc_bank_entries SET matched_at = now()
   WHERE id IN (SELECT (i->>'id')::uuid FROM jsonb_array_elements(_items) i WHERE i->>'side' = 'bank');

  RETURN v_match_id;
END;
$$;

REVOKE ALL ON FUNCTION public.conc_reconcile_manual(text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conc_reconcile_manual(text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conc_reconcile_manual(text, text, jsonb, text) TO service_role;

-- 3. conciliação automática: pares idênticos repetidos + tolerância de 1 dia
CREATE OR REPLACE FUNCTION public.conc_auto_reconcile(_hotel_id text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_match_id uuid;
  v_actor uuid;
  v_count integer := 0;
  v_tol integer;
BEGIN
  -- CARTÃO: adquirente x front (opera). Passo 1: mesma data. Passo 2: +/- 1 dia.
  FOR v_tol IN 0..1 LOOP
    LOOP
      FOR r IN
        WITH a AS (
          SELECT id, hotel_id, sale_date AS d, lower(btrim(categoria)) AS cat, amount,
                 row_number() OVER (PARTITION BY hotel_id, sale_date, lower(btrim(categoria)), amount ORDER BY id) AS rn
          FROM public.conc_acquirer_entries
          WHERE matched_at IS NULL AND sale_date IS NOT NULL
            AND coalesce(btrim(categoria), '') <> ''
            AND (_hotel_id IS NULL OR hotel_id = _hotel_id)
        ), o AS (
          SELECT id, hotel_id, business_date AS d, lower(btrim(categoria)) AS cat, amount,
                 row_number() OVER (PARTITION BY hotel_id, business_date, lower(btrim(categoria)), amount ORDER BY id) AS rn
          FROM public.conc_opera_entries
          WHERE matched_at IS NULL AND business_date IS NOT NULL
            AND coalesce(btrim(categoria), '') <> ''
            AND direct_bank = false
            AND lower(btrim(categoria)) NOT LIKE '%dinheiro%'
            AND (_hotel_id IS NULL OR hotel_id = _hotel_id)
        )
        SELECT a.hotel_id, a.amount, a.id AS acquirer_id, o.id AS opera_id
        FROM a JOIN o
          ON o.hotel_id = a.hotel_id AND o.cat = a.cat AND o.amount = a.amount
         AND abs(o.d - a.d) <= v_tol AND o.rn = a.rn
        ORDER BY a.d, a.id
        LIMIT 500
      LOOP
        v_actor := coalesce(
          auth.uid(),
          (SELECT u.uploaded_by FROM public.conc_opera_entries e
             JOIN public.conc_uploads u ON u.id = e.upload_id
            WHERE e.id = r.opera_id)
        );
        IF v_actor IS NULL THEN CONTINUE; END IF;

        INSERT INTO public.conc_matches (hotel_id, kind, left_total, right_total, difference, note, matched_by)
        VALUES (r.hotel_id, 'cartao', r.amount, r.amount, 0,
                CASE WHEN v_tol = 0 THEN 'Conciliação automática (par exato)'
                     ELSE 'Conciliação automática (par exato, data +/- 1 dia)' END,
                v_actor)
        RETURNING id INTO v_match_id;

        INSERT INTO public.conc_match_items (match_id, side, entry_id, amount)
        VALUES (v_match_id, 'acquirer', r.acquirer_id, r.amount),
               (v_match_id, 'opera', r.opera_id, r.amount);

        UPDATE public.conc_acquirer_entries SET matched_at = now() WHERE id = r.acquirer_id;
        UPDATE public.conc_opera_entries SET matched_at = now() WHERE id = r.opera_id;
        v_count := v_count + 1;
      END LOOP;
      EXIT WHEN NOT FOUND;
    END LOOP;
  END LOOP;

  -- PIX x EXTRATO
  FOR v_tol IN 0..1 LOOP
    LOOP
      FOR r IN
        WITH o AS (
          SELECT id, hotel_id, business_date AS d, amount,
                 row_number() OVER (PARTITION BY hotel_id, business_date, amount ORDER BY id) AS rn
          FROM public.conc_opera_entries
          WHERE matched_at IS NULL AND business_date IS NOT NULL
            AND lower(btrim(coalesce(categoria, ''))) LIKE '%pix%'
            AND direct_bank = false
            AND (_hotel_id IS NULL OR hotel_id = _hotel_id)
        ), b AS (
          SELECT id, hotel_id, line_date AS d, amount,
                 row_number() OVER (PARTITION BY hotel_id, line_date, amount ORDER BY id) AS rn
          FROM public.conc_bank_entries
          WHERE matched_at IS NULL AND line_date IS NOT NULL
            AND description ILIKE '%pix%'
            AND (_hotel_id IS NULL OR hotel_id = _hotel_id)
        )
        SELECT o.hotel_id, o.amount, o.id AS opera_id, b.id AS bank_id
        FROM o JOIN b
          ON b.hotel_id = o.hotel_id AND b.amount = o.amount
         AND abs(b.d - o.d) <= v_tol AND b.rn = o.rn
        ORDER BY o.d, o.id
        LIMIT 500
      LOOP
        v_actor := coalesce(
          auth.uid(),
          (SELECT u.uploaded_by FROM public.conc_opera_entries e
             JOIN public.conc_uploads u ON u.id = e.upload_id
            WHERE e.id = r.opera_id)
        );
        IF v_actor IS NULL THEN CONTINUE; END IF;

        INSERT INTO public.conc_matches (hotel_id, kind, left_total, right_total, difference, note, matched_by)
        VALUES (r.hotel_id, 'pix_extrato', r.amount, r.amount, 0,
                CASE WHEN v_tol = 0 THEN 'Conciliação automática (par exato)'
                     ELSE 'Conciliação automática (par exato, data +/- 1 dia)' END,
                v_actor)
        RETURNING id INTO v_match_id;

        INSERT INTO public.conc_match_items (match_id, side, entry_id, amount)
        VALUES (v_match_id, 'opera', r.opera_id, r.amount),
               (v_match_id, 'bank', r.bank_id, r.amount);

        UPDATE public.conc_opera_entries SET matched_at = now() WHERE id = r.opera_id;
        UPDATE public.conc_bank_entries SET matched_at = now() WHERE id = r.bank_id;
        v_count := v_count + 1;
      END LOOP;
      EXIT WHEN NOT FOUND;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.conc_auto_reconcile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conc_auto_reconcile(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conc_auto_reconcile(text) TO service_role;