CREATE TABLE public.conc_francesinha_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  upload_id uuid REFERENCES public.conc_uploads(id) ON DELETE CASCADE,
  entry_key text NOT NULL UNIQUE,
  data_movimento date, carteira text, pagador text, tipo text, nosso_numero text, seu_numero text,
  vencimento date, agencia_receb text, valor_inicial numeric, descricao_operacao text,
  operacoes_valor text, valor_final numeric,
  acao text,
  matched_ar_id uuid REFERENCES public.ar_to_invoice_entries(id) ON DELETE SET NULL,
  result text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conc_franc_hotel_idx ON public.conc_francesinha_entries (hotel_id, data_movimento);
CREATE INDEX conc_franc_nosso_idx ON public.conc_francesinha_entries (hotel_id, nosso_numero);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conc_francesinha_entries TO authenticated;
GRANT ALL ON public.conc_francesinha_entries TO service_role;
ALTER TABLE public.conc_francesinha_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "franc all" ON public.conc_francesinha_entries FOR ALL TO authenticated
  USING (public.can_access_conciliacao(auth.uid())) WITH CHECK (public.can_access_conciliacao(auth.uid()));
CREATE POLICY "franc read gg" ON public.conc_francesinha_entries FOR SELECT TO authenticated
  USING (public.can_justify_conciliacao(auth.uid(), hotel_id));

ALTER TABLE public.conc_uploads DROP CONSTRAINT conc_uploads_kind_check;
ALTER TABLE public.conc_uploads ADD CONSTRAINT conc_uploads_kind_check CHECK (kind = ANY (ARRAY['opera','acquirer','bank','b2b_receipts','rede_receipts','francesinha']));

ALTER TABLE public.ar_to_invoice_entries ADD COLUMN IF NOT EXISTS francesinha_status text;
ALTER TABLE public.ar_to_invoice_entries ADD COLUMN IF NOT EXISTS francesinha_at timestamptz;
ALTER TABLE public.ar_to_invoice_entries ADD COLUMN IF NOT EXISTS missing_docs_alerted_on date;

