-- Matrícula do imóvel pertence à UH
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS matricula text;
COMMENT ON COLUMN public.units.matricula IS 'Matrícula do imóvel na prefeitura (opcional)';
UPDATE public.units u SET matricula = i.codigo_externo
  FROM public.unit_investor_links l JOIN public.investors i ON i.id = l.investor_id
 WHERE l.unit_id = u.id AND l.data_fim IS NULL AND u.matricula IS NULL AND coalesce(i.codigo_externo,'') <> '';
COMMENT ON COLUMN public.investors.codigo_externo IS 'DEPRECATED: matrícula do imóvel agora fica em units.matricula';

-- Contato e tipo de conta do favorecido
ALTER TABLE public.investor_payees ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.investor_payees ADD COLUMN IF NOT EXISTS telefone text;
ALTER TABLE public.investor_payees ADD COLUMN IF NOT EXISTS tipo_conta text CHECK (tipo_conta IS NULL OR tipo_conta IN ('corrente','poupanca'));

-- Rateio de favorecidos por vínculo (fração de recebimento)
CREATE TABLE public.unit_payee_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.unit_investor_links(id),
  payee_id uuid NOT NULL REFERENCES public.investor_payees(id),
  percentual numeric(7,4) NOT NULL CHECK (percentual > 0 AND percentual <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (link_id, payee_id)
);
GRANT ALL ON public.unit_payee_shares TO service_role;
ALTER TABLE public.unit_payee_shares ENABLE ROW LEVEL SECURITY;
CREATE INDEX unit_payee_shares_payee_idx ON public.unit_payee_shares(payee_id);

INSERT INTO public.unit_payee_shares(link_id, payee_id, percentual)
SELECT id, payee_id, 100 FROM public.unit_investor_links WHERE payee_id IS NOT NULL;

-- Mantém 100% para vínculos de favorecido único (troca, importação) e herda matrícula legada
CREATE OR REPLACE FUNCTION public.inv_link_sync_shares() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.units u SET matricula = i.codigo_externo FROM public.investors i
     WHERE u.id = NEW.unit_id AND i.id = NEW.investor_id AND u.matricula IS NULL AND coalesce(i.codigo_externo,'') <> '';
  END IF;
  IF NEW.payee_id IS NULL THEN
    IF TG_OP = 'UPDATE' THEN DELETE FROM public.unit_payee_shares WHERE link_id = NEW.id; END IF;
    RETURN NEW;
  END IF;
  IF (SELECT count(*) FROM public.unit_payee_shares WHERE link_id = NEW.id) <= 1 THEN
    DELETE FROM public.unit_payee_shares WHERE link_id = NEW.id;
    INSERT INTO public.unit_payee_shares(link_id, payee_id, percentual) VALUES (NEW.id, NEW.payee_id, 100);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER unit_investor_links_sync_shares AFTER INSERT OR UPDATE OF payee_id ON public.unit_investor_links
  FOR EACH ROW EXECUTE FUNCTION public.inv_link_sync_shares();

CREATE OR REPLACE FUNCTION public.inv_payee_json(p public.investor_payees, _full boolean) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', p.id, 'investor_id', p.investor_id, 'nome_favorecido', p.nome_favorecido,
    'documento_favorecido', CASE WHEN _full THEN p.documento_favorecido ELSE public.inv_mask_doc(p.documento_favorecido) END,
    'banco_codigo', p.banco_codigo, 'banco_nome', p.banco_nome,
    'agencia', CASE WHEN _full THEN p.agencia ELSE public.inv_mask_agencia(p.agencia) END,
    'conta', CASE WHEN _full THEN p.conta ELSE public.inv_mask_conta(p.conta) END,
    'tipo_conta', p.tipo_conta,
    'tipo_chave_pix', p.tipo_chave_pix,
    'chave_pix', CASE WHEN _full THEN p.chave_pix ELSE public.inv_mask_pix(p.chave_pix) END,
    'email', p.email, 'telefone', p.telefone,
    'status_dados', p.status_dados, 'observacao', p.observacao, 'full', _full) END;
$$;

CREATE OR REPLACE FUNCTION public.inv_unit_detail(_unit_id uuid, _full boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_full boolean; u public.units; v jsonb; v_cur record; p public.investor_payees;
BEGIN
  IF NOT public.inv_can_access(v_uid) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT * INTO u FROM public.units WHERE id = _unit_id;
  IF u.id IS NULL THEN RAISE EXCEPTION 'UH não encontrada'; END IF;
  v_full := public.inv_is_finance(v_uid) OR (_full AND public.inv_can_view_full(v_uid));
  SELECT l.*, i.nome AS inv_nome, i.documento AS inv_doc, i.codigo_externo, i.ativo INTO v_cur
    FROM public.unit_investor_links l JOIN public.investors i ON i.id = l.investor_id
   WHERE l.unit_id = u.id AND l.data_fim IS NULL;
  IF v_cur.payee_id IS NOT NULL THEN SELECT * INTO p FROM public.investor_payees WHERE id = v_cur.payee_id; END IF;
  v := jsonb_build_object(
    'unit', jsonb_build_object('id', u.id, 'hotel_id', u.hotel_id, 'hotel_name', (SELECT name FROM public.hotels WHERE id = u.hotel_id), 'codigo_uh', u.codigo_uh, 'modalidade', u.modalidade, 'matricula', u.matricula),
    'current', CASE WHEN v_cur.id IS NULL THEN NULL ELSE jsonb_build_object('link_id', v_cur.id, 'investor_id', v_cur.investor_id, 'investor_nome', v_cur.inv_nome,
       'investor_documento', CASE WHEN v_full THEN v_cur.inv_doc ELSE public.inv_mask_doc(v_cur.inv_doc) END,
       'codigo_externo', v_cur.codigo_externo, 'ativo', v_cur.ativo, 'data_inicio', v_cur.data_inicio) END,
    'payee', public.inv_payee_json(p, v_full),
    'shares', CASE WHEN v_cur.id IS NULL THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(jsonb_build_object('percentual', s.percentual, 'payee', public.inv_payee_json(pp, v_full)) ORDER BY s.percentual DESC, pp.nome_favorecido)
       FROM public.unit_payee_shares s JOIN public.investor_payees pp ON pp.id = s.payee_id WHERE s.link_id = v_cur.id), '[]'::jsonb) END,
    'full', v_full,
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'investor_id', l.investor_id, 'investor_nome', i.nome, 'payee_nome', pp.nome_favorecido,
        'data_inicio', l.data_inicio, 'data_fim', l.data_fim, 'motivo_troca', l.motivo_troca, 'created_by', pr.display_name) ORDER BY l.data_inicio DESC, l.created_at DESC)
      FROM public.unit_investor_links l JOIN public.investors i ON i.id = l.investor_id
      LEFT JOIN public.investor_payees pp ON pp.id = l.payee_id
      LEFT JOIN public.profiles pr ON pr.user_id = l.created_by
      WHERE l.unit_id = u.id), '[]'::jsonb));
  IF v_full AND p.id IS NOT NULL THEN
    PERFORM public.inv_log('view_bank_details', u.hotel_id, u.id::text, jsonb_build_object('tipo','unit','codigo_uh',u.codigo_uh));
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.inv_list_units(_hotel_id text DEFAULT NULL, _modalidade text DEFAULT NULL, _search text DEFAULT NULL, _status text DEFAULT NULL, _limit int DEFAULT 50, _offset int DEFAULT 0)
RETURNS TABLE(unit_id uuid, hotel_id text, hotel_name text, codigo_uh text, modalidade text, investor_id uuid, investor_nome text,
  investor_documento text, payee_id uuid, payee_nome text, status_dados text, vigente_desde date, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_q text := nullif(trim(coalesce(_search,'')),''); v_qd text;
BEGIN
  IF NOT public.inv_can_access(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  v_qd := nullif(regexp_replace(coalesce(v_q,''),'\D','','g'),'');
  RETURN QUERY
  SELECT u.id, u.hotel_id, h.name, u.codigo_uh, u.modalidade, i.id, i.nome, public.inv_mask_doc(i.documento),
         p.id, p.nome_favorecido, coalesce(p.status_dados,'pendente'), l.data_inicio, count(*) OVER ()
  FROM public.units u
  JOIN public.hotels h ON h.id = u.hotel_id
  LEFT JOIN public.unit_investor_links l ON l.unit_id = u.id AND l.data_fim IS NULL
  LEFT JOIN public.investors i ON i.id = l.investor_id
  LEFT JOIN public.investor_payees p ON p.id = l.payee_id
  WHERE (_hotel_id IS NULL OR u.hotel_id = _hotel_id)
    AND (_modalidade IS NULL OR u.modalidade = _modalidade)
    AND (_status IS NULL OR coalesce(p.status_dados,'pendente') = _status OR (_status = 'nao_completo' AND coalesce(p.status_dados,'pendente') <> 'completo'))
    AND (v_q IS NULL OR u.codigo_uh ILIKE '%'||v_q||'%' OR i.nome ILIKE '%'||v_q||'%' OR p.nome_favorecido ILIKE '%'||v_q||'%'
         OR u.matricula ILIKE '%'||v_q||'%'
         OR (v_qd IS NOT NULL AND (i.documento LIKE '%'||v_qd||'%' OR i.codigo_externo = v_q)))
  ORDER BY h.name, u.codigo_uh
  LIMIT least(greatest(_limit,1),200) OFFSET greatest(_offset,0);
END $$;

CREATE OR REPLACE FUNCTION public.inv_save_payee(_id uuid, _investor_id uuid, _data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.investor_payees; v_id uuid; v_status text; v_fields text[] := '{}'; v_hotel text; v_unit uuid; v_uh text; v_txt text;
  v_nome text := nullif(trim(_data->>'nome_favorecido'),''); v_doc text := nullif(regexp_replace(coalesce(_data->>'documento_favorecido',''),'\D','','g'),'');
  v_bc text := nullif(trim(_data->>'banco_codigo'),''); v_bn text := nullif(trim(_data->>'banco_nome'),'');
  v_ag text := nullif(trim(_data->>'agencia'),''); v_ct text := nullif(trim(_data->>'conta'),'');
  v_tc text := nullif(trim(_data->>'tipo_conta'),'');
  v_tp text := nullif(trim(_data->>'tipo_chave_pix'),''); v_pk text := nullif(trim(_data->>'chave_pix'),''); v_obs text := nullif(trim(_data->>'observacao'),'');
  v_em text := nullif(lower(trim(_data->>'email')),''); v_tel text := nullif(regexp_replace(coalesce(_data->>'telefone',''),'\D','','g'),'');
BEGIN
  PERFORM public.inv_require_edit();
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Nome do favorecido obrigatório'; END IF;
  IF v_doc IS NOT NULL AND length(v_doc) NOT IN (11,14) THEN RAISE EXCEPTION 'CPF/CNPJ do favorecido inválido'; END IF;
  IF v_tc IS NOT NULL AND v_tc NOT IN ('corrente','poupanca') THEN RAISE EXCEPTION 'Tipo de conta inválido'; END IF;
  IF v_em IS NOT NULL AND v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'E-mail do favorecido inválido'; END IF;
  IF v_tel IS NOT NULL AND length(v_tel) NOT IN (10,11) THEN RAISE EXCEPTION 'Telefone do favorecido inválido (use DDD + número)'; END IF;
  v_status := public.inv_payee_status(coalesce(v_bc,v_bn), v_ag, v_ct, v_pk);
  IF _id IS NULL THEN
    INSERT INTO public.investor_payees(investor_id, nome_favorecido, documento_favorecido, banco_codigo, banco_nome, agencia, conta, tipo_conta, tipo_chave_pix, chave_pix, email, telefone, status_dados, observacao)
    VALUES (_investor_id, v_nome, v_doc, v_bc, v_bn, v_ag, v_ct, v_tc, v_tp, v_pk, v_em, v_tel, v_status, v_obs) RETURNING id INTO v_id;
    v_txt := 'Favorecido cadastrado: ' || v_nome || ' (status ' || v_status || ')';
  ELSE
    SELECT * INTO o FROM public.investor_payees WHERE id = _id;
    IF o.id IS NULL THEN RAISE EXCEPTION 'Favorecido não encontrado'; END IF;
    v_id := _id;
    IF o.nome_favorecido IS DISTINCT FROM v_nome THEN v_fields := v_fields || 'nome do favorecido'::text; END IF;
    IF o.documento_favorecido IS DISTINCT FROM v_doc THEN v_fields := v_fields || 'documento'::text; END IF;
    IF o.banco_codigo IS DISTINCT FROM v_bc OR o.banco_nome IS DISTINCT FROM v_bn THEN v_fields := v_fields || 'banco'::text; END IF;
    IF o.agencia IS DISTINCT FROM v_ag THEN v_fields := v_fields || 'agência'::text; END IF;
    IF o.conta IS DISTINCT FROM v_ct THEN v_fields := v_fields || 'conta'::text; END IF;
    IF o.tipo_conta IS DISTINCT FROM v_tc THEN v_fields := v_fields || 'tipo de conta'::text; END IF;
    IF o.chave_pix IS DISTINCT FROM v_pk OR o.tipo_chave_pix IS DISTINCT FROM v_tp THEN v_fields := v_fields || 'chave PIX'::text; END IF;
    IF o.email IS DISTINCT FROM v_em OR o.telefone IS DISTINCT FROM v_tel THEN v_fields := v_fields || 'contato'::text; END IF;
    IF o.observacao IS DISTINCT FROM v_obs THEN v_fields := v_fields || 'observação'::text; END IF;
    UPDATE public.investor_payees SET nome_favorecido = v_nome, documento_favorecido = v_doc, banco_codigo = v_bc, banco_nome = v_bn, agencia = v_ag,
      conta = v_ct, tipo_conta = v_tc, tipo_chave_pix = v_tp, chave_pix = v_pk, email = v_em, telefone = v_tel, status_dados = v_status, observacao = v_obs, updated_at = now() WHERE id = _id;
    IF array_length(v_fields,1) IS NULL THEN RETURN v_id; END IF;
    v_txt := 'Favorecido ' || v_nome || ': dados atualizados (' || array_to_string(v_fields, ', ') || ')'
      || CASE WHEN o.status_dados <> v_status THEN '; status ' || o.status_dados || ' → ' || v_status ELSE '' END;
  END IF;
  SELECT u.id, u.hotel_id, u.codigo_uh INTO v_unit, v_hotel, v_uh FROM public.unit_investor_links l JOIN public.units u ON u.id = l.unit_id
   WHERE l.payee_id = v_id AND l.data_fim IS NULL ORDER BY u.codigo_uh LIMIT 1;
  PERFORM public.inv_log('edit_payee', v_hotel, v_id::text, jsonb_build_object(
    'grupo', coalesce('unit:'||v_unit, 'payee:'||v_id), 'alvo', coalesce('UH ' || v_uh, v_nome),
    'link', CASE WHEN v_unit IS NOT NULL THEN '/investidores/uh/'||v_unit ELSE '/investidores/investidor/'||_investor_id END,
    'campos', to_jsonb(v_fields), 'texto', coalesce('UH ' || v_uh || ' — ', '') || v_txt));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.inv_create_unit(_hotel_id text, _codigo_uh text, _modalidade text, _matricula text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_cod text := nullif(upper(trim(coalesce(_codigo_uh,''))),'');
BEGIN
  PERFORM public.inv_require_edit();
  IF v_cod IS NULL THEN RAISE EXCEPTION 'Informe o código da UH'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hotels WHERE id = _hotel_id) THEN RAISE EXCEPTION 'Hotel não encontrado'; END IF;
  IF coalesce(_modalidade,'') NOT IN ('pool','condo') THEN RAISE EXCEPTION 'Modalidade inválida'; END IF;
  IF EXISTS (SELECT 1 FROM public.units WHERE hotel_id = _hotel_id AND upper(codigo_uh) = v_cod) THEN RAISE EXCEPTION 'UH % já cadastrada neste hotel', v_cod; END IF;
  INSERT INTO public.units(hotel_id, codigo_uh, modalidade, matricula) VALUES (_hotel_id, v_cod, _modalidade, nullif(trim(coalesce(_matricula,'')),'')) RETURNING id INTO v_id;
  PERFORM public.inv_log('edit_link', _hotel_id, v_id::text, jsonb_build_object('grupo','unit:'||v_id, 'alvo','UH '||v_cod, 'link','/investidores/uh/'||v_id,
    'texto', 'UH ' || v_cod || ' cadastrada manualmente (' || CASE WHEN _modalidade = 'pool' THEN 'Pool' ELSE 'Condo' END || ')'));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.inv_set_unit_matricula(_unit_id uuid, _matricula text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.units; v_m text := nullif(trim(coalesce(_matricula,'')),'');
BEGIN
  PERFORM public.inv_require_edit();
  SELECT * INTO u FROM public.units WHERE id = _unit_id;
  IF u.id IS NULL THEN RAISE EXCEPTION 'UH não encontrada'; END IF;
  IF u.matricula IS NOT DISTINCT FROM v_m THEN RETURN; END IF;
  UPDATE public.units SET matricula = v_m, updated_at = now() WHERE id = _unit_id;
  PERFORM public.inv_log('edit_link', u.hotel_id, u.id::text, jsonb_build_object('grupo','unit:'||u.id, 'alvo','UH '||u.codigo_uh, 'link','/investidores/uh/'||u.id,
    'texto', 'UH ' || u.codigo_uh || ': matrícula ' || coalesce(u.matricula,'(vazia)') || ' → ' || coalesce(v_m,'(vazia)')));
END $$;

CREATE OR REPLACE FUNCTION public.inv_set_payee_shares(_unit_id uuid, _shares jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.units; c public.unit_investor_links; v_sum numeric; v_n int; v_top uuid; v_txt text;
BEGIN
  PERFORM public.inv_require_edit();
  SELECT * INTO u FROM public.units WHERE id = _unit_id;
  IF u.id IS NULL THEN RAISE EXCEPTION 'UH não encontrada'; END IF;
  SELECT * INTO c FROM public.unit_investor_links WHERE unit_id = _unit_id AND data_fim IS NULL FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Vincule um investidor antes de definir os favorecidos'; END IF;
  DROP TABLE IF EXISTS _sh;
  CREATE TEMP TABLE _sh ON COMMIT DROP AS
    SELECT (e->>'payee_id')::uuid AS payee_id, round((e->>'percentual')::numeric, 4) AS percentual
      FROM jsonb_array_elements(coalesce(_shares,'[]'::jsonb)) e;
  SELECT count(*), sum(percentual) INTO v_n, v_sum FROM _sh;
  IF v_n = 0 THEN RAISE EXCEPTION 'Informe ao menos um favorecido'; END IF;
  IF (SELECT count(DISTINCT payee_id) FROM _sh) <> v_n THEN RAISE EXCEPTION 'Favorecido repetido no rateio'; END IF;
  IF EXISTS (SELECT 1 FROM _sh WHERE percentual IS NULL OR percentual <= 0 OR percentual > 100) THEN RAISE EXCEPTION 'Cada fração deve ser maior que 0 e no máximo 100 por cento'; END IF;
  IF abs(v_sum - 100) > 0.01 THEN RAISE EXCEPTION 'A soma das frações deve ser 100 por cento (atual: %)', round(v_sum, 2); END IF;
  IF EXISTS (SELECT 1 FROM _sh s LEFT JOIN public.investor_payees p ON p.id = s.payee_id AND p.investor_id = c.investor_id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Favorecido não pertence ao investidor vigente'; END IF;
  DELETE FROM public.unit_payee_shares WHERE link_id = c.id;
  INSERT INTO public.unit_payee_shares(link_id, payee_id, percentual) SELECT c.id, payee_id, percentual FROM _sh;
  SELECT payee_id INTO v_top FROM _sh ORDER BY percentual DESC LIMIT 1;
  IF c.payee_id IS DISTINCT FROM v_top THEN UPDATE public.unit_investor_links SET payee_id = v_top WHERE id = c.id; END IF;
  SELECT string_agg(p.nome_favorecido || ' ' || trim(to_char(s.percentual, 'FM990D00')) || '%', ', ' ORDER BY s.percentual DESC) INTO v_txt
    FROM _sh s JOIN public.investor_payees p ON p.id = s.payee_id;
  PERFORM public.inv_log('edit_link', u.hotel_id, u.id::text, jsonb_build_object('grupo','unit:'||u.id, 'alvo','UH '||u.codigo_uh, 'link','/investidores/uh/'||u.id,
    'texto', 'UH ' || u.codigo_uh || ': rateio de favorecidos — ' || v_txt));
END $$;

CREATE OR REPLACE FUNCTION public.inv_full_export(_hotel_id text DEFAULT NULL)
RETURNS TABLE(hotel_name text, codigo_uh text, matricula text, modalidade text, investidor text, investidor_documento text, investidor_email text, investidor_telefone text,
  vigente_desde date, favorecido text, favorecido_documento text, favorecido_email text, favorecido_telefone text, percentual numeric,
  banco_codigo text, banco_nome text, agencia text, conta text, tipo_conta text, tipo_chave_pix text, chave_pix text, status_dados text, observacao text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_full boolean := public.inv_is_finance(auth.uid()) OR public.inv_can_view_full(auth.uid());
BEGIN
  IF NOT public.inv_can_access(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  PERFORM public.inv_log('export_excel', _hotel_id, NULL, jsonb_build_object('tipo','base_completa','dados_completos', v_full));
  RETURN QUERY
  SELECT h.name, u.codigo_uh, u.matricula, u.modalidade, i.nome,
    CASE WHEN v_full THEN i.documento ELSE public.inv_mask_doc(i.documento) END, i.email, i.telefone, l.data_inicio,
    p.nome_favorecido, CASE WHEN v_full THEN p.documento_favorecido ELSE public.inv_mask_doc(p.documento_favorecido) END, p.email, p.telefone, s.percentual,
    p.banco_codigo, p.banco_nome,
    CASE WHEN v_full THEN p.agencia ELSE public.inv_mask_agencia(p.agencia) END,
    CASE WHEN v_full THEN p.conta ELSE public.inv_mask_conta(p.conta) END,
    p.tipo_conta, p.tipo_chave_pix,
    CASE WHEN v_full THEN p.chave_pix ELSE public.inv_mask_pix(p.chave_pix) END,
    CASE WHEN l.id IS NULL THEN 'pendente' ELSE coalesce(p.status_dados,'pendente') END, p.observacao
  FROM public.units u JOIN public.hotels h ON h.id = u.hotel_id
  LEFT JOIN public.unit_investor_links l ON l.unit_id = u.id AND l.data_fim IS NULL
  LEFT JOIN public.investors i ON i.id = l.investor_id
  LEFT JOIN public.unit_payee_shares s ON s.link_id = l.id
  LEFT JOIN public.investor_payees p ON p.id = s.payee_id
  WHERE _hotel_id IS NULL OR u.hotel_id = _hotel_id
  ORDER BY h.name, u.codigo_uh, s.percentual DESC NULLS LAST;
END $$;

REVOKE ALL ON FUNCTION public.inv_create_unit(text,text,text,text), public.inv_set_unit_matricula(uuid,text), public.inv_set_payee_shares(uuid,jsonb), public.inv_full_export(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_create_unit(text,text,text,text), public.inv_set_unit_matricula(uuid,text), public.inv_set_payee_shares(uuid,jsonb), public.inv_full_export(text) TO authenticated;