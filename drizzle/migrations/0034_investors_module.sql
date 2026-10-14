
-- ===== Tabelas =====
CREATE TABLE public.investors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  documento text UNIQUE,
  codigo_externo text,
  email text,
  telefone text,
  ativo boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.investors.documento IS 'CPF/CNPJ apenas dígitos';

CREATE TABLE public.investor_payees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES public.investors(id),
  nome_favorecido text NOT NULL,
  documento_favorecido text,
  banco_codigo text,
  banco_nome text,
  agencia text,
  conta text,
  tipo_chave_pix text CHECK (tipo_chave_pix IS NULL OR tipo_chave_pix IN ('cpf','cnpj','email','telefone','aleatoria')),
  chave_pix text,
  status_dados text NOT NULL DEFAULT 'pendente' CHECK (status_dados IN ('completo','parcial','pendente')),
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX investor_payees_investor_idx ON public.investor_payees(investor_id);

CREATE TABLE public.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id),
  codigo_uh text NOT NULL,
  modalidade text NOT NULL DEFAULT 'pool' CHECK (modalidade IN ('pool','condo')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, codigo_uh)
);

CREATE TABLE public.unit_investor_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units(id),
  investor_id uuid NOT NULL REFERENCES public.investors(id),
  payee_id uuid REFERENCES public.investor_payees(id),
  data_inicio date NOT NULL DEFAULT current_date,
  data_fim date,
  motivo_troca text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.unit_investor_links IS 'Histórico de vínculos. Vigência [data_inicio, data_fim); data_fim null = vigente. Nunca apagar.';
CREATE UNIQUE INDEX unit_investor_links_one_current ON public.unit_investor_links(unit_id) WHERE data_fim IS NULL;
CREATE INDEX unit_investor_links_investor_idx ON public.unit_investor_links(investor_id);
CREATE INDEX unit_investor_links_payee_idx ON public.unit_investor_links(payee_id);

CREATE TABLE IF NOT EXISTS public.audit_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  role text,
  modulo text NOT NULL,
  acao text NOT NULL,
  hotel_id text,
  registro_id text,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_access_logs_mod_idx ON public.audit_access_logs(modulo, created_at DESC);

GRANT ALL ON public.investors, public.investor_payees, public.units, public.unit_investor_links, public.audit_access_logs TO service_role;
GRANT SELECT ON public.audit_access_logs TO authenticated;

ALTER TABLE public.investors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_payees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_investor_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_access_logs ENABLE ROW LEVEL SECURITY;

-- ===== Helpers de acesso =====
CREATE OR REPLACE FUNCTION public.inv_can_edit(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role IN ('ri','processos','fernando'));
$$;
CREATE OR REPLACE FUNCTION public.inv_is_finance(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_permissions WHERE user_id = _uid AND permission_key = 'investors_finance');
$$;
CREATE OR REPLACE FUNCTION public.inv_can_view_full(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_permissions WHERE user_id = _uid AND permission_key = 'view_investor_bank_details');
$$;
CREATE OR REPLACE FUNCTION public.inv_can_access(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.inv_can_edit(_uid) OR public.inv_is_finance(_uid);
$$;

CREATE POLICY audit_logs_select_module ON public.audit_access_logs FOR SELECT TO authenticated
  USING (public.is_master(auth.uid()) OR (modulo = 'investidores' AND public.inv_can_access(auth.uid())));

-- ===== Máscaras =====
CREATE OR REPLACE FUNCTION public.inv_mask_doc(_d text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _d IS NULL OR _d = '' THEN NULL
    WHEN length(regexp_replace(_d,'\D','','g')) = 11 THEN '***.' || substr(regexp_replace(_d,'\D','','g'),4,3) || '.' || substr(regexp_replace(_d,'\D','','g'),7,3) || '-**'
    WHEN length(regexp_replace(_d,'\D','','g')) = 14 THEN '**.***.' || substr(regexp_replace(_d,'\D','','g'),6,3) || '/' || substr(regexp_replace(_d,'\D','','g'),9,4) || '-**'
    ELSE repeat('*', greatest(length(_d)-3,0)) || right(_d,3) END;
$$;
CREATE OR REPLACE FUNCTION public.inv_mask_agencia(_a text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _a IS NULL OR _a = '' THEN NULL ELSE left(_a,2) || '**' END;
$$;
CREATE OR REPLACE FUNCTION public.inv_mask_conta(_c text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _c IS NULL OR _c = '' THEN NULL ELSE '*****-' || right(regexp_replace(_c,'[^0-9Xx]','','g'),1) END;
$$;
CREATE OR REPLACE FUNCTION public.inv_mask_pix(_k text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _k IS NULL OR _k = '' THEN NULL WHEN length(_k) <= 5 THEN '***' ELSE left(_k,3) || '***' || right(_k,2) END;
$$;
CREATE OR REPLACE FUNCTION public.inv_payee_status(_banco text, _agencia text, _conta text, _pix text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN coalesce(_banco,'') <> '' AND coalesce(_agencia,'') <> '' AND coalesce(_conta,'') <> '' THEN 'completo'
    WHEN coalesce(_banco,'') <> '' OR coalesce(_agencia,'') <> '' OR coalesce(_conta,'') <> '' OR coalesce(_pix,'') <> '' THEN 'parcial'
    ELSE 'pendente' END;
$$;

CREATE OR REPLACE FUNCTION public.inv_payee_json(p public.investor_payees, _full boolean) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', p.id, 'investor_id', p.investor_id, 'nome_favorecido', p.nome_favorecido,
    'documento_favorecido', CASE WHEN _full THEN p.documento_favorecido ELSE public.inv_mask_doc(p.documento_favorecido) END,
    'banco_codigo', p.banco_codigo, 'banco_nome', p.banco_nome,
    'agencia', CASE WHEN _full THEN p.agencia ELSE public.inv_mask_agencia(p.agencia) END,
    'conta', CASE WHEN _full THEN p.conta ELSE public.inv_mask_conta(p.conta) END,
    'tipo_chave_pix', p.tipo_chave_pix,
    'chave_pix', CASE WHEN _full THEN p.chave_pix ELSE public.inv_mask_pix(p.chave_pix) END,
    'status_dados', p.status_dados, 'observacao', p.observacao, 'full', _full) END;
$$;

-- ===== Auditoria =====
CREATE OR REPLACE FUNCTION public.inv_log(_acao text, _hotel_id text, _registro_id text, _detalhe jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  SELECT string_agg(role::text, ',' ORDER BY role::text) INTO v_role FROM public.user_roles WHERE user_id = auth.uid();
  IF public.inv_is_finance(auth.uid()) THEN v_role := coalesce(v_role || ',', '') || 'investors_finance'; END IF;
  INSERT INTO public.audit_access_logs(user_id, role, modulo, acao, hotel_id, registro_id, detalhe)
  VALUES (auth.uid(), v_role, 'investidores', _acao, _hotel_id, _registro_id, coalesce(_detalhe,'{}'::jsonb));
END $$;

-- Notificação ao Financeiro (a partir da auditoria)
CREATE OR REPLACE FUNCTION public.inv_audit_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; v_actor text; v_hotel text; v_line text; v_group text; v_existing uuid;
  v_when text; v_is_import boolean; v_link text;
BEGIN
  IF NEW.modulo <> 'investidores' OR NEW.acao NOT IN ('import_investors','edit_link','edit_payee','edit_modalidade','edit_investor') THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL OR NOT public.inv_can_edit(NEW.user_id) THEN RETURN NEW; END IF;
  v_line := NEW.detalhe->>'texto';
  IF v_line IS NULL OR v_line = '' THEN RETURN NEW; END IF;
  SELECT coalesce(display_name, email, 'Usuário') INTO v_actor FROM public.profiles WHERE user_id = NEW.user_id;
  SELECT name INTO v_hotel FROM public.hotels WHERE id = NEW.hotel_id;
  v_is_import := NEW.acao = 'import_investors';
  v_group := coalesce(NEW.detalhe->>'grupo', NEW.registro_id, NEW.id::text);
  v_when := to_char(NEW.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
  v_link := coalesce(NEW.detalhe->>'link', '/investidores');

  FOR r IN SELECT up.user_id, p.email FROM public.user_permissions up
           JOIN public.profiles p ON p.user_id = up.user_id
           WHERE up.permission_key = 'investors_finance' AND p.email IS NOT NULL LOOP
    IF NOT v_is_import THEN
      SELECT id INTO v_existing FROM public.notification_queue
       WHERE event = 'investor_change' AND recipient_user_id = r.user_id AND status = 'pending'
         AND scheduled_at > now() AND payload->>'actor' = NEW.user_id::text AND payload->>'grupo' = v_group
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
      IF v_existing IS NOT NULL THEN
        UPDATE public.notification_queue
           SET body_md = body_md || E'\n- ' || v_when || ' — ' || v_line,
               scheduled_at = now() + interval '10 minutes'
         WHERE id = v_existing;
        v_existing := NULL;
        CONTINUE;
      END IF;
    END IF;
    IF public.is_unsubscribed(r.user_id, 'investor_change') THEN CONTINUE; END IF;
    INSERT INTO public.notification_queue(event, hotel_id, recipient_user_id, recipient_email, recipient_role,
      subject, body_md, link_url, payload, scheduled_at)
    VALUES ('investor_change', coalesce(NEW.hotel_id, '-'), r.user_id, r.email, 'investors_finance',
      CASE WHEN v_is_import THEN 'Investidores: importação de planilha' || coalesce(' — ' || v_hotel, '')
           ELSE 'Investidores: alteração' || coalesce(' — ' || (NEW.detalhe->>'alvo'), '') || coalesce(' (' || v_hotel || ')', '') END,
      '**' || v_actor || '** alterou a base de investidores' || coalesce(' de **' || v_hotel || '**', '') || E'.\n\n- ' || v_when || ' — ' || v_line
        || E'\n\n[Abrir no Sistema Falcon](' || v_link || ')',
      v_link,
      jsonb_build_object('actor', NEW.user_id::text, 'grupo', v_group, 'audit_id', NEW.id),
      CASE WHEN v_is_import THEN now() ELSE now() + interval '10 minutes' END);
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER audit_access_logs_inv_notify AFTER INSERT ON public.audit_access_logs
  FOR EACH ROW EXECUTE FUNCTION public.inv_audit_notify();

-- ===== Leitura =====
CREATE OR REPLACE FUNCTION public.inv_my_access() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'can_access', public.inv_can_access(auth.uid()),
    'can_edit', public.inv_can_edit(auth.uid()),
    'is_finance', public.inv_is_finance(auth.uid()),
    'can_view_full', public.inv_is_finance(auth.uid()) OR public.inv_can_view_full(auth.uid()));
$$;

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
         OR (v_qd IS NOT NULL AND (i.documento LIKE '%'||v_qd||'%' OR i.codigo_externo = v_q)))
  ORDER BY h.name, u.codigo_uh
  LIMIT least(greatest(_limit,1),200) OFFSET greatest(_offset,0);
END $$;

CREATE OR REPLACE FUNCTION public.inv_stats(_hotel_id text DEFAULT NULL, _modalidade text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.inv_can_access(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT jsonb_build_object(
    'total_uhs', count(*),
    'investidores', count(DISTINCT l.investor_id),
    'uhs_pool', count(*) FILTER (WHERE u.modalidade = 'pool'),
    'pendentes_parciais', count(*) FILTER (WHERE coalesce(p.status_dados,'pendente') <> 'completo'))
  INTO v
  FROM public.units u
  LEFT JOIN public.unit_investor_links l ON l.unit_id = u.id AND l.data_fim IS NULL
  LEFT JOIN public.investor_payees p ON p.id = l.payee_id
  WHERE (_hotel_id IS NULL OR u.hotel_id = _hotel_id) AND (_modalidade IS NULL OR u.modalidade = _modalidade);
  RETURN v;
END $$;

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
    'unit', jsonb_build_object('id', u.id, 'hotel_id', u.hotel_id, 'hotel_name', (SELECT name FROM public.hotels WHERE id = u.hotel_id), 'codigo_uh', u.codigo_uh, 'modalidade', u.modalidade),
    'current', CASE WHEN v_cur.id IS NULL THEN NULL ELSE jsonb_build_object('link_id', v_cur.id, 'investor_id', v_cur.investor_id, 'investor_nome', v_cur.inv_nome,
       'investor_documento', CASE WHEN v_full THEN v_cur.inv_doc ELSE public.inv_mask_doc(v_cur.inv_doc) END,
       'codigo_externo', v_cur.codigo_externo, 'ativo', v_cur.ativo, 'data_inicio', v_cur.data_inicio) END,
    'payee', public.inv_payee_json(p, v_full),
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

CREATE OR REPLACE FUNCTION public.inv_investor_detail(_investor_id uuid, _full boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_full boolean; i public.investors; v jsonb;
BEGIN
  IF NOT public.inv_can_access(v_uid) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT * INTO i FROM public.investors WHERE id = _investor_id;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Investidor não encontrado'; END IF;
  v_full := public.inv_is_finance(v_uid) OR (_full AND public.inv_can_view_full(v_uid));
  v := jsonb_build_object(
    'investor', jsonb_build_object('id', i.id, 'nome', i.nome, 'documento', CASE WHEN v_full THEN i.documento ELSE public.inv_mask_doc(i.documento) END,
       'codigo_externo', i.codigo_externo, 'email', i.email, 'telefone', i.telefone, 'ativo', i.ativo),
    'full', v_full,
    'payees', coalesce((SELECT jsonb_agg(public.inv_payee_json(p, v_full) ORDER BY p.created_at) FROM public.investor_payees p WHERE p.investor_id = i.id), '[]'::jsonb),
    'units', coalesce((SELECT jsonb_agg(jsonb_build_object('unit_id', u.id, 'hotel_name', h.name, 'codigo_uh', u.codigo_uh, 'modalidade', u.modalidade,
        'data_inicio', l.data_inicio, 'data_fim', l.data_fim, 'payee_nome', p.nome_favorecido, 'status_dados', coalesce(p.status_dados,'pendente')) ORDER BY l.data_fim NULLS FIRST, h.name, u.codigo_uh)
      FROM public.unit_investor_links l JOIN public.units u ON u.id = l.unit_id JOIN public.hotels h ON h.id = u.hotel_id
      LEFT JOIN public.investor_payees p ON p.id = l.payee_id WHERE l.investor_id = i.id), '[]'::jsonb));
  IF v_full THEN PERFORM public.inv_log('view_bank_details', NULL, i.id::text, jsonb_build_object('tipo','investor')); END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.inv_search_investors(_q text) RETURNS TABLE(id uuid, nome text, documento text, codigo_externo text, ativo boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_qd text := nullif(regexp_replace(coalesce(_q,''),'\D','','g'),'');
BEGIN
  IF NOT public.inv_can_access(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN QUERY SELECT i.id, i.nome, public.inv_mask_doc(i.documento), i.codigo_externo, i.ativo FROM public.investors i
   WHERE coalesce(_q,'') = '' OR i.nome ILIKE '%'||_q||'%' OR (v_qd IS NOT NULL AND i.documento LIKE '%'||v_qd||'%') OR i.codigo_externo = trim(_q)
   ORDER BY i.nome LIMIT 30;
END $$;

CREATE OR REPLACE FUNCTION public.inv_list_payees(_investor_id uuid) RETURNS TABLE(id uuid, nome_favorecido text, documento text, status_dados text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.inv_can_access(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN QUERY SELECT p.id, p.nome_favorecido, public.inv_mask_doc(p.documento_favorecido), p.status_dados FROM public.investor_payees p WHERE p.investor_id = _investor_id ORDER BY p.created_at;
END $$;

CREATE OR REPLACE FUNCTION public.inv_pending_export(_hotel_id text DEFAULT NULL) RETURNS TABLE(hotel_name text, codigo_uh text, investidor text, favorecido text, status_dados text, falta text, observacao text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.inv_can_access(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  PERFORM public.inv_log('export_excel', _hotel_id, NULL, jsonb_build_object('tipo','pendencias'));
  RETURN QUERY
  SELECT h.name, u.codigo_uh, i.nome, p.nome_favorecido, coalesce(p.status_dados,'pendente'),
    CASE WHEN l.id IS NULL THEN 'investidor vinculado' WHEN p.id IS NULL THEN 'favorecido e dados bancários' ELSE
      nullif(concat_ws(', ', CASE WHEN coalesce(p.banco_codigo,p.banco_nome,'') = '' THEN 'banco' END,
        CASE WHEN coalesce(p.agencia,'') = '' THEN 'agência' END, CASE WHEN coalesce(p.conta,'') = '' THEN 'conta' END), '') END,
    p.observacao
  FROM public.units u JOIN public.hotels h ON h.id = u.hotel_id
  LEFT JOIN public.unit_investor_links l ON l.unit_id = u.id AND l.data_fim IS NULL
  LEFT JOIN public.investors i ON i.id = l.investor_id
  LEFT JOIN public.investor_payees p ON p.id = l.payee_id
  WHERE (_hotel_id IS NULL OR u.hotel_id = _hotel_id) AND coalesce(p.status_dados,'pendente') <> 'completo'
  ORDER BY h.name, u.codigo_uh;
END $$;

-- ===== Escrita (somente RI / Master) =====
CREATE OR REPLACE FUNCTION public.inv_require_edit() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN IF NOT public.inv_can_edit(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para editar investidores'; END IF; END $$;

CREATE OR REPLACE FUNCTION public.inv_save_investor(_id uuid, _nome text, _documento text, _codigo_externo text, _email text, _telefone text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_doc text := nullif(regexp_replace(coalesce(_documento,''),'\D','','g'),''); o public.investors; v_changes text[] := '{}';
BEGIN
  PERFORM public.inv_require_edit();
  IF coalesce(trim(_nome),'') = '' THEN RAISE EXCEPTION 'Nome obrigatório'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.investors(nome, documento, codigo_externo, email, telefone, created_by)
    VALUES (trim(_nome), v_doc, nullif(trim(_codigo_externo),''), nullif(trim(_email),''), nullif(trim(_telefone),''), auth.uid()) RETURNING id INTO v_id;
    PERFORM public.inv_log('edit_investor', NULL, v_id::text, jsonb_build_object('grupo', 'inv:'||v_id, 'alvo', trim(_nome), 'link', '/investidores/investidor/'||v_id,
      'texto', 'Investidor cadastrado: ' || trim(_nome)));
    RETURN v_id;
  END IF;
  SELECT * INTO o FROM public.investors WHERE id = _id;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Investidor não encontrado'; END IF;
  IF o.nome IS DISTINCT FROM trim(_nome) THEN v_changes := v_changes || ('nome: ' || o.nome || ' → ' || trim(_nome)); END IF;
  IF o.documento IS DISTINCT FROM v_doc THEN v_changes := v_changes || 'documento atualizado'::text; END IF;
  IF o.email IS DISTINCT FROM nullif(trim(_email),'') OR o.telefone IS DISTINCT FROM nullif(trim(_telefone),'') THEN v_changes := v_changes || 'contato atualizado'::text; END IF;
  UPDATE public.investors SET nome = trim(_nome), documento = v_doc, codigo_externo = nullif(trim(_codigo_externo),''),
    email = nullif(trim(_email),''), telefone = nullif(trim(_telefone),''), updated_at = now() WHERE id = _id;
  IF array_length(v_changes,1) > 0 THEN
    PERFORM public.inv_log('edit_investor', NULL, _id::text, jsonb_build_object('grupo', 'inv:'||_id, 'alvo', trim(_nome), 'link', '/investidores/investidor/'||_id,
      'texto', 'Investidor ' || trim(_nome) || ': ' || array_to_string(v_changes, '; ')));
  END IF;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.inv_set_investor_active(_id uuid, _ativo boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.investors; v_hotel text;
BEGIN
  PERFORM public.inv_require_edit();
  SELECT * INTO o FROM public.investors WHERE id = _id;
  IF o.id IS NULL OR o.ativo = _ativo THEN RETURN; END IF;
  UPDATE public.investors SET ativo = _ativo, updated_at = now() WHERE id = _id;
  SELECT u.hotel_id INTO v_hotel FROM public.unit_investor_links l JOIN public.units u ON u.id = l.unit_id WHERE l.investor_id = _id AND l.data_fim IS NULL LIMIT 1;
  PERFORM public.inv_log('edit_investor', v_hotel, _id::text, jsonb_build_object('grupo','inv:'||_id, 'alvo', o.nome, 'link', '/investidores/investidor/'||_id,
    'texto', 'Investidor ' || o.nome || CASE WHEN _ativo THEN ' reativado' ELSE ' inativado' END));
END $$;

CREATE OR REPLACE FUNCTION public.inv_save_payee(_id uuid, _investor_id uuid, _data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.investor_payees; v_id uuid; v_status text; v_fields text[] := '{}'; v_hotel text; v_unit uuid; v_uh text; v_txt text;
  v_nome text := nullif(trim(_data->>'nome_favorecido'),''); v_doc text := nullif(regexp_replace(coalesce(_data->>'documento_favorecido',''),'\D','','g'),'');
  v_bc text := nullif(trim(_data->>'banco_codigo'),''); v_bn text := nullif(trim(_data->>'banco_nome'),'');
  v_ag text := nullif(trim(_data->>'agencia'),''); v_ct text := nullif(trim(_data->>'conta'),'');
  v_tp text := nullif(trim(_data->>'tipo_chave_pix'),''); v_pk text := nullif(trim(_data->>'chave_pix'),''); v_obs text := nullif(trim(_data->>'observacao'),'');
BEGIN
  PERFORM public.inv_require_edit();
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Nome do favorecido obrigatório'; END IF;
  v_status := public.inv_payee_status(coalesce(v_bc,v_bn), v_ag, v_ct, v_pk);
  IF _id IS NULL THEN
    INSERT INTO public.investor_payees(investor_id, nome_favorecido, documento_favorecido, banco_codigo, banco_nome, agencia, conta, tipo_chave_pix, chave_pix, status_dados, observacao)
    VALUES (_investor_id, v_nome, v_doc, v_bc, v_bn, v_ag, v_ct, v_tp, v_pk, v_status, v_obs) RETURNING id INTO v_id;
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
    IF o.chave_pix IS DISTINCT FROM v_pk OR o.tipo_chave_pix IS DISTINCT FROM v_tp THEN v_fields := v_fields || 'chave PIX'::text; END IF;
    IF o.observacao IS DISTINCT FROM v_obs THEN v_fields := v_fields || 'observação'::text; END IF;
    UPDATE public.investor_payees SET nome_favorecido = v_nome, documento_favorecido = v_doc, banco_codigo = v_bc, banco_nome = v_bn, agencia = v_ag,
      conta = v_ct, tipo_chave_pix = v_tp, chave_pix = v_pk, status_dados = v_status, observacao = v_obs, updated_at = now() WHERE id = _id;
    IF array_length(v_fields,1) IS NULL THEN RETURN v_id; END IF;
    v_txt := 'Favorecido ' || v_nome || ': dados bancários atualizados (' || array_to_string(v_fields, ', ') || ')'
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

CREATE OR REPLACE FUNCTION public.inv_change_link(_unit_id uuid, _investor_id uuid, _payee_id uuid, _motivo text, _data_inicio date DEFAULT current_date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.units; c public.unit_investor_links; v_id uuid; v_old text; v_new text; v_txt text;
BEGIN
  PERFORM public.inv_require_edit();
  IF coalesce(trim(_motivo),'') = '' THEN RAISE EXCEPTION 'Informe o motivo da troca'; END IF;
  SELECT * INTO u FROM public.units WHERE id = _unit_id;
  IF u.id IS NULL THEN RAISE EXCEPTION 'UH não encontrada'; END IF;
  IF _payee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.investor_payees WHERE id = _payee_id AND investor_id = _investor_id) THEN
    RAISE EXCEPTION 'Favorecido não pertence ao investidor'; END IF;
  SELECT * INTO c FROM public.unit_investor_links WHERE unit_id = _unit_id AND data_fim IS NULL FOR UPDATE;
  IF c.id IS NOT NULL THEN
    IF c.investor_id = _investor_id AND c.payee_id IS NOT DISTINCT FROM _payee_id THEN RETURN c.id; END IF;
    IF _data_inicio < c.data_inicio THEN RAISE EXCEPTION 'Data de início anterior ao vínculo vigente'; END IF;
    UPDATE public.unit_investor_links SET data_fim = _data_inicio WHERE id = c.id;
    SELECT nome INTO v_old FROM public.investors WHERE id = c.investor_id;
  END IF;
  INSERT INTO public.unit_investor_links(unit_id, investor_id, payee_id, data_inicio, motivo_troca, created_by)
  VALUES (_unit_id, _investor_id, _payee_id, _data_inicio, trim(_motivo), auth.uid()) RETURNING id INTO v_id;
  SELECT nome INTO v_new FROM public.investors WHERE id = _investor_id;
  IF c.id IS NOT NULL AND c.investor_id = _investor_id THEN
    v_txt := 'UH ' || u.codigo_uh || ': favorecido trocado (' || trim(_motivo) || ')';
  ELSE
    v_txt := 'UH ' || u.codigo_uh || ': investidor ' || coalesce(v_old, '(sem vínculo)') || ' → ' || v_new || ' (' || trim(_motivo) || ')';
  END IF;
  PERFORM public.inv_log('edit_link', u.hotel_id, u.id::text, jsonb_build_object('grupo','unit:'||u.id, 'alvo', 'UH '||u.codigo_uh, 'link', '/investidores/uh/'||u.id, 'texto', v_txt));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.inv_set_modalidade(_unit_ids uuid[], _modalidade text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  PERFORM public.inv_require_edit();
  IF _modalidade NOT IN ('pool','condo') THEN RAISE EXCEPTION 'Modalidade inválida'; END IF;
  FOR r IN SELECT * FROM public.units WHERE id = ANY(_unit_ids) AND modalidade <> _modalidade LOOP
    UPDATE public.units SET modalidade = _modalidade, updated_at = now() WHERE id = r.id;
    PERFORM public.inv_log('edit_modalidade', r.hotel_id, r.id::text, jsonb_build_object('grupo','unit:'||r.id, 'alvo','UH '||r.codigo_uh, 'link','/investidores/uh/'||r.id,
      'texto', 'UH ' || r.codigo_uh || ': modalidade ' || initcap(r.modalidade) || ' → ' || initcap(_modalidade)));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.inv_set_observacao(_payee_ids uuid[], _observacao text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  PERFORM public.inv_require_edit();
  UPDATE public.investor_payees SET observacao = nullif(trim(_observacao),''), updated_at = now() WHERE id = ANY(_payee_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Importação em transação única. _rows: [{codigo_uh, investor:{...}, payee:{...}}]
CREATE OR REPLACE FUNCTION public.inv_import(_hotel_id text, _modalidade text, _rows jsonb, _file_name text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r jsonb; iv jsonb; pv jsonb; v_inv uuid; v_unit uuid; v_payee uuid; v_doc text; v_pdoc text; v_status text; c public.unit_investor_links;
  n_uh int := 0; n_uh_new int := 0; n_inv_new int := 0; n_payee_new int := 0; n_pend int := 0; n_parc int := 0; n_links int := 0;
  v_invs uuid[] := '{}'; v_hotel_name text; v_new boolean;
BEGIN
  PERFORM public.inv_require_edit();
  IF _modalidade NOT IN ('pool','condo') THEN RAISE EXCEPTION 'Modalidade inválida'; END IF;
  SELECT name INTO v_hotel_name FROM public.hotels WHERE id = _hotel_id;
  IF v_hotel_name IS NULL THEN RAISE EXCEPTION 'Hotel inválido'; END IF;
  IF jsonb_array_length(coalesce(_rows,'[]')) = 0 THEN RAISE EXCEPTION 'Planilha sem UHs'; END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    iv := r->'investor'; pv := r->'payee';
    IF coalesce(trim(r->>'codigo_uh'),'') = '' OR coalesce(trim(iv->>'nome'),'') = '' THEN CONTINUE; END IF;
    v_doc := nullif(regexp_replace(coalesce(iv->>'documento',''),'\D','','g'),'');
    v_inv := NULL;
    IF v_doc IS NOT NULL THEN SELECT id INTO v_inv FROM public.investors WHERE documento = v_doc;
    ELSE SELECT id INTO v_inv FROM public.investors WHERE documento IS NULL AND lower(nome) = lower(trim(iv->>'nome')) LIMIT 1; END IF;
    IF v_inv IS NULL THEN
      INSERT INTO public.investors(nome, documento, codigo_externo, email, telefone, created_by)
      VALUES (trim(iv->>'nome'), v_doc, nullif(trim(iv->>'codigo_externo'),''), nullif(trim(iv->>'email'),''), nullif(trim(iv->>'telefone'),''), auth.uid())
      RETURNING id INTO v_inv;
      n_inv_new := n_inv_new + 1;
    ELSE
      UPDATE public.investors SET codigo_externo = coalesce(nullif(trim(iv->>'codigo_externo'),''), codigo_externo),
        email = coalesce(nullif(trim(iv->>'email'),''), email), telefone = coalesce(nullif(trim(iv->>'telefone'),''), telefone), updated_at = now()
      WHERE id = v_inv;
    END IF;
    IF NOT v_inv = ANY(v_invs) THEN v_invs := v_invs || v_inv; END IF;

    SELECT id INTO v_unit FROM public.units WHERE hotel_id = _hotel_id AND codigo_uh = upper(trim(r->>'codigo_uh'));
    IF v_unit IS NULL THEN
      INSERT INTO public.units(hotel_id, codigo_uh, modalidade) VALUES (_hotel_id, upper(trim(r->>'codigo_uh')), _modalidade) RETURNING id INTO v_unit;
      n_uh_new := n_uh_new + 1;
    END IF;
    n_uh := n_uh + 1;

    v_payee := NULL;
    IF pv IS NOT NULL AND coalesce(trim(pv->>'nome_favorecido'),'') <> '' THEN
      v_pdoc := nullif(regexp_replace(coalesce(pv->>'documento_favorecido',''),'\D','','g'),'');
      v_status := public.inv_payee_status(coalesce(nullif(pv->>'banco_codigo',''), nullif(pv->>'banco_nome','')), nullif(pv->>'agencia',''), nullif(pv->>'conta',''), nullif(pv->>'chave_pix',''));
      SELECT id INTO v_payee FROM public.investor_payees WHERE investor_id = v_inv
        AND lower(nome_favorecido) = lower(trim(pv->>'nome_favorecido')) AND documento_favorecido IS NOT DISTINCT FROM v_pdoc LIMIT 1;
      IF v_payee IS NULL THEN
        INSERT INTO public.investor_payees(investor_id, nome_favorecido, documento_favorecido, banco_codigo, banco_nome, agencia, conta, tipo_chave_pix, chave_pix, status_dados, observacao)
        VALUES (v_inv, trim(pv->>'nome_favorecido'), v_pdoc, nullif(pv->>'banco_codigo',''), nullif(pv->>'banco_nome',''), nullif(pv->>'agencia',''), nullif(pv->>'conta',''),
          nullif(pv->>'tipo_chave_pix',''), nullif(pv->>'chave_pix',''), v_status, nullif(pv->>'observacao',''))
        RETURNING id INTO v_payee;
        n_payee_new := n_payee_new + 1;
      ELSE
        UPDATE public.investor_payees SET banco_codigo = nullif(pv->>'banco_codigo',''), banco_nome = nullif(pv->>'banco_nome',''), agencia = nullif(pv->>'agencia',''),
          conta = nullif(pv->>'conta',''), tipo_chave_pix = nullif(pv->>'tipo_chave_pix',''), chave_pix = nullif(pv->>'chave_pix',''), status_dados = v_status,
          observacao = coalesce(nullif(pv->>'observacao',''), observacao), updated_at = now()
        WHERE id = v_payee;
      END IF;
      IF v_status = 'pendente' THEN n_pend := n_pend + 1; ELSIF v_status = 'parcial' THEN n_parc := n_parc + 1; END IF;
    ELSE
      n_pend := n_pend + 1;
    END IF;

    SELECT * INTO c FROM public.unit_investor_links WHERE unit_id = v_unit AND data_fim IS NULL FOR UPDATE;
    IF c.id IS NULL OR c.investor_id <> v_inv OR c.payee_id IS DISTINCT FROM v_payee THEN
      IF c.id IS NOT NULL THEN UPDATE public.unit_investor_links SET data_fim = greatest(current_date, c.data_inicio) WHERE id = c.id; END IF;
      INSERT INTO public.unit_investor_links(unit_id, investor_id, payee_id, data_inicio, motivo_troca, created_by)
      VALUES (v_unit, v_inv, v_payee, greatest(current_date, coalesce(c.data_inicio, current_date)), 'Importação de planilha' || coalesce(' (' || _file_name || ')', ''), auth.uid());
      n_links := n_links + 1;
    END IF;
    c := NULL;
  END LOOP;

  PERFORM public.inv_log('import_investors', _hotel_id, NULL, jsonb_build_object(
    'arquivo', _file_name, 'uhs', n_uh, 'uhs_novas', n_uh_new, 'investidores', array_length(v_invs,1), 'investidores_novos', n_inv_new,
    'favorecidos_novos', n_payee_new, 'pendentes', n_pend, 'parciais', n_parc, 'vinculos_alterados', n_links,
    'link', '/investidores?hotel=' || _hotel_id,
    'texto', 'Importou ' || n_uh || ' UHs de ' || v_hotel_name || ': ' || coalesce(array_length(v_invs,1),0) || ' investidores (' || n_inv_new || ' novos), '
       || n_pend || ' pendentes, ' || n_parc || ' parciais, ' || n_links || ' vínculos criados/alterados'));

  RETURN jsonb_build_object('uhs', n_uh, 'uhs_novas', n_uh_new, 'investidores', coalesce(array_length(v_invs,1),0), 'investidores_novos', n_inv_new,
    'favorecidos_novos', n_payee_new, 'pendentes', n_pend, 'parciais', n_parc, 'vinculos', n_links);
END $$;

-- View para fase 2: UHs Pool com vínculo vigente
CREATE VIEW public.v_pool_units_current WITH (security_invoker = true) AS
  SELECT u.id AS unit_id, u.hotel_id, u.codigo_uh, l.id AS link_id, l.investor_id, l.payee_id, l.data_inicio
  FROM public.units u JOIN public.unit_investor_links l ON l.unit_id = u.id AND l.data_fim IS NULL
  WHERE u.modalidade = 'pool';
GRANT SELECT ON public.v_pool_units_current TO service_role;

-- Configuração opcional (desligada)
INSERT INTO public.system_settings(key, value) VALUES ('investors_daily_digest_enabled', 'false') ON CONFLICT (key) DO NOTHING;

-- ===== Permissões de execução =====
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'inv_can_edit(uuid)','inv_is_finance(uuid)','inv_can_view_full(uuid)','inv_can_access(uuid)','inv_log(text,text,text,jsonb)','inv_audit_notify()',
    'inv_require_edit()','inv_payee_json(public.investor_payees,boolean)',
    'inv_my_access()','inv_list_units(text,text,text,text,int,int)','inv_stats(text,text)','inv_unit_detail(uuid,boolean)','inv_investor_detail(uuid,boolean)',
    'inv_search_investors(text)','inv_list_payees(uuid)','inv_pending_export(text)','inv_save_investor(uuid,text,text,text,text,text)',
    'inv_set_investor_active(uuid,boolean)','inv_save_payee(uuid,uuid,jsonb)','inv_change_link(uuid,uuid,uuid,text,date)',
    'inv_set_modalidade(uuid[],text)','inv_set_observacao(uuid[],text)','inv_import(text,text,jsonb,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'inv_my_access()','inv_list_units(text,text,text,text,int,int)','inv_stats(text,text)','inv_unit_detail(uuid,boolean)','inv_investor_detail(uuid,boolean)',
    'inv_search_investors(text)','inv_list_payees(uuid)','inv_pending_export(text)','inv_save_investor(uuid,text,text,text,text,text)',
    'inv_set_investor_active(uuid,boolean)','inv_save_payee(uuid,uuid,jsonb)','inv_change_link(uuid,uuid,uuid,text,date)',
    'inv_set_modalidade(uuid[],text)','inv_set_observacao(uuid[],text)','inv_import(text,text,jsonb,text)',
    'inv_can_access(uuid)','inv_can_edit(uuid)','inv_is_finance(uuid)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