CREATE OR REPLACE FUNCTION public.ar_doc_number(t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(ltrim(regexp_replace(coalesce(t,''), '\D', '', 'g'), '0'), '')
$$;

-- Francesinha x Faturamento (ar_to_invoice_entries): seu número = nº do boleto/nota, mesmo valor; vencimento desempata.
CREATE OR REPLACE FUNCTION public.conc_francesinha_apply(p_hotel text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_ar uuid; v_paid int := 0; v_pend int := 0; v_info int := 0; v_adj int := 0;
  v_hotel text; v_body text := ''; v_liq boolean;
BEGIN
  IF NOT public.can_access_conciliacao(auth.uid()) THEN RAISE EXCEPTION 'sem permissão'; END IF;
  SELECT name INTO v_hotel FROM hotels WHERE id = p_hotel;

  FOR r IN SELECT * FROM conc_francesinha_entries WHERE hotel_id = p_hotel AND processed_at IS NULL
           ORDER BY data_movimento, (acao = 'liquidacao') DESC, id LOOP
    v_ar := NULL;
    IF r.acao IN ('liquidacao','baixa') AND public.ar_doc_number(r.seu_numero) IS NOT NULL THEN
      SELECT e.id INTO v_ar FROM ar_to_invoice_entries e
      WHERE e.hotel_id = p_hotel
        AND public.ar_doc_number(r.seu_numero) IN (public.ar_doc_number(e.boleto_number), public.ar_doc_number(e.nota_number))
        AND round(e.amount, 2) = round(r.valor_inicial, 2)
      ORDER BY (e.boleto_due_date = r.vencimento) DESC NULLS LAST, coalesce(e.is_paid,false), e.transaction_date
      LIMIT 1;
    END IF;

    IF r.acao = 'liquidacao' THEN
      IF v_ar IS NOT NULL THEN
        UPDATE ar_to_invoice_entries SET is_paid = true, paid_at = coalesce(paid_at, now()),
          paid_date = coalesce(paid_date, r.data_movimento),
          paid_note = coalesce(paid_note, 'Francesinha: liquidação em ' || to_char(r.data_movimento,'DD/MM/YYYY')),
          gg_status = 'pago', francesinha_status = 'liquidado', francesinha_at = now()
        WHERE id = v_ar;
        v_paid := v_paid + 1;
      END IF;
      UPDATE conc_francesinha_entries SET matched_ar_id = v_ar, processed_at = now(),
        result = CASE WHEN v_ar IS NULL THEN 'liquidado_sem_faturamento' ELSE 'baixa_dada' END WHERE id = r.id;
    ELSIF r.acao = 'baixa' THEN
      SELECT EXISTS (SELECT 1 FROM conc_francesinha_entries x WHERE x.hotel_id = p_hotel
        AND x.nosso_numero = r.nosso_numero AND x.acao = 'liquidacao') INTO v_liq;
      IF v_liq THEN
        UPDATE conc_francesinha_entries SET matched_ar_id = v_ar, processed_at = now(), result = 'baixa_apos_liquidacao' WHERE id = r.id;
      ELSE
        IF v_ar IS NOT NULL THEN
          UPDATE ar_to_invoice_entries SET francesinha_status = 'baixado_sem_pagamento', francesinha_at = now() WHERE id = v_ar;
        END IF;
        UPDATE conc_francesinha_entries SET matched_ar_id = v_ar, processed_at = now(), result = 'pendencia' WHERE id = r.id;
        v_body := v_body || E'\n- ' || coalesce(btrim(r.pagador),'—') || ' · seu nº ' || coalesce(r.seu_numero,'—') ||
          ' · venc. ' || coalesce(to_char(r.vencimento,'DD/MM/YYYY'),'—') || ' · R$ ' ||
          to_char(coalesce(r.valor_inicial,0), 'FM999G999G990D00');
        v_pend := v_pend + 1;
      END IF;
    ELSIF r.acao = 'entrada' THEN
      UPDATE conc_francesinha_entries SET processed_at = now(), result = 'informativo' WHERE id = r.id;
      v_info := v_info + 1;
    ELSE
      UPDATE conc_francesinha_entries SET processed_at = now(),
        result = CASE WHEN r.acao = 'ajuste' THEN 'ajuste' ELSE 'sem_acao' END WHERE id = r.id;
      IF r.acao = 'ajuste' THEN v_adj := v_adj + 1; END IF;
    END IF;
  END LOOP;

  IF v_pend > 0 THEN
    PERFORM public.enqueue_ar_notification('ar_boleto_baixado'::notification_event, p_hotel,
      ARRAY['gg','adm']::app_role[], ARRAY['controladoria','patronos']::app_role[],
      coalesce(v_hotel, p_hotel) || ' — ' || v_pend || ' boleto(s) baixado(s) sem pagamento',
      'A francesinha do banco mostra boletos **baixados sem liquidação** — o cliente não pagou e é preciso emitir **boleto novo**:' || v_body,
      '/financeiro/contas-receber', jsonb_build_object('count', v_pend));
  END IF;

  RETURN jsonb_build_object('paid', v_paid, 'pending', v_pend, 'info', v_info, 'adjustments', v_adj);
END $$;
REVOKE EXECUTE ON FUNCTION public.conc_francesinha_apply(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.conc_francesinha_apply(text) TO authenticated;

-- Alerta diário: "a faturar" sem nota/boleto/comprovante a partir do 3º dia (só lançamentos desde 01/10/2026).
CREATE OR REPLACE FUNCTION public.enqueue_ar_missing_docs_alerts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h record; v int := 0; v_body text;
BEGIN
  FOR h IN
    SELECT e.hotel_id, max(ht.name) AS name, count(*) AS n,
      string_agg('- ' || coalesce(e.account_name,'—') || ' · conta ' || coalesce(e.invoice_number,'—') || ' · ' ||
        to_char(e.transaction_date,'DD/MM/YYYY') || ' · R$ ' || to_char(coalesce(e.amount,0),'FM999G999G990D00'), E'\n'
        ORDER BY e.transaction_date) AS lines,
      array_agg(e.id) AS ids
    FROM ar_to_invoice_entries e JOIN hotels ht ON ht.id = e.hotel_id
    WHERE e.transaction_date >= DATE '2026-10-01'
      AND e.transaction_date <= current_date - 3
      AND coalesce(e.is_paid,false) = false AND coalesce(e.is_not_billable,false) = false
      AND e.invoice_file_1 IS NULL AND e.invoice_file_2 IS NULL AND e.proof_file IS NULL
      AND e.missing_docs_alerted_on IS DISTINCT FROM current_date
    GROUP BY e.hotel_id
  LOOP
    v_body := 'Lançamentos **a faturar** há 3 dias ou mais sem nota, boleto ou comprovante anexado:' || E'\n' || h.lines;
    v := v + public.enqueue_ar_notification('ar_to_invoice_missing_docs'::notification_event, h.hotel_id,
      ARRAY['gg','adm']::app_role[], ARRAY['controladoria','patronos']::app_role[],
      coalesce(h.name, h.hotel_id) || ' — ' || h.n || ' faturamento(s) sem documento', v_body,
      '/financeiro/contas-receber', jsonb_build_object('count', h.n));
    UPDATE ar_to_invoice_entries SET missing_docs_alerted_on = current_date WHERE id = ANY (h.ids);
  END LOOP;
  RETURN v;
END $$;

-- E-mail semanal (quarta): boleto anexado sem vencimento lido, para o time de Contas a Receber.
CREATE OR REPLACE FUNCTION public.enqueue_ar_missing_due_date_weekly()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lines text; v_n int;
BEGIN
  SELECT count(*), string_agg('- ' || coalesce(ht.name, e.hotel_id) || ' · ' || coalesce(e.account_name,'—') ||
      ' · conta ' || coalesce(e.invoice_number,'—') || ' · boleto ' || coalesce(e.boleto_number,'—') ||
      ' · R$ ' || to_char(coalesce(e.amount,0),'FM999G999G990D00'), E'\n' ORDER BY ht.name, e.transaction_date)
  INTO v_n, v_lines
  FROM ar_to_invoice_entries e LEFT JOIN hotels ht ON ht.id = e.hotel_id
  WHERE (e.boleto_number IS NOT NULL OR e.invoice_file_2 IS NOT NULL)
    AND e.boleto_due_date IS NULL AND coalesce(e.is_paid,false) = false AND coalesce(e.is_not_billable,false) = false;
  IF coalesce(v_n,0) = 0 THEN RETURN 0; END IF;
  RETURN public.enqueue_ar_notification('ar_boleto_missing_due_date'::notification_event, NULL,
    NULL, ARRAY['controladoria','patronos']::app_role[],
    'Contas a Receber — ' || v_n || ' boleto(s) sem vencimento lido',
    'Boletos anexados em que o sistema **não conseguiu ler a data de vencimento**:' || E'\n' || v_lines,
    '/financeiro/contas-receber', jsonb_build_object('count', v_n));
END $$;

REVOKE EXECUTE ON FUNCTION public.enqueue_ar_missing_docs_alerts() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_ar_missing_due_date_weekly() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_ar_missing_docs_alerts() TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_ar_missing_due_date_weekly() TO service_role;

SELECT cron.schedule('ar-missing-docs-daily', '17 11 * * *', 'SELECT public.enqueue_ar_missing_docs_alerts();');
SELECT cron.schedule('ar-missing-due-date-weekly', '23 11 * * 3', 'SELECT public.enqueue_ar_missing_due_date_weekly();');