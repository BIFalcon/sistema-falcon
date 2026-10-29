CREATE OR REPLACE FUNCTION public.conc_auto_reconcile_impl(_hotel_id text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD; v_match_id uuid; v_actor uuid; v_count integer := 0; v_ok boolean;
BEGIN
  LOOP
    v_ok := false;
    FOR r IN
      SELECT a.hotel_id, a.amount, a.id AS acquirer_id, o.id AS opera_id, (o.business_date - a.sale_date) AS dd
      FROM public.conc_acquirer_entries a
      JOIN public.conc_opera_entries o
        ON o.hotel_id = a.hotel_id
       AND public.conc_category_key(o.categoria_omie) = public.conc_category_key(a.categoria)
       AND o.amount = a.amount
       AND o.business_date BETWEEN a.sale_date - 1 AND a.sale_date + 1
      WHERE a.matched_at IS NULL AND a.sale_date IS NOT NULL AND coalesce(btrim(a.categoria), '') <> ''
        AND o.matched_at IS NULL AND o.business_date IS NOT NULL AND coalesce(btrim(o.categoria), '') <> ''
        AND o.direct_bank = false
        AND o.base_conciliacao = 'CARTAO'
        AND (_hotel_id IS NULL OR a.hotel_id = _hotel_id)
      ORDER BY abs(o.business_date - a.sale_date), a.sale_date, a.id, o.id
      LIMIT 2000
    LOOP
      -- Check both sides first (no provisional writes/undos that fire settlement triggers).
      PERFORM 1 FROM public.conc_acquirer_entries WHERE id = r.acquirer_id AND matched_at IS NULL FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN CONTINUE; END IF;
      PERFORM 1 FROM public.conc_opera_entries WHERE id = r.opera_id AND matched_at IS NULL FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN CONTINUE; END IF;
      v_actor := coalesce(auth.uid(), (SELECT u.uploaded_by FROM public.conc_opera_entries e JOIN public.conc_uploads u ON u.id = e.upload_id WHERE e.id = r.opera_id));
      IF v_actor IS NULL THEN CONTINUE; END IF;
      UPDATE public.conc_acquirer_entries SET matched_at = now() WHERE id = r.acquirer_id;
      UPDATE public.conc_opera_entries SET matched_at = now() WHERE id = r.opera_id;
      INSERT INTO public.conc_matches (hotel_id, kind, left_total, right_total, difference, note, matched_by)
      VALUES (r.hotel_id, 'cartao', r.amount, r.amount, 0, CASE WHEN r.dd = 0 THEN 'Conciliação automática (par exato)' ELSE 'Conciliação automática (par exato D' || CASE WHEN r.dd > 0 THEN '+1' ELSE '-1' END || ')' END, v_actor) RETURNING id INTO v_match_id;
      INSERT INTO public.conc_match_items (match_id, side, entry_id, amount)
      VALUES (v_match_id, 'acquirer', r.acquirer_id, r.amount), (v_match_id, 'opera', r.opera_id, r.amount);
      v_count := v_count + 1;
      v_ok := true;
    END LOOP;
    EXIT WHEN NOT v_ok;
  END LOOP;

  FOR r IN
    WITH base AS (
      SELECT id, hotel_id, business_date AS d, public.conc_category_key(categoria_omie) AS cat,
             upper(btrim(coalesce(guest_full_name, ''))) AS g, amount, base_conciliacao AS base
      FROM public.conc_opera_entries
      WHERE matched_at IS NULL AND business_date IS NOT NULL
        AND coalesce(btrim(categoria), '') <> '' AND direct_bank = false AND amount <> 0 AND base_conciliacao IN ('CARTAO','PIX','DINHEIRO')
        AND (_hotel_id IS NULL OR hotel_id = _hotel_id)
    ), p AS (
      SELECT *, row_number() OVER (PARTITION BY hotel_id, d, base, cat, g, abs(amount) ORDER BY id) AS rn FROM base WHERE amount > 0
    ), n AS (
      SELECT *, row_number() OVER (PARTITION BY hotel_id, d, base, cat, g, abs(amount) ORDER BY id) AS rn FROM base WHERE amount < 0
    )
    SELECT p.hotel_id, p.cat, p.base, p.amount, p.id AS pos_id, n.id AS neg_id
    FROM p JOIN n ON n.hotel_id = p.hotel_id AND n.d = p.d AND n.cat = p.cat AND n.base = p.base AND n.g = p.g AND -n.amount = p.amount AND n.rn = p.rn
  LOOP
    v_actor := coalesce(auth.uid(), (SELECT u.uploaded_by FROM public.conc_opera_entries e JOIN public.conc_uploads u ON u.id = e.upload_id WHERE e.id = r.pos_id));
    IF v_actor IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.conc_matches (hotel_id, kind, left_total, right_total, difference, note, matched_by)
    VALUES (r.hotel_id, CASE WHEN r.base = 'DINHEIRO' THEN 'dinheiro' WHEN r.base = 'PIX' THEN 'pix_extrato' ELSE 'cartao' END, 0, 0, 0, 'Conciliação automática (anulação no Opera)', v_actor)
    RETURNING id INTO v_match_id;
    INSERT INTO public.conc_match_items (match_id, side, entry_id, amount)
    VALUES (v_match_id, 'opera', r.pos_id, r.amount), (v_match_id, 'opera', r.neg_id, -r.amount);
    UPDATE public.conc_opera_entries SET matched_at = now() WHERE id IN (r.pos_id, r.neg_id);
    v_count := v_count + 1;
  END LOOP;

  FOR r IN
    WITH base AS (
      SELECT id, hotel_id, sale_date AS d, public.conc_category_key(categoria) AS cat, amount
      FROM public.conc_acquirer_entries
      WHERE matched_at IS NULL AND sale_date IS NOT NULL
        AND coalesce(btrim(categoria), '') <> '' AND amount <> 0
        AND (_hotel_id IS NULL OR hotel_id = _hotel_id)
    ), p AS (
      SELECT *, row_number() OVER (PARTITION BY hotel_id, d, cat, abs(amount) ORDER BY id) AS rn FROM base WHERE amount > 0
    ), n AS (
      SELECT *, row_number() OVER (PARTITION BY hotel_id, d, cat, abs(amount) ORDER BY id) AS rn FROM base WHERE amount < 0
    )
    SELECT p.hotel_id, p.amount, p.id AS pos_id, n.id AS neg_id
    FROM p JOIN n ON n.hotel_id = p.hotel_id AND n.d = p.d AND n.cat = p.cat AND -n.amount = p.amount AND n.rn = p.rn
  LOOP
    v_actor := coalesce(auth.uid(), (SELECT u.uploaded_by FROM public.conc_acquirer_entries e JOIN public.conc_uploads u ON u.id = e.upload_id WHERE e.id = r.pos_id));
    IF v_actor IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.conc_matches (hotel_id, kind, left_total, right_total, difference, note, matched_by)
    VALUES (r.hotel_id, 'cartao', 0, 0, 0, 'Conciliação automática (anulação na Adquirente)', v_actor) RETURNING id INTO v_match_id;
    INSERT INTO public.conc_match_items (match_id, side, entry_id, amount)
    VALUES (v_match_id, 'acquirer', r.pos_id, r.amount), (v_match_id, 'acquirer', r.neg_id, -r.amount);
    UPDATE public.conc_acquirer_entries SET matched_at = now() WHERE id IN (r.pos_id, r.neg_id);
    v_count := v_count + 1;
  END LOOP;

  FOR r IN
    WITH og AS (
      SELECT hotel_id, business_date AS d, public.conc_category_key(categoria_omie) AS cat,
             CASE WHEN coalesce(btrim(receipt_no), '') <> '' THEN 'R:' || btrim(receipt_no)
                  ELSE 'G:' || upper(btrim(guest_full_name)) END AS g,
             sum(amount) AS total, array_agg(id) AS ids
      FROM public.conc_opera_entries
      WHERE matched_at IS NULL AND business_date IS NOT NULL
        AND coalesce(btrim(categoria), '') <> '' AND direct_bank = false
        AND base_conciliacao = 'CARTAO'
        AND (coalesce(btrim(receipt_no), '') <> '' OR coalesce(btrim(guest_full_name), '') <> '')
        AND (_hotel_id IS NULL OR hotel_id = _hotel_id)
      GROUP BY 1, 2, 3, 4 HAVING count(*) >= 2
    ), og2 AS (
      SELECT *, row_number() OVER (PARTITION BY hotel_id, d, cat, total ORDER BY g) AS rn FROM og
    ), a AS (
      SELECT id, hotel_id, sale_date AS d, public.conc_category_key(categoria) AS cat, amount,
             row_number() OVER (PARTITION BY hotel_id, sale_date, public.conc_category_key(categoria), amount ORDER BY id) AS rn
      FROM public.conc_acquirer_entries
      WHERE matched_at IS NULL AND sale_date IS NOT NULL AND coalesce(btrim(categoria), '') <> ''
        AND (_hotel_id IS NULL OR hotel_id = _hotel_id)
    )
    SELECT og2.hotel_id, og2.g, og2.total, og2.ids, a.id AS acquirer_id
    FROM og2 JOIN a ON a.hotel_id = og2.hotel_id AND a.d = og2.d AND a.cat = og2.cat AND a.amount = og2.total AND a.rn = og2.rn
  LOOP
    SELECT NOT EXISTS (SELECT 1 FROM public.conc_opera_entries WHERE id = ANY(r.ids) AND matched_at IS NOT NULL)
       AND EXISTS (SELECT 1 FROM public.conc_acquirer_entries WHERE id = r.acquirer_id AND matched_at IS NULL)
      INTO v_ok;
    IF NOT v_ok THEN CONTINUE; END IF;
    v_actor := coalesce(auth.uid(), (SELECT u.uploaded_by FROM public.conc_acquirer_entries e JOIN public.conc_uploads u ON u.id = e.upload_id WHERE e.id = r.acquirer_id));
    IF v_actor IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.conc_matches (hotel_id, kind, left_total, right_total, difference, note, matched_by)
    VALUES (r.hotel_id, 'cartao', r.total, r.total, 0,
            CASE WHEN left(r.g, 2) = 'R:' THEN 'Conciliação automática (soma N:1 por recibo)' ELSE 'Conciliação automática (soma N:1)' END, v_actor)
    RETURNING id INTO v_match_id;
    INSERT INTO public.conc_match_items (match_id, side, entry_id, amount) VALUES (v_match_id, 'acquirer', r.acquirer_id, r.total);
    INSERT INTO public.conc_match_items (match_id, side, entry_id, amount)
    SELECT v_match_id, 'opera', e.id, e.amount FROM public.conc_opera_entries e WHERE e.id = ANY(r.ids);
    UPDATE public.conc_acquirer_entries SET matched_at = now() WHERE id = r.acquirer_id;
    UPDATE public.conc_opera_entries SET matched_at = now() WHERE id = ANY(r.ids);
    v_count := v_count + 1;
  END LOOP;

  LOOP
    v_ok := false;
    FOR r IN
      WITH o AS (
        SELECT id, hotel_id, business_date AS d, amount,
               row_number() OVER (PARTITION BY hotel_id, business_date, amount ORDER BY id) AS rn
        FROM public.conc_opera_entries
        WHERE matched_at IS NULL AND business_date IS NOT NULL
          AND base_conciliacao = 'PIX' AND direct_bank = false
          AND (_hotel_id IS NULL OR hotel_id = _hotel_id)
      ), b AS (
        SELECT id, hotel_id, line_date AS d, amount,
               row_number() OVER (PARTITION BY hotel_id, line_date, amount ORDER BY id) AS rn
        FROM public.conc_bank_entries
        WHERE matched_at IS NULL AND line_date IS NOT NULL AND public.conc_is_pix_bank(description) AND billing_pix = false
          AND (_hotel_id IS NULL OR hotel_id = _hotel_id)
      ), a AS (
        SELECT id, hotel_id, sale_date AS d, amount,
               row_number() OVER (PARTITION BY hotel_id, sale_date, amount ORDER BY id) AS rn
        FROM public.conc_acquirer_entries
        WHERE matched_at IS NULL AND sale_date IS NOT NULL
          AND lower(btrim(coalesce(categoria, ''))) LIKE '%pix%'
          AND (_hotel_id IS NULL OR hotel_id = _hotel_id)
      )
      SELECT o.hotel_id, o.amount, o.id AS opera_id, b.id AS bank_id, a.id AS acquirer_id
      FROM o JOIN b ON b.hotel_id = o.hotel_id AND b.amount = o.amount AND b.d = o.d AND b.rn = o.rn
      LEFT JOIN a ON a.hotel_id = o.hotel_id AND a.amount = o.amount AND a.d = o.d AND a.rn = o.rn
      ORDER BY o.d, o.id LIMIT 500
    LOOP
      v_actor := coalesce(auth.uid(), (SELECT u.uploaded_by FROM public.conc_opera_entries e JOIN public.conc_uploads u ON u.id = e.upload_id WHERE e.id = r.opera_id));
      IF v_actor IS NULL THEN CONTINUE; END IF;
      INSERT INTO public.conc_matches (hotel_id, kind, left_total, right_total, difference, note, matched_by)
      VALUES (r.hotel_id, 'pix_extrato', r.amount, r.amount, 0,
              CASE WHEN r.acquirer_id IS NULL THEN 'Conciliação automática (par exato)' ELSE 'Conciliação automática (Adquirente × Opera × Banco)' END, v_actor)
      RETURNING id INTO v_match_id;
      INSERT INTO public.conc_match_items (match_id, side, entry_id, amount)
      VALUES (v_match_id, 'opera', r.opera_id, r.amount), (v_match_id, 'bank', r.bank_id, r.amount);
      UPDATE public.conc_opera_entries SET matched_at = now() WHERE id = r.opera_id;
      UPDATE public.conc_bank_entries SET matched_at = now() WHERE id = r.bank_id;
      IF r.acquirer_id IS NOT NULL THEN
        INSERT INTO public.conc_match_items (match_id, side, entry_id, amount) VALUES (v_match_id, 'acquirer', r.acquirer_id, r.amount);
        UPDATE public.conc_acquirer_entries SET matched_at = now() WHERE id = r.acquirer_id;
      END IF;
      v_count := v_count + 1;
      v_ok := true;
    END LOOP;
    EXIT WHEN NOT v_ok;
  END LOOP;

  FOR r IN
    WITH m AS (
      SELECT cm.id AS match_id, cm.hotel_id, oe.business_date AS d, oe.amount,
             row_number() OVER (PARTITION BY cm.hotel_id, oe.business_date, oe.amount ORDER BY cm.id) AS rn
      FROM public.conc_matches cm
      JOIN public.conc_match_items mi ON mi.match_id = cm.id AND mi.side = 'opera'
      JOIN public.conc_opera_entries oe ON oe.id = mi.entry_id
      WHERE cm.kind = 'pix_extrato' AND (_hotel_id IS NULL OR cm.hotel_id = _hotel_id)
        AND (SELECT count(*) FROM public.conc_match_items x WHERE x.match_id = cm.id AND x.side = 'opera') = 1
        AND EXISTS (SELECT 1 FROM public.conc_match_items x WHERE x.match_id = cm.id AND x.side = 'bank')
        AND NOT EXISTS (SELECT 1 FROM public.conc_match_items x WHERE x.match_id = cm.id AND x.side = 'acquirer')
    ), a AS (
      SELECT id, hotel_id, sale_date AS d, amount,
             row_number() OVER (PARTITION BY hotel_id, sale_date, amount ORDER BY id) AS rn
      FROM public.conc_acquirer_entries
      WHERE matched_at IS NULL AND sale_date IS NOT NULL
        AND lower(btrim(coalesce(categoria, ''))) LIKE '%pix%'
        AND (_hotel_id IS NULL OR hotel_id = _hotel_id)
    )
    SELECT m.match_id, m.amount, a.id AS acquirer_id
    FROM m JOIN a ON a.hotel_id = m.hotel_id AND a.d = m.d AND a.amount = m.amount AND a.rn = m.rn
  LOOP
    INSERT INTO public.conc_match_items (match_id, side, entry_id, amount) VALUES (r.match_id, 'acquirer', r.acquirer_id, r.amount);
    UPDATE public.conc_acquirer_entries SET matched_at = now() WHERE id = r.acquirer_id;
    UPDATE public.conc_matches SET note = coalesce(note, '') || CASE WHEN note IS NULL THEN '' ELSE ' · ' END || 'Adquirente anexada automaticamente' WHERE id = r.match_id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;