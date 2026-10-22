CREATE TABLE public.conc_rede_pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  upload_id uuid REFERENCES public.conc_uploads(id) ON DELETE CASCADE,
  entry_key text NOT NULL UNIQUE,
  data_recebimento date, data_original_venda date, data_original_vencimento date,
  valor_bruto_parcela_original numeric, valor_bruto_parcela_atualizada numeric,
  taxa_mdr numeric, valor_mdr numeric, valor_liquido_parcela numeric,
  nsu_cv text, modalidade text, bandeira text, banco text, agencia text, conta_corrente text, status text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conc_rede_pag_hotel_idx ON public.conc_rede_pagamentos (hotel_id, data_recebimento);

CREATE TABLE public.conc_rede_recebidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  upload_id uuid REFERENCES public.conc_uploads(id) ON DELETE CASCADE,
  entry_key text NOT NULL UNIQUE,
  data date, bandeira text, modalidade text, valor_depositado numeric, status text,
  matched_bank_id uuid REFERENCES public.conc_bank_entries(id) ON DELETE SET NULL,
  matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conc_rede_rec_hotel_idx ON public.conc_rede_recebidos (hotel_id, data);

CREATE TABLE public.conc_rede_ajustes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  upload_id uuid REFERENCES public.conc_uploads(id) ON DELETE CASCADE,
  entry_key text NOT NULL UNIQUE,
  data_ajuste date, motivo text, valor_cobrado numeric, bandeira text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conc_rede_aj_hotel_idx ON public.conc_rede_ajustes (hotel_id, data_ajuste);

CREATE TABLE public.conc_rede_chargebacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  upload_id uuid REFERENCES public.conc_uploads(id) ON DELETE CASCADE,
  entry_key text NOT NULL UNIQUE,
  data_debito date, tipo text, data_original_venda date, valor_original_venda numeric, valor_descontado numeric,
  motivo_cancelamento text, nsu_cv text, bandeira text, modalidade text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conc_rede_cb_hotel_idx ON public.conc_rede_chargebacks (hotel_id, data_debito);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conc_rede_pagamentos, public.conc_rede_recebidos, public.conc_rede_ajustes, public.conc_rede_chargebacks TO authenticated;
GRANT ALL ON public.conc_rede_pagamentos, public.conc_rede_recebidos, public.conc_rede_ajustes, public.conc_rede_chargebacks TO service_role;

ALTER TABLE public.conc_rede_pagamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conc_rede_recebidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conc_rede_ajustes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conc_rede_chargebacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rede pag all" ON public.conc_rede_pagamentos FOR ALL TO authenticated USING (public.can_access_conciliacao(auth.uid())) WITH CHECK (public.can_access_conciliacao(auth.uid()));
CREATE POLICY "rede pag read gg" ON public.conc_rede_pagamentos FOR SELECT TO authenticated USING (public.can_justify_conciliacao(auth.uid(), hotel_id));
CREATE POLICY "rede rec all" ON public.conc_rede_recebidos FOR ALL TO authenticated USING (public.can_access_conciliacao(auth.uid())) WITH CHECK (public.can_access_conciliacao(auth.uid()));
CREATE POLICY "rede rec read gg" ON public.conc_rede_recebidos FOR SELECT TO authenticated USING (public.can_justify_conciliacao(auth.uid(), hotel_id));
CREATE POLICY "rede aj all" ON public.conc_rede_ajustes FOR ALL TO authenticated USING (public.can_access_conciliacao(auth.uid())) WITH CHECK (public.can_access_conciliacao(auth.uid()));
CREATE POLICY "rede aj read gg" ON public.conc_rede_ajustes FOR SELECT TO authenticated USING (public.can_justify_conciliacao(auth.uid(), hotel_id));
CREATE POLICY "rede cb all" ON public.conc_rede_chargebacks FOR ALL TO authenticated USING (public.can_access_conciliacao(auth.uid())) WITH CHECK (public.can_access_conciliacao(auth.uid()));
CREATE POLICY "rede cb read gg" ON public.conc_rede_chargebacks FOR SELECT TO authenticated USING (public.can_justify_conciliacao(auth.uid(), hotel_id));

ALTER TABLE public.conc_uploads DROP CONSTRAINT conc_uploads_kind_check;
ALTER TABLE public.conc_uploads ADD CONSTRAINT conc_uploads_kind_check CHECK (kind = ANY (ARRAY['opera','acquirer','bank','b2b_receipts','rede_receipts']));

-- Baixa Rede: recebidos (já agregados por dia+bandeira+modalidade) x crédito no banco.
-- p_brand_map / p_mod_map: {"MASTERCARD":"MAST",...} / {"DEBITO":"DB",...} (centralizados no front).
CREATE OR REPLACE FUNCTION public.conc_rede_auto_match(p_hotel text, p_bank_prefix text, p_brand_map jsonb, p_mod_map jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v int := 0; r record; b uuid; v_brand text; v_mod text;
BEGIN
  IF NOT public.can_access_conciliacao(auth.uid()) THEN RAISE EXCEPTION 'sem permissão'; END IF;
  FOR r IN SELECT id, data, bandeira, modalidade, valor_depositado FROM conc_rede_recebidos
           WHERE hotel_id = p_hotel AND matched_bank_id IS NULL AND coalesce(valor_depositado,0) > 0
           ORDER BY data, id LOOP
    v_brand := p_brand_map ->> upper(public.unaccent_safe(r.bandeira));
    v_mod := p_mod_map ->> upper(public.unaccent_safe(r.modalidade));
    b := NULL;
    SELECT be.id INTO b FROM conc_bank_entries be
    WHERE be.hotel_id = p_hotel AND be.matched_at IS NULL AND be.amount > 0
      AND round(be.amount, 2) = round(r.valor_depositado, 2)
      AND upper(btrim(be.description)) LIKE upper(p_bank_prefix) || '%'
      AND (v_brand IS NULL OR upper(be.description) LIKE '%' || v_brand || '%')
      AND (v_mod IS NULL OR upper(be.description) ~ (' (' || v_mod || ')[0-9]'))
      AND be.line_date BETWEEN r.data - 1 AND r.data + 3
    ORDER BY abs(be.line_date - r.data), be.line_date, be.id LIMIT 1;
    IF b IS NOT NULL THEN
      UPDATE conc_bank_entries SET matched_at = now() WHERE id = b;
      UPDATE conc_rede_recebidos SET matched_bank_id = b, matched_at = now() WHERE id = r.id;
      v := v + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('matched', v);
END $$;

CREATE OR REPLACE FUNCTION public.unaccent_safe(t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT translate(coalesce(t,''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')
$$;

CREATE OR REPLACE FUNCTION public.conc_rede_unmatch(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_bank uuid;
BEGIN
  IF NOT public.can_access_conciliacao(auth.uid()) THEN RAISE EXCEPTION 'sem permissão'; END IF;
  SELECT matched_bank_id INTO v_bank FROM conc_rede_recebidos WHERE id = p_id;
  IF v_bank IS NOT NULL THEN UPDATE conc_bank_entries SET matched_at = NULL WHERE id = v_bank; END IF;
  UPDATE conc_rede_recebidos SET matched_bank_id = NULL, matched_at = NULL WHERE id = p_id;
END $$;

GRANT EXECUTE ON FUNCTION public.conc_rede_auto_match(text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conc_rede_unmatch(uuid) TO authenticated;