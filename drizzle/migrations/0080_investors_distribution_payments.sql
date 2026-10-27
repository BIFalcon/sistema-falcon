CREATE TABLE public.inv_payer_accounts (
  hotel_id text PRIMARY KEY REFERENCES public.hotels(id),
  razao_social text NOT NULL,
  cnpj text NOT NULL,
  agencia text NOT NULL,
  conta text NOT NULL,
  dac text NOT NULL,
  endereco text, numero text, complemento text, cidade text, cep text, uf text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.inv_payer_accounts TO service_role;
ALTER TABLE public.inv_payer_accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.inv_payment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  year int NOT NULL,
  valor_por_uh numeric(14,2) NOT NULL,
  valor_fonte text NOT NULL DEFAULT 'dre' CHECK (valor_fonte IN ('dre','manual')),
  data_pagamento date NOT NULL,
  remessas int NOT NULL DEFAULT 0,
  last_remessa_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, month, year)
);
GRANT ALL ON public.inv_payment_batches TO service_role;
ALTER TABLE public.inv_payment_batches ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.inv_payment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.inv_payment_batches(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.units(id),
  link_id uuid REFERENCES public.unit_investor_links(id),
  investor_id uuid REFERENCES public.investors(id),
  payee_id uuid REFERENCES public.investor_payees(id),
  codigo_uh text NOT NULL,
  investidor_nome text,
  favorecido_nome text,
  percentual numeric(7,4),
  valor numeric(14,2) NOT NULL,
  status text NOT NULL DEFAULT 'pronto' CHECK (status IN ('pronto','bloqueado','enviado','agendado','pago','rejeitado')),
  motivo text,
  forma text CHECK (forma IS NULL OR forma IN ('pix','cc_itau','poupanca_itau','ted')),
  seu_numero text UNIQUE,
  ocorrencias text,
  valor_pago numeric(14,2),
  data_pago date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inv_payment_items_batch_idx ON public.inv_payment_items(batch_id);
GRANT ALL ON public.inv_payment_items TO service_role;
ALTER TABLE public.inv_payment_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.inv_can_pay(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.inv_is_finance(_uid) OR public.inv_can_edit(_uid);
$$;
CREATE OR REPLACE FUNCTION public.inv_can_send(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.inv_is_finance(_uid) OR (public.inv_can_edit(_uid) AND public.inv_can_view_full(_uid));
$$;

CREATE OR REPLACE FUNCTION public.inv_dre_valor_por_uh(_hotel_id text, _month int, _year int) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT round(l.line_value::numeric, 2)
    FROM public.closings c JOIN public.dre_parsed_lines l ON l.closing_id = c.id
   WHERE c.hotel_id = _hotel_id AND c.month = _month AND c.year = _year
     AND l.line_type = 'indicator' AND l.line_label ILIKE '[distribuicao_por_uh]%'
   ORDER BY l.version_number DESC LIMIT 1;
$$;

-- Situação do favorecido para pagamento: forma escolhida ou motivo do bloqueio
CREATE OR REPLACE FUNCTION public.inv_payee_payment_check(p public.investor_payees, OUT forma text, OUT motivo text)
LANGUAGE plpgsql STABLE AS $$
DECLARE v_doc text := regexp_replace(coalesce(p.documento_favorecido,''),'\D','','g');
BEGIN
  IF p.id IS NULL THEN motivo := 'sem favorecido'; RETURN; END IF;
  IF length(v_doc) NOT IN (11,14) THEN motivo := 'CPF/CNPJ do favorecido ausente ou inválido'; RETURN; END IF;
  IF coalesce(p.chave_pix,'') <> '' AND coalesce(p.tipo_chave_pix,'') <> '' THEN forma := 'pix'; RETURN; END IF;
  IF coalesce(p.banco_codigo,'') <> '' AND coalesce(p.agencia,'') <> '' AND coalesce(p.conta,'') <> '' THEN
    IF p.tipo_conta IS NULL THEN motivo := 'tipo de conta (corrente/poupança) não informado'; RETURN; END IF;
    IF p.conta !~ '^\d{1,13}-[\dXx]$' THEN motivo := 'conta sem dígito (formato 12345-6)'; RETURN; END IF;
    IF p.banco_codigo = '341' THEN forma := CASE WHEN p.tipo_conta = 'poupanca' THEN 'poupanca_itau' ELSE 'cc_itau' END;
    ELSIF p.tipo_conta = 'poupanca' THEN motivo := 'poupança em outro banco: informe uma chave PIX'; RETURN;
    ELSE forma := 'ted'; END IF;
    RETURN;
  END IF;
  motivo := 'sem chave PIX nem conta bancária completa';
END $$;

CREATE OR REPLACE FUNCTION public.inv_payer_get(_hotel_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.inv_can_pay(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN (SELECT to_jsonb(a) - 'updated_by' FROM public.inv_payer_accounts a WHERE hotel_id = _hotel_id);
END $$;

CREATE OR REPLACE FUNCTION public.inv_payer_save(_hotel_id text, _d jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cnpj text := regexp_replace(coalesce(_d->>'cnpj',''),'\D','','g');
  v_ag text := regexp_replace(coalesce(_d->>'agencia',''),'\D','','g'); v_ct text := regexp_replace(coalesce(_d->>'conta',''),'\D','','g');
  v_dac text := upper(trim(coalesce(_d->>'dac','')));
BEGIN
  IF NOT public.inv_can_send(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para alterar a conta pagadora'; END IF;
  IF length(v_cnpj) <> 14 THEN RAISE EXCEPTION 'CNPJ da empresa pagadora inválido'; END IF;
  IF v_ag = '' OR length(v_ag) > 5 THEN RAISE EXCEPTION 'Agência inválida'; END IF;
  IF v_ct = '' OR length(v_ct) > 12 THEN RAISE EXCEPTION 'Conta inválida'; END IF;
  IF v_dac !~ '^[0-9X]$' THEN RAISE EXCEPTION 'Dígito da conta inválido'; END IF;
  IF coalesce(trim(_d->>'razao_social'),'') = '' THEN RAISE EXCEPTION 'Informe a razão social'; END IF;
  INSERT INTO public.inv_payer_accounts(hotel_id, razao_social, cnpj, agencia, conta, dac, endereco, numero, complemento, cidade, cep, uf, updated_by, updated_at)
  VALUES (_hotel_id, upper(trim(_d->>'razao_social')), v_cnpj, v_ag, v_ct, v_dac, nullif(upper(trim(_d->>'endereco')),''), nullif(trim(_d->>'numero'),''),
    nullif(upper(trim(_d->>'complemento')),''), nullif(upper(trim(_d->>'cidade')),''), nullif(regexp_replace(coalesce(_d->>'cep',''),'\D','','g'),''), nullif(upper(trim(_d->>'uf')),''), auth.uid(), now())
  ON CONFLICT (hotel_id) DO UPDATE SET razao_social = EXCLUDED.razao_social, cnpj = EXCLUDED.cnpj, agencia = EXCLUDED.agencia, conta = EXCLUDED.conta, dac = EXCLUDED.dac,
    endereco = EXCLUDED.endereco, numero = EXCLUDED.numero, complemento = EXCLUDED.complemento, cidade = EXCLUDED.cidade, cep = EXCLUDED.cep, uf = EXCLUDED.uf,
    updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM public.inv_log('edit_payer_account', _hotel_id, _hotel_id, jsonb_build_object('tipo','conta_pagadora'));
END $$;

CREATE OR REPLACE FUNCTION public.inv_distribution_overview(_hotel_id text, _month int, _year int) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.inv_payment_batches;
BEGIN
  IF NOT public.inv_can_pay(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT * INTO b FROM public.inv_payment_batches WHERE hotel_id = _hotel_id AND month = _month AND year = _year;
  RETURN jsonb_build_object(
    'dre_valor_por_uh', public.inv_dre_valor_por_uh(_hotel_id, _month, _year),
    'uhs_pool', (SELECT count(*) FROM public.units WHERE hotel_id = _hotel_id AND modalidade = 'pool'),
    'can_send', public.inv_can_send(auth.uid()),
    'payer_ok', EXISTS (SELECT 1 FROM public.inv_payer_accounts WHERE hotel_id = _hotel_id),
    'batch', CASE WHEN b.id IS NULL THEN NULL ELSE to_jsonb(b) END,
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'unit_id', i.unit_id, 'codigo_uh', i.codigo_uh, 'investidor_nome', i.investidor_nome,
        'favorecido_nome', i.favorecido_nome, 'percentual', i.percentual, 'valor', i.valor, 'status', i.status, 'motivo', i.motivo, 'forma', i.forma,
        'ocorrencias', i.ocorrencias, 'valor_pago', i.valor_pago, 'data_pago', i.data_pago) ORDER BY i.codigo_uh, i.percentual DESC NULLS LAST)
      FROM public.inv_payment_items i WHERE i.batch_id = b.id), '[]'::jsonb));
END $$;

-- Gera (ou regera, se nada foi enviado ainda) o lote de distribuição do mês
CREATE OR REPLACE FUNCTION public.inv_create_batch(_hotel_id text, _month int, _year int, _valor_por_uh numeric, _data_pagamento date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.inv_payment_batches; v_dre numeric := public.inv_dre_valor_por_uh(_hotel_id, _month, _year); v_val numeric := round(_valor_por_uh, 2);
  r record; s record; v_rest numeric; v_n int; v_i int; v_amt numeric; chk record; p public.investor_payees;
BEGIN
  IF NOT public.inv_can_pay(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para gerar a distribuição'; END IF;
  IF v_val IS NULL OR v_val <= 0 THEN RAISE EXCEPTION 'Valor por UH deve ser maior que zero'; END IF;
  IF _data_pagamento IS NULL THEN RAISE EXCEPTION 'Informe a data de pagamento'; END IF;
  SELECT * INTO b FROM public.inv_payment_batches WHERE hotel_id = _hotel_id AND month = _month AND year = _year FOR UPDATE;
  IF b.id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.inv_payment_items WHERE batch_id = b.id AND status IN ('enviado','agendado','pago')) THEN
      RAISE EXCEPTION 'Este mês já tem pagamentos enviados ao banco; não é possível recalcular'; END IF;
    DELETE FROM public.inv_payment_items WHERE batch_id = b.id;
    UPDATE public.inv_payment_batches SET valor_por_uh = v_val, valor_fonte = CASE WHEN v_dre = v_val THEN 'dre' ELSE 'manual' END,
      data_pagamento = _data_pagamento, created_by = auth.uid(), created_at = now() WHERE id = b.id;
  ELSE
    INSERT INTO public.inv_payment_batches(hotel_id, month, year, valor_por_uh, valor_fonte, data_pagamento, created_by)
    VALUES (_hotel_id, _month, _year, v_val, CASE WHEN v_dre = v_val THEN 'dre' ELSE 'manual' END, _data_pagamento, auth.uid()) RETURNING * INTO b;
  END IF;

  FOR r IN SELECT u.id AS unit_id, u.codigo_uh, l.id AS link_id, l.investor_id, i.nome AS inv_nome
             FROM public.units u
             LEFT JOIN public.unit_investor_links l ON l.unit_id = u.id AND l.data_fim IS NULL
             LEFT JOIN public.investors i ON i.id = l.investor_id
            WHERE u.hotel_id = _hotel_id AND u.modalidade = 'pool' ORDER BY u.codigo_uh LOOP
    SELECT count(*) INTO v_n FROM public.unit_payee_shares WHERE link_id = r.link_id;
    IF r.link_id IS NULL OR v_n = 0 THEN
      INSERT INTO public.inv_payment_items(batch_id, unit_id, link_id, investor_id, codigo_uh, investidor_nome, valor, status, motivo)
      VALUES (b.id, r.unit_id, r.link_id, r.investor_id, r.codigo_uh, r.inv_nome, v_val, 'bloqueado', CASE WHEN r.link_id IS NULL THEN 'UH sem investidor vinculado' ELSE 'sem favorecido' END);
      CONTINUE;
    END IF;
    v_rest := v_val; v_i := 0;
    FOR s IN SELECT sh.payee_id, sh.percentual FROM public.unit_payee_shares sh WHERE sh.link_id = r.link_id ORDER BY sh.percentual DESC, sh.payee_id LOOP
      v_i := v_i + 1;
      v_amt := CASE WHEN v_i = v_n THEN v_rest ELSE round(v_val * s.percentual / 100, 2) END;
      v_rest := v_rest - v_amt;
      SELECT * INTO p FROM public.investor_payees WHERE id = s.payee_id;
      chk := public.inv_payee_payment_check(p);
      INSERT INTO public.inv_payment_items(batch_id, unit_id, link_id, investor_id, payee_id, codigo_uh, investidor_nome, favorecido_nome, percentual, valor, status, motivo, forma)
      VALUES (b.id, r.unit_id, r.link_id, r.investor_id, s.payee_id, r.codigo_uh, r.inv_nome, p.nome_favorecido, s.percentual, v_amt,
        CASE WHEN chk.forma IS NULL THEN 'bloqueado' ELSE 'pronto' END, chk.motivo, chk.forma);
    END LOOP;
  END LOOP;
  PERFORM public.inv_log('distribution_batch', _hotel_id, b.id::text, jsonb_build_object('month', _month, 'year', _year, 'valor_por_uh', v_val));
  RETURN b.id;
END $$;

-- Dados completos para montar a remessa; reavalia os dados atuais do favorecido e marca os itens como enviados
CREATE OR REPLACE FUNCTION public.inv_remessa_data(_batch_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.inv_payment_batches; a public.inv_payer_accounts; it record; p public.investor_payees; chk record; v_items jsonb := '[]'::jsonb; v_seu text;
BEGIN
  IF NOT public.inv_can_send(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para gerar remessa bancária'; END IF;
  SELECT * INTO b FROM public.inv_payment_batches WHERE id = _batch_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;
  SELECT * INTO a FROM public.inv_payer_accounts WHERE hotel_id = b.hotel_id;
  IF a.hotel_id IS NULL THEN RAISE EXCEPTION 'Cadastre a conta pagadora do hotel antes de gerar a remessa'; END IF;
  FOR it IN SELECT * FROM public.inv_payment_items WHERE batch_id = b.id AND status IN ('pronto','bloqueado','rejeitado') AND payee_id IS NOT NULL ORDER BY codigo_uh, percentual DESC FOR UPDATE LOOP
    SELECT * INTO p FROM public.investor_payees WHERE id = it.payee_id;
    chk := public.inv_payee_payment_check(p);
    IF chk.forma IS NULL THEN
      UPDATE public.inv_payment_items SET status = CASE WHEN it.status = 'rejeitado' THEN 'rejeitado' ELSE 'bloqueado' END,
        motivo = CASE WHEN it.status = 'rejeitado' THEN it.motivo ELSE chk.motivo END, updated_at = now() WHERE id = it.id;
      CONTINUE;
    END IF;
    IF it.status = 'rejeitado' AND p.updated_at <= it.updated_at THEN CONTINUE; END IF; -- rejeitado só reenvia após corrigir o cadastro
    v_seu := upper(substr(replace(gen_random_uuid()::text,'-',''),1,20));
    UPDATE public.inv_payment_items SET status = 'enviado', forma = chk.forma, motivo = NULL, ocorrencias = NULL, seu_numero = v_seu, favorecido_nome = p.nome_favorecido, updated_at = now() WHERE id = it.id;
    v_items := v_items || jsonb_build_object('seu_numero', v_seu, 'valor', it.valor, 'forma', chk.forma, 'nome', p.nome_favorecido,
      'documento', regexp_replace(p.documento_favorecido,'\D','','g'), 'banco_codigo', p.banco_codigo, 'agencia', p.agencia, 'conta', p.conta,
      'tipo_chave_pix', p.tipo_chave_pix, 'chave_pix', p.chave_pix, 'codigo_uh', it.codigo_uh);
  END LOOP;
  IF jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION 'Nenhum pagamento pronto para envio'; END IF;
  UPDATE public.inv_payment_batches SET remessas = remessas + 1, last_remessa_at = now() WHERE id = b.id;
  PERFORM public.inv_log('remessa_bancaria', b.hotel_id, b.id::text, jsonb_build_object('month', b.month, 'year', b.year, 'itens', jsonb_array_length(v_items)));
  RETURN jsonb_build_object('payer', to_jsonb(a) - 'updated_by', 'data_pagamento', GREATEST(b.data_pagamento, current_date), 'lote', b.remessas + 1, 'items', v_items);
END $$;

-- Aplica o retorno do banco: [{seu_numero, ocorrencias, valor_pago, data_pago}]
CREATE OR REPLACE FUNCTION public.inv_apply_return(_rows jsonb, _file_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; v_codes text; v_first text; v_status text; v_pago int := 0; v_agend int := 0; v_rej int := 0; v_unknown int := 0; v_id uuid; v_hotel text;
BEGIN
  IF NOT public.inv_can_send(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para importar retorno bancário'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(_rows,'[]'::jsonb)) LOOP
    v_codes := upper(trim(coalesce(r->>'ocorrencias','')));
    v_first := left(v_codes, 2);
    v_status := CASE WHEN v_first = '00' THEN 'pago' WHEN v_first IN ('BD','BE') THEN 'agendado' ELSE 'rejeitado' END;
    UPDATE public.inv_payment_items i SET status = v_status, ocorrencias = v_codes,
        motivo = CASE WHEN v_status = 'rejeitado' THEN nullif(r->>'motivo','') ELSE NULL END,
        valor_pago = CASE WHEN v_status = 'pago' THEN coalesce(nullif(r->>'valor_pago','')::numeric, i.valor) END,
        data_pago = CASE WHEN v_status = 'pago' THEN nullif(r->>'data_pago','')::date END, updated_at = now()
     WHERE i.seu_numero = upper(trim(r->>'seu_numero')) AND i.status <> 'pago'
     RETURNING i.id, (SELECT hotel_id FROM public.inv_payment_batches WHERE id = i.batch_id) INTO v_id, v_hotel;
    IF v_id IS NULL THEN v_unknown := v_unknown + 1; CONTINUE; END IF;
    IF v_status = 'pago' THEN v_pago := v_pago + 1; ELSIF v_status = 'agendado' THEN v_agend := v_agend + 1; ELSE v_rej := v_rej + 1; END IF;
    v_id := NULL;
  END LOOP;
  PERFORM public.inv_log('retorno_bancario', v_hotel, NULL, jsonb_build_object('arquivo', _file_name, 'pagos', v_pago, 'agendados', v_agend, 'rejeitados', v_rej, 'nao_encontrados', v_unknown));
  RETURN jsonb_build_object('pagos', v_pago, 'agendados', v_agend, 'rejeitados', v_rej, 'nao_encontrados', v_unknown);
END $$;

CREATE OR REPLACE FUNCTION public.inv_my_access() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'can_access', public.inv_can_access(auth.uid()),
    'can_edit', public.inv_can_edit(auth.uid()),
    'is_finance', public.inv_is_finance(auth.uid()),
    'can_view_full', public.inv_is_finance(auth.uid()) OR public.inv_can_view_full(auth.uid()),
    'can_pay', public.inv_can_pay(auth.uid()),
    'can_send', public.inv_can_send(auth.uid()));
$$;

REVOKE ALL ON FUNCTION public.inv_can_pay(uuid), public.inv_can_send(uuid), public.inv_dre_valor_por_uh(text,int,int), public.inv_payer_get(text), public.inv_payer_save(text,jsonb),
  public.inv_distribution_overview(text,int,int), public.inv_create_batch(text,int,int,numeric,date), public.inv_remessa_data(uuid), public.inv_apply_return(jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_payer_get(text), public.inv_payer_save(text,jsonb), public.inv_distribution_overview(text,int,int),
  public.inv_create_batch(text,int,int,numeric,date), public.inv_remessa_data(uuid), public.inv_apply_return(jsonb,text) TO authenticated;