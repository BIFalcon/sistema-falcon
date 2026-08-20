CREATE OR REPLACE FUNCTION public.conc_auto_reconcile(_hotel_id text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_match_id uuid;
  v_actor uuid;
  v_count integer := 0;
BEGIN
  -- CARTÃO: adquirente x front (opera) — mesma data, mesma categoria, mesmo valor.
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
       AND o.d = a.d AND o.rn = a.rn
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
      VALUES (r.hotel_id, 'cartao', r.amount, r.amount, 0, 'Conciliação automática (par exato)', v_actor)
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

  -- PIX x EXTRATO — mesma data, mesmo valor.
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
       AND b.d = o.d AND b.rn = o.rn
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
      VALUES (r.hotel_id, 'pix_extrato', r.amount, r.amount, 0, 'Conciliação automática (par exato)', v_actor)
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

  RETURN v_count;
END;
$function$;