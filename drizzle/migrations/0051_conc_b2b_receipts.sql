CREATE TABLE public.conc_b2b_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  upload_id uuid REFERENCES public.conc_uploads(id) ON DELETE CASCADE,
  entry_key text NOT NULL UNIQUE,
  data_operacao date,
  tipo_lancamento text,
  descricao text,
  valor_total_transacao numeric,
  valor_comissao numeric,
  valor_incentivo numeric,
  valor_taxa_servico numeric,
  valor_recebivel_bruto numeric,
  valor_taxa_adquirencia numeric,
  valor_recebivel_liquido numeric,
  chave_transacao text,
  nsu_autorizacao text,
  data_transacao date,
  identificador_pedido text,
  forma_pagamento text,
  bandeira text,
  numero_cartao text,
  localizador_reserva text,
  matched_acquirer_id uuid REFERENCES public.conc_acquirer_entries(id) ON DELETE SET NULL,
  deposit_id uuid REFERENCES public.conc_b2b_receipts(id) ON DELETE SET NULL,
  matched_bank_id uuid REFERENCES public.conc_bank_entries(id) ON DELETE SET NULL,
  matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conc_b2b_receipts_hotel_idx ON public.conc_b2b_receipts (hotel_id, tipo_lancamento, data_operacao);
CREATE INDEX conc_b2b_receipts_loc_idx ON public.conc_b2b_receipts (hotel_id, localizador_reserva);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conc_b2b_receipts TO authenticated;
GRANT ALL ON public.conc_b2b_receipts TO service_role;
ALTER TABLE public.conc_b2b_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conc b2b receipts all" ON public.conc_b2b_receipts FOR ALL TO authenticated
  USING (public.can_access_conciliacao(auth.uid())) WITH CHECK (public.can_access_conciliacao(auth.uid()));
CREATE POLICY "conc b2b receipts read gg" ON public.conc_b2b_receipts FOR SELECT TO authenticated
  USING (public.can_justify_conciliacao(auth.uid(), hotel_id));

ALTER TABLE public.conc_uploads DROP CONSTRAINT conc_uploads_kind_check;
ALTER TABLE public.conc_uploads ADD CONSTRAINT conc_uploads_kind_check CHECK (kind = ANY (ARRAY['opera','acquirer','bank','b2b_receipts']));

-- Baixa B2B: venda x recebimento pelo localizador; lote (deposit) x banco por valor líquido + data.
CREATE OR REPLACE FUNCTION public.conc_b2b_auto_match(p_hotel text, p_bank_prefix text DEFAULT 'ZOP')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_sales int := 0; v_lots int := 0; v_dep int := 0; r record; b uuid;
BEGIN
  IF NOT public.can_access_conciliacao(auth.uid()) THEN RAISE EXCEPTION 'sem permissão'; END IF;

  -- 1) venda (charge) x venda B2B pelo localizador da reserva
  WITH c AS (
    SELECT DISTINCT ON (rc.id) rc.id, a.id AS aid
    FROM conc_b2b_receipts rc
    JOIN conc_acquirer_entries a ON a.hotel_id = rc.hotel_id AND a.source = 'b2b'
      AND btrim(a.codigo_reserva) = btrim(rc.localizador_reserva)
    WHERE rc.hotel_id = p_hotel AND rc.tipo_lancamento = 'charge'
      AND rc.matched_acquirer_id IS NULL AND coalesce(rc.localizador_reserva,'') <> ''
    ORDER BY rc.id, (a.amount = rc.valor_total_transacao) DESC, a.sale_date
  )
  UPDATE conc_b2b_receipts t SET matched_acquirer_id = c.aid FROM c WHERE t.id = c.id;
  GET DIAGNOSTICS v_sales = ROW_COUNT;

  -- 2) charges sem lote -> deposit do mesmo dia de operação
  UPDATE conc_b2b_receipts t SET deposit_id = d.id
  FROM conc_b2b_receipts d
  WHERE t.hotel_id = p_hotel AND t.tipo_lancamento = 'charge' AND t.deposit_id IS NULL
    AND d.hotel_id = t.hotel_id AND d.tipo_lancamento = 'deposit' AND d.data_operacao = t.data_operacao;
  GET DIAGNOSTICS v_lots = ROW_COUNT;

  -- 3) deposit x banco: valor líquido = crédito no banco, data mais próxima (todas as pendentes)
  FOR r IN SELECT id, data_operacao, abs(valor_recebivel_liquido) AS v FROM conc_b2b_receipts
           WHERE hotel_id = p_hotel AND tipo_lancamento = 'deposit' AND matched_bank_id IS NULL
             AND valor_recebivel_liquido IS NOT NULL ORDER BY data_operacao LOOP
    SELECT be.id INTO b FROM conc_bank_entries be
    WHERE be.hotel_id = p_hotel AND be.matched_at IS NULL AND be.amount > 0
      AND round(be.amount, 2) = round(r.v, 2)
      AND (p_bank_prefix IS NULL OR upper(btrim(be.description)) LIKE upper(p_bank_prefix) || '%')
      AND be.line_date BETWEEN r.data_operacao - 5 AND r.data_operacao + 10
    ORDER BY abs(be.line_date - r.data_operacao), be.line_date LIMIT 1;
    IF b IS NOT NULL THEN
      UPDATE conc_bank_entries SET matched_at = now() WHERE id = b;
      UPDATE conc_b2b_receipts SET matched_bank_id = b, matched_at = now() WHERE id = r.id;
      UPDATE conc_b2b_receipts SET matched_at = now() WHERE deposit_id = r.id AND matched_at IS NULL;
      v_dep := v_dep + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('sales_linked', v_sales, 'lots_linked', v_lots, 'deposits_matched', v_dep);
END $$;

CREATE OR REPLACE FUNCTION public.conc_b2b_unmatch_deposit(p_deposit uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_bank uuid;
BEGIN
  IF NOT public.can_access_conciliacao(auth.uid()) THEN RAISE EXCEPTION 'sem permissão'; END IF;
  SELECT matched_bank_id INTO v_bank FROM conc_b2b_receipts WHERE id = p_deposit;
  IF v_bank IS NOT NULL THEN UPDATE conc_bank_entries SET matched_at = NULL WHERE id = v_bank; END IF;
  UPDATE conc_b2b_receipts SET matched_bank_id = NULL, matched_at = NULL WHERE id = p_deposit;
  UPDATE conc_b2b_receipts SET matched_at = NULL WHERE deposit_id = p_deposit;
END $$;

GRANT EXECUTE ON FUNCTION public.conc_b2b_auto_match(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conc_b2b_unmatch_deposit(uuid) TO authenticated;