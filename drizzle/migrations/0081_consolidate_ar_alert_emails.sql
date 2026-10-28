CREATE OR REPLACE FUNCTION public.enqueue_ar_consolidated(_event notification_event, _groups jsonb, _roles_for_hotel app_role[], _roles_global app_role[], _title text, _intro text, _link_url text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v int := 0; v_body text; v_total int;
BEGIN
  IF _groups IS NULL OR jsonb_array_length(_groups) = 0 THEN RETURN 0; END IF;
  FOR r IN
    WITH g AS (SELECT * FROM jsonb_to_recordset(_groups) AS x(hotel_id text, name text, n int, lines text)),
    rec AS (
      SELECT u.user_id, u.email, rr::text AS role, g.hotel_id
        FROM g, unnest(coalesce(_roles_for_hotel, '{}'::app_role[])) rr, LATERAL public.users_with_role_for_hotel(rr, g.hotel_id) u
      UNION
      SELECT u.user_id, u.email, rr::text, g.hotel_id
        FROM unnest(coalesce(_roles_global, '{}'::app_role[])) rr, LATERAL public.users_with_role_global(rr) u, g
    )
    SELECT rec.user_id, max(rec.email) AS email, min(rec.role) AS role, array_agg(DISTINCT rec.hotel_id ORDER BY rec.hotel_id) AS hotels
    FROM rec WHERE rec.user_id IS NOT NULL AND rec.email IS NOT NULL GROUP BY rec.user_id
  LOOP
    IF public.is_unsubscribed(r.user_id, _event) THEN CONTINUE; END IF;
    SELECT string_agg('**' || coalesce(g.name, g.hotel_id) || '** (' || g.n || ')' || E'\n' || g.lines, E'\n\n' ORDER BY g.name), sum(g.n)
      INTO v_body, v_total
      FROM jsonb_to_recordset(_groups) AS g(hotel_id text, name text, n int, lines text) WHERE g.hotel_id = ANY (r.hotels);
    INSERT INTO public.notification_queue (event, closing_id, hotel_id, recipient_user_id, recipient_email, recipient_role, subject, body_md, link_url, payload)
    VALUES (_event, NULL, r.hotels[1], r.user_id, r.email, r.role,
      _title || ' — ' || v_total || ' pendência(s) em ' || array_length(r.hotels, 1) || ' hotel(is)',
      _intro || E'\n\n' || v_body, _link_url,
      jsonb_build_object('count', v_total, 'hotels', to_jsonb(r.hotels), 'consolidated', true));
    v := v + 1;
  END LOOP;
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION public.enqueue_ar_consolidated(notification_event, jsonb, app_role[], app_role[], text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_ar_missing_docs_alerts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_groups jsonb; v_ids uuid[]; v int;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('hotel_id', hotel_id, 'name', name, 'n', n, 'lines', lines)), array_agg(ids_one)
    INTO v_groups, v_ids
  FROM (
    SELECT e.hotel_id, max(ht.name) AS name, count(*)::int AS n,
      string_agg('- ' || coalesce(e.account_name,'—') || ' · conta ' || coalesce(e.invoice_number,'—') || ' · ' ||
        to_char(e.transaction_date,'DD/MM/YYYY') || ' · R$ ' || to_char(coalesce(e.amount,0),'FM999G999G990D00'), E'\n'
        ORDER BY e.transaction_date) AS lines,
      NULL::uuid AS ids_one
    FROM ar_to_invoice_entries e JOIN hotels ht ON ht.id = e.hotel_id
    WHERE e.transaction_date >= DATE '2026-10-01' AND e.transaction_date <= current_date - 3
      AND coalesce(e.is_paid,false) = false AND coalesce(e.is_not_billable,false) = false
      AND e.invoice_file_1 IS NULL AND e.invoice_file_2 IS NULL AND e.proof_file IS NULL
      AND e.missing_docs_alerted_on IS DISTINCT FROM current_date
    GROUP BY e.hotel_id
  ) s;
  v := public.enqueue_ar_consolidated('ar_to_invoice_missing_docs'::notification_event, v_groups,
    ARRAY['gg','adm']::app_role[], ARRAY['controladoria','patronos']::app_role[],
    'Faturamentos sem documento',
    'Lançamentos **a faturar** há 3 dias ou mais sem nota, boleto ou comprovante anexado:',
    '/financeiro/contas-receber');
  UPDATE ar_to_invoice_entries e SET missing_docs_alerted_on = current_date
  WHERE e.transaction_date >= DATE '2026-10-01' AND e.transaction_date <= current_date - 3
    AND coalesce(e.is_paid,false) = false AND coalesce(e.is_not_billable,false) = false
    AND e.invoice_file_1 IS NULL AND e.invoice_file_2 IS NULL AND e.proof_file IS NULL
    AND e.missing_docs_alerted_on IS DISTINCT FROM current_date;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_ar_missing_due_date_weekly()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_groups jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('hotel_id', hotel_id, 'name', name, 'n', n, 'lines', lines)) INTO v_groups
  FROM (
    SELECT e.hotel_id, max(ht.name) AS name, count(*)::int AS n,
      string_agg('- ' || coalesce(e.account_name,'—') || ' · conta ' || coalesce(e.invoice_number,'—') ||
        ' · boleto ' || coalesce(e.boleto_number,'—') || ' · R$ ' || to_char(coalesce(e.amount,0),'FM999G999G990D00'),
        E'\n' ORDER BY e.transaction_date) AS lines
    FROM ar_to_invoice_entries e LEFT JOIN hotels ht ON ht.id = e.hotel_id
    WHERE (e.boleto_number IS NOT NULL OR e.invoice_file_2 IS NOT NULL)
      AND e.boleto_due_date IS NULL AND coalesce(e.is_paid,false) = false AND coalesce(e.is_not_billable,false) = false
    GROUP BY e.hotel_id
  ) s;
  RETURN public.enqueue_ar_consolidated('ar_boleto_missing_due_date'::notification_event, v_groups,
    NULL, ARRAY['controladoria','patronos']::app_role[],
    'Boletos sem vencimento lido',
    'Boletos anexados em que o sistema **não conseguiu ler a data de vencimento**:',
    '/financeiro/contas-receber');
END $$;