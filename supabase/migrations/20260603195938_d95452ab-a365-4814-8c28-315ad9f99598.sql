
-- ============================================================
-- DATA MIGRATION
-- ============================================================

-- 3 equipe → controladoria
INSERT INTO public.user_roles (user_id, role)
SELECT ur.user_id, 'controladoria'::public.app_role
FROM public.user_roles ur
JOIN public.profiles p ON p.user_id = ur.user_id
WHERE ur.role = 'financeiro'
  AND COALESCE(p.financeiro_subrole, 'coordenadora') = 'equipe'
ON CONFLICT (user_id, role) DO NOTHING;

-- 1 coordenadora → patronos
INSERT INTO public.user_roles (user_id, role)
SELECT ur.user_id, 'patronos'::public.app_role
FROM public.user_roles ur
JOIN public.profiles p ON p.user_id = ur.user_id
WHERE ur.role = 'financeiro'
  AND COALESCE(p.financeiro_subrole, 'coordenadora') = 'coordenadora'
ON CONFLICT (user_id, role) DO NOTHING;

-- Remove old financeiro role
DELETE FROM public.user_roles WHERE role = 'financeiro';

-- Clear deprecated subrole field
UPDATE public.profiles SET financeiro_subrole = NULL WHERE financeiro_subrole IS NOT NULL;

-- ============================================================
-- REWRITE SECURITY DEFINER FUNCTIONS (no more 'financeiro' literal)
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_global_data_access(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_master(_user_id)
      OR public.has_role(_user_id, 'controladoria')
      OR public.has_role(_user_id, 'patronos')
      OR public.has_role(_user_id, 'ri')
      OR public.has_role(_user_id, 'rh')
      OR public.has_role(_user_id, 'operacoes')
      OR public.has_role(_user_id, 'viewer');
$$;

CREATE OR REPLACE FUNCTION public.is_ap_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_master(_user_id)
      OR public.has_role(_user_id, 'controladoria')
      OR public.has_role(_user_id, 'patronos');
$$;

CREATE OR REPLACE FUNCTION public.is_ar_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_master(_user_id)
      OR public.has_role(_user_id, 'controladoria')
      OR public.has_role(_user_id, 'patronos');
$$;

CREATE OR REPLACE FUNCTION public.is_hotel_allowed(_user_id uuid, _hotel_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    public.is_master(_user_id)
    OR public.has_role(_user_id, 'controladoria')
    OR public.has_role(_user_id, 'patronos')
    OR public.has_role(_user_id, 'ri')
    OR public.has_role(_user_id, 'viewer')
    OR EXISTS (
      SELECT 1 FROM public.user_hotels
      WHERE user_id = _user_id AND hotel_id = _hotel_id
    );
$$;

-- Upload retroativo de DRE: apenas Master
CREATE OR REPLACE FUNCTION public.is_dre_uploader(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_master(_user_id);
$$;

-- Mantém o nome para compatibilidade; agora representa "patronos"
CREATE OR REPLACE FUNCTION public.is_financeiro_coordenadora(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.has_role(_user_id, 'patronos');
$$;

-- Equipe não existe mais
CREATE OR REPLACE FUNCTION public.is_financeiro_equipe(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT false;
$$;

-- Helper explícito novo
CREATE OR REPLACE FUNCTION public.is_patronos(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.has_role(_user_id, 'patronos');
$$;

-- Apenas patronos (ou master) marca como Pago
CREATE OR REPLACE FUNCTION public.enforce_ap_payment_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF NEW.payment_status = 'pago' THEN
      IF NOT (public.is_master(v_uid) OR public.is_patronos(v_uid)) THEN
        RAISE EXCEPTION 'Apenas patronos pode marcar como Pago';
      END IF;
      NEW.payment_paid_at := COALESCE(NEW.payment_paid_at, now());
    END IF;
    NEW.payment_marked_by := v_uid;
    NEW.payment_marked_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- REWRITE NOTIFY TRIGGERS (substituir audiencia 'financeiro' por 'patronos')
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_on_closing_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_hotel public.hotels%ROWTYPE;
  v_period text;
  v_link_dre text;
  v_link_carta text;
  v_link_envio text;
  v_link_fin text;
  v_recipients jsonb;
  v_subject text;
  v_body text;
BEGIN
  SELECT * INTO v_hotel FROM public.hotels WHERE id = NEW.hotel_id;
  v_period := public.month_pt(NEW.month) || '/' || NEW.year;
  v_link_dre := '/fechamento/dre?closing=' || NEW.id::text;
  v_link_carta := '/fechamento/carta?closing=' || NEW.id::text;
  v_link_envio := '/fechamento/envio';
  v_link_fin := '/fechamento/financeiro?closing=' || NEW.id::text;

  IF NEW.status_dre = 'aguardando_gop' AND OLD.status_dre IS DISTINCT FROM 'aguardando_gop' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'gop')), '[]'::jsonb)
      INTO v_recipients FROM public.users_with_role_for_hotel('gop', NEW.hotel_id);
    v_subject := '[' || v_hotel.name || '] DRE aprovada pela Controladoria — ' || v_period;
    v_body := 'A Controladoria aprovou a DRE de **' || v_hotel.name || '** (' || v_period || ').' || E'\n\n' ||
      'Você tem **48 horas** para revisar e aprovar, ou substituir o arquivo se necessário.' || E'\n\n' ||
      '[Revisar DRE](' || v_link_dre || ')';
    PERFORM public.enqueue_workflow_notification('dre_controladoria_approved', NEW.id, NEW.hotel_id, v_recipients, v_subject, v_body, v_link_dre,
      jsonb_build_object('sla_hours', 48));
  END IF;

  IF NEW.status_dre = 'aguardando_fernando' AND OLD.status_dre IS DISTINCT FROM 'aguardando_fernando' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'fernando')), '[]'::jsonb)
      INTO v_recipients FROM public.users_with_role_global('fernando');
    v_subject := '[' || v_hotel.name || '] DRE aguardando aprovação final — ' || v_period;
    v_body := 'A DRE de **' || v_hotel.name || '** (' || v_period || ') foi aprovada pelo GOP e aguarda sua revisão final.' || E'\n\n' ||
      'Você tem **48 horas** para aprovar ou devolver com comentários.' || E'\n\n' ||
      '[Revisar DRE](' || v_link_dre || ')';
    PERFORM public.enqueue_workflow_notification('dre_gop_approved', NEW.id, NEW.hotel_id, v_recipients, v_subject, v_body, v_link_dre,
      jsonb_build_object('sla_hours', 48));
  END IF;

  IF NEW.status_dre = 'aprovado' AND OLD.status_dre IS DISTINCT FROM 'aprovado' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'patronos')), '[]'::jsonb)
      INTO v_recipients FROM public.users_with_role_global('patronos');
    v_subject := '[' || v_hotel.name || '] DRE aprovada — distribuição liberada — ' || v_period;
    v_body := 'A DRE de **' || v_hotel.name || '** (' || v_period || ') foi aprovada por Fernando.' || E'\n\n' ||
      'A **distribuição está liberada**. Acesse o módulo Financeiro para registrar a decisão final.' || E'\n\n' ||
      '[Abrir Financeiro](' || v_link_fin || ')';
    PERFORM public.enqueue_workflow_notification('dre_fernando_approved', NEW.id, NEW.hotel_id, v_recipients, v_subject, v_body, v_link_fin,
      jsonb_build_object('audience', 'patronos'));

    IF NEW.hotel_id <> 'ibis-budget-recife' THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'gg')), '[]'::jsonb)
        INTO v_recipients FROM public.users_with_role_for_hotel('gg', NEW.hotel_id);
      v_subject := '[' || v_hotel.name || '] Carta ao Investidor liberada — ' || v_period;
      v_body := 'A DRE foi aprovada por Fernando e você já pode iniciar a **Carta ao Investidor** de ' ||
        v_period || '.' || E'\n\n' ||
        'No sistema, preencha:' || E'\n' ||
        '- **Fundo de Reserva**' || E'\n' ||
        '- **RPS** (Reputation Performance Score)' || E'\n' ||
        '- **Destaques do Mês** (eventos, fotos, observações)' || E'\n\n' ||
        'Após preencher, gere o texto via IA, revise e aprove.' || E'\n\n' ||
        '[Abrir Carta ao Investidor](' || v_link_carta || ')';
      PERFORM public.enqueue_workflow_notification('dre_fernando_approved', NEW.id, NEW.hotel_id, v_recipients, v_subject, v_body, v_link_carta,
        jsonb_build_object('audience', 'gg'));
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'gop')), '[]'::jsonb)
      INTO v_recipients FROM public.users_with_role_for_hotel('gop', NEW.hotel_id);
    v_subject := '[' || v_hotel.name || '] DRE aprovada por Fernando — ' || v_period;
    v_body := 'Fernando aprovou a DRE de **' || v_hotel.name || '** (' || v_period || ').' ||
      E'\n\n' || '[Ver DRE](' || v_link_dre || ')';
    PERFORM public.enqueue_workflow_notification('dre_fernando_approved', NEW.id, NEW.hotel_id, v_recipients, v_subject, v_body, v_link_dre,
      jsonb_build_object('audience', 'gop'));

    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'controladoria')), '[]'::jsonb)
      INTO v_recipients FROM public.users_with_role_global('controladoria');
    v_subject := '[' || v_hotel.name || '] DRE aprovada por Fernando — ' || v_period;
    PERFORM public.enqueue_workflow_notification('dre_fernando_approved', NEW.id, NEW.hotel_id, v_recipients, v_subject, v_body, v_link_dre,
      jsonb_build_object('audience', 'controladoria'));
  END IF;

  IF NEW.status_dre = 'devolvido' AND OLD.status_dre IS DISTINCT FROM 'devolvido' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'controladoria')), '[]'::jsonb)
      INTO v_recipients FROM public.users_with_role_global('controladoria');
    v_subject := '[' || v_hotel.name || '] DRE devolvida — ' || v_period;
    v_body := 'A DRE de **' || v_hotel.name || '** (' || v_period || ') foi devolvida e precisa de ajustes.' || E'\n\n' ||
      'SLA: **48 horas** para revisar e reenviar.' || E'\n\n' ||
      '[Abrir DRE](' || v_link_dre || ')';
    PERFORM public.enqueue_workflow_notification('dre_returned', NEW.id, NEW.hotel_id, v_recipients, v_subject, v_body, v_link_dre,
      jsonb_build_object('sla_hours', 48));
  END IF;

  IF NEW.status_carta = 'aguardando_fernando' AND OLD.status_carta = 'aguardando_gg' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'gop')), '[]'::jsonb)
      INTO v_recipients FROM public.users_with_role_for_hotel('gop', NEW.hotel_id);
    v_subject := '[' || v_hotel.name || '] Carta aprovada pelo GG — revisão necessária — ' || v_period;
    v_body := 'O GG aprovou a Carta ao Investidor de **' || v_hotel.name || '** (' || v_period || ').' || E'\n\n' ||
      'Você tem **24 horas** para revisar e aprovar, comentar pedindo alterações ou solicitar regeneração do texto.' || E'\n\n' ||
      '[Revisar Carta](' || v_link_carta || ')';
    PERFORM public.enqueue_workflow_notification('carta_gg_approved', NEW.id, NEW.hotel_id, v_recipients, v_subject, v_body, v_link_carta,
      jsonb_build_object('sla_hours', 24));

    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'fernando')), '[]'::jsonb)
      INTO v_recipients FROM public.users_with_role_global('fernando');
    v_subject := '[' || v_hotel.name || '] Carta aguardando revisão final — ' || v_period;
    v_body := 'A Carta de **' || v_hotel.name || '** (' || v_period || ') aguarda sua revisão final.' || E'\n\n' ||
      'SLA: **24 horas**. Opções: aprovar, comentar pedindo alterações ou solicitar regeneração.' || E'\n\n' ||
      '[Revisar Carta](' || v_link_carta || ')';
    PERFORM public.enqueue_workflow_notification('carta_gop_approved', NEW.id, NEW.hotel_id, v_recipients, v_subject, v_body, v_link_carta,
      jsonb_build_object('sla_hours', 24));

    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'ri')), '[]'::jsonb)
      INTO v_recipients FROM public.users_with_role_global('ri');
    v_subject := '[' || v_hotel.name || '] Carta aprovada pelo GG — ' || v_period;
    v_body := 'O GG aprovou a Carta de **' || v_hotel.name ||
      '** (' || v_period || '). Aguardando revisão do GOP e Fernando.' ||
      E'\n\n' || '[Ver Carta](' || v_link_carta || ')';
    PERFORM public.enqueue_workflow_notification('carta_gg_approved', NEW.id, NEW.hotel_id, v_recipients, v_subject, v_body, v_link_carta,
      jsonb_build_object('audience', 'ri'));
  END IF;

  IF NEW.status_carta = 'aprovado' AND OLD.status_carta IS DISTINCT FROM 'aprovado' THEN
    IF NEW.status_dre = 'aprovado' THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'ri')), '[]'::jsonb)
        INTO v_recipients FROM public.users_with_role_global('ri');
      v_subject := '[' || v_hotel.name || '] Carta pronta para envio — ' || v_period;
      v_body := 'A Carta ao Investidor de **' || v_hotel.name || '** (' || v_period || ') está aprovada por Fernando ' ||
        'e a DRE também já está aprovada.' || E'\n\n' ||
        'A Carta está **pronta para envio aos investidores**.' || E'\n\n' ||
        '[Abrir módulo de Envio](' || v_link_envio || ')';
      PERFORM public.enqueue_workflow_notification('carta_fernando_approved', NEW.id, NEW.hotel_id, v_recipients, v_subject, v_body, v_link_envio,
        jsonb_build_object('audience', 'ri'));
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'gop')), '[]'::jsonb)
      INTO v_recipients FROM public.users_with_role_for_hotel('gop', NEW.hotel_id);
    v_subject := '[' || v_hotel.name || '] Carta aprovada por Fernando — ' || v_period;
    v_body := 'Fernando aprovou a Carta ao Investidor de **' ||
      v_hotel.name || '** (' || v_period || ').' ||
      E'\n\n' || '[Ver Carta](' || v_link_carta || ')';
    PERFORM public.enqueue_workflow_notification('carta_fernando_approved', NEW.id, NEW.hotel_id, v_recipients, v_subject, v_body, v_link_carta,
      jsonb_build_object('audience', 'gop'));
  END IF;

  IF NEW.status_carta = 'devolvido' AND OLD.status_carta IS DISTINCT FROM 'devolvido' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'gg')), '[]'::jsonb)
      INTO v_recipients FROM public.users_with_role_for_hotel('gg', NEW.hotel_id);
    v_subject := '[' || v_hotel.name || '] Carta devolvida — ' || v_period;
    v_body := 'A Carta ao Investidor de **' || v_hotel.name || '** (' || v_period || ') foi devolvida.' || E'\n\n' ||
      'SLA: **24 horas** para realizar as alterações.' || E'\n\n' ||
      '[Abrir Carta](' || v_link_carta || ')';
    PERFORM public.enqueue_workflow_notification('carta_returned', NEW.id, NEW.hotel_id, v_recipients, v_subject, v_body, v_link_carta,
      jsonb_build_object('sla_hours', 24));
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_dre_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_closing public.closings%ROWTYPE;
  v_hotel public.hotels%ROWTYPE;
  v_recipients jsonb;
  v_link text;
  v_period text;
  v_is_first boolean;
  v_event public.notification_event;
  v_subject text;
  v_body text;
  v_fin_recipients jsonb;
  v_gg jsonb;
  v_gop jsonb;
BEGIN
  SELECT * INTO v_closing FROM public.closings WHERE id = NEW.closing_id;
  SELECT * INTO v_hotel FROM public.hotels WHERE id = v_closing.hotel_id;
  v_period := public.month_pt(v_closing.month) || '/' || v_closing.year;
  v_link := '/fechamento/dre?closing=' || v_closing.id::text;
  v_is_first := (NEW.version_number = 1);
  v_event := CASE WHEN v_is_first THEN 'dre_first_preview' ELSE 'dre_new_preview' END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'gg')), '[]'::jsonb)
    INTO v_gg FROM public.users_with_role_for_hotel('gg', v_closing.hotel_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'gop')), '[]'::jsonb)
    INTO v_gop FROM public.users_with_role_for_hotel('gop', v_closing.hotel_id);
  v_recipients := v_gg || v_gop;

  v_subject := CASE WHEN v_is_first
    THEN '[' || v_hotel.name || '] 1ª prévia da DRE de ' || v_period || ' disponível'
    ELSE '[' || v_hotel.name || '] Nova prévia (v' || NEW.version_number || ') da DRE de ' || v_period
  END;
  v_body := 'A Controladoria postou a ' || (CASE WHEN v_is_first THEN '1ª prévia' ELSE 'versão v' || NEW.version_number END) ||
    ' da DRE de **' || v_hotel.name || '** referente a **' || v_period || '**.' || E'\n\n' ||
    'Você pode comentar, aprovar ou devolver. SLA: **48 horas**.' || E'\n\n' ||
    '[Abrir DRE no sistema](' || v_link || ')';

  PERFORM public.enqueue_workflow_notification(v_event, v_closing.id, v_closing.hotel_id, v_recipients, v_subject, v_body, v_link,
    jsonb_build_object('version', NEW.version_number, 'sla_hours', 48));

  IF v_is_first THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'patronos')), '[]'::jsonb)
      INTO v_fin_recipients FROM public.users_with_role_global('patronos');
    PERFORM public.enqueue_workflow_notification('dre_first_preview', v_closing.id, v_closing.hotel_id, v_fin_recipients,
      '[' || v_hotel.name || '] Estimativa de distribuição — ' || v_period,
      'A 1ª prévia da DRE de **' || v_hotel.name || '** (' || v_period || ') foi postada. ' ||
      'Acesse o sistema para visualizar a **previsão estimada de distribuição**.' || E'\n\n' ||
      '[Visualizar estimativa](' || v_link || ')',
      v_link, jsonb_build_object('version', NEW.version_number, 'audience', 'patronos'));
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- REWRITE POLICIES (no more 'financeiro' literal)
-- ============================================================

-- ap_anticipation
DROP POLICY IF EXISTS ap_anticipation_financeiro_master_all ON public.ap_anticipation;
CREATE POLICY ap_anticipation_managers_all ON public.ap_anticipation
  FOR ALL TO authenticated
  USING (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'controladoria') OR public.has_role(auth.uid(), 'patronos'))
  WITH CHECK (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'controladoria') OR public.has_role(auth.uid(), 'patronos'));

-- ap_card_receivable
DROP POLICY IF EXISTS ap_card_receivable_financeiro_master ON public.ap_card_receivable;
CREATE POLICY ap_card_receivable_managers ON public.ap_card_receivable
  FOR ALL
  USING (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'controladoria') OR public.has_role(auth.uid(), 'patronos'))
  WITH CHECK (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'controladoria') OR public.has_role(auth.uid(), 'patronos'));

-- ap_notification_log
DROP POLICY IF EXISTS ap_notification_log_financeiro_master ON public.ap_notification_log;
CREATE POLICY ap_notification_log_managers ON public.ap_notification_log
  FOR ALL
  USING (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'controladoria') OR public.has_role(auth.uid(), 'patronos'))
  WITH CHECK (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'controladoria') OR public.has_role(auth.uid(), 'patronos'));

-- ar_client_contracts
DROP POLICY IF EXISTS ar_contracts_delete_scoped ON public.ar_client_contracts;
CREATE POLICY ar_contracts_delete_scoped ON public.ar_client_contracts
  FOR DELETE TO authenticated
  USING (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'controladoria') OR public.has_role(auth.uid(), 'patronos'));

DROP POLICY IF EXISTS ar_contracts_insert_scoped ON public.ar_client_contracts;
CREATE POLICY ar_contracts_insert_scoped ON public.ar_client_contracts
  FOR INSERT TO authenticated
  WITH CHECK (
    (created_by = auth.uid())
    AND (
      public.is_master(auth.uid())
      OR public.has_role(auth.uid(), 'controladoria')
      OR public.has_role(auth.uid(), 'patronos')
      OR ((public.has_role(auth.uid(), 'adm') OR public.has_role(auth.uid(), 'gg')) AND public.is_hotel_allowed(auth.uid(), hotel_id))
    )
  );

DROP POLICY IF EXISTS ar_contracts_select_scoped ON public.ar_client_contracts;
CREATE POLICY ar_contracts_select_scoped ON public.ar_client_contracts
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'controladoria')
    OR public.has_role(auth.uid(), 'patronos')
    OR public.is_hotel_allowed(auth.uid(), hotel_id)
  );

DROP POLICY IF EXISTS ar_contracts_update_scoped ON public.ar_client_contracts;
CREATE POLICY ar_contracts_update_scoped ON public.ar_client_contracts
  FOR UPDATE TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'controladoria')
    OR public.has_role(auth.uid(), 'patronos')
    OR ((public.has_role(auth.uid(), 'adm') OR public.has_role(auth.uid(), 'gg')) AND public.is_hotel_allowed(auth.uid(), hotel_id))
  )
  WITH CHECK (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'controladoria')
    OR public.has_role(auth.uid(), 'patronos')
    OR ((public.has_role(auth.uid(), 'adm') OR public.has_role(auth.uid(), 'gg')) AND public.is_hotel_allowed(auth.uid(), hotel_id))
  );

-- ar_open_folio_date_history
DROP POLICY IF EXISTS ar_ofdh_select_scoped ON public.ar_open_folio_date_history;
CREATE POLICY ar_ofdh_select_scoped ON public.ar_open_folio_date_history
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'controladoria')
    OR public.has_role(auth.uid(), 'patronos')
    OR public.is_hotel_allowed(auth.uid(), hotel_id)
  );

-- ar_open_folio_entries
DROP POLICY IF EXISTS ar_of_select_scoped ON public.ar_open_folio_entries;
CREATE POLICY ar_of_select_scoped ON public.ar_open_folio_entries
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'controladoria')
    OR public.has_role(auth.uid(), 'patronos')
    OR ((hotel_id IS NOT NULL) AND public.is_hotel_allowed(auth.uid(), hotel_id))
  );

-- ar_open_folio_notes
DROP POLICY IF EXISTS ar_ofn_select_scoped ON public.ar_open_folio_notes;
CREATE POLICY ar_ofn_select_scoped ON public.ar_open_folio_notes
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'controladoria')
    OR public.has_role(auth.uid(), 'patronos')
    OR public.is_hotel_allowed(auth.uid(), hotel_id)
  );

-- ar_to_invoice_entries
DROP POLICY IF EXISTS ar_ti_select_scoped ON public.ar_to_invoice_entries;
CREATE POLICY ar_ti_select_scoped ON public.ar_to_invoice_entries
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'controladoria')
    OR public.has_role(auth.uid(), 'patronos')
    OR ((hotel_id IS NOT NULL) AND public.is_hotel_allowed(auth.uid(), hotel_id))
  );

-- ap_entries: remover GG do UPDATE (GG não acessa AP)
DROP POLICY IF EXISTS ap_entries_update_scoped ON public.ap_entries;
CREATE POLICY ap_entries_update_managers ON public.ap_entries
  FOR UPDATE TO authenticated
  USING (public.is_ap_manager(auth.uid()) AND public.is_hotel_allowed(auth.uid(), hotel_id))
  WITH CHECK (public.is_ap_manager(auth.uid()) AND public.is_hotel_allowed(auth.uid(), hotel_id));

-- ap_documents: remover GG (apenas managers)
DROP POLICY IF EXISTS ap_documents_delete_scoped ON public.ap_documents;
CREATE POLICY ap_documents_delete_managers ON public.ap_documents
  FOR DELETE TO authenticated
  USING (public.is_hotel_allowed(auth.uid(), hotel_id) AND public.is_ap_manager(auth.uid()));

DROP POLICY IF EXISTS ap_documents_insert_scoped ON public.ap_documents;
CREATE POLICY ap_documents_insert_managers ON public.ap_documents
  FOR INSERT TO authenticated
  WITH CHECK ((uploaded_by = auth.uid()) AND public.is_hotel_allowed(auth.uid(), hotel_id) AND public.is_ap_manager(auth.uid()));

DROP POLICY IF EXISTS ap_documents_update_scoped ON public.ap_documents;
CREATE POLICY ap_documents_update_managers ON public.ap_documents
  FOR UPDATE TO authenticated
  USING (public.is_hotel_allowed(auth.uid(), hotel_id) AND public.is_ap_manager(auth.uid()));

-- ap_entries SELECT: GG não vê AP. Bloquear leitura para GG.
DROP POLICY IF EXISTS ap_entries_select_scoped ON public.ap_entries;
CREATE POLICY ap_entries_select_scoped ON public.ap_entries
  FOR SELECT TO authenticated
  USING (
    public.is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT public.has_role(auth.uid(), 'viewer'::public.app_role) IS NOT TRUE  -- keep viewer access (read-only) by NOT excluding
    AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
    AND NOT public.has_role(auth.uid(), 'gg'::public.app_role)
  );

-- Corrigir lógica acima: viewer DEVE poder ver. Refaço sem o NOT IS NOT.
DROP POLICY IF EXISTS ap_entries_select_scoped ON public.ap_entries;
CREATE POLICY ap_entries_select_scoped ON public.ap_entries
  FOR SELECT TO authenticated
  USING (
    public.is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
    AND NOT public.has_role(auth.uid(), 'gg'::public.app_role)
  );

-- ap_documents SELECT também bloqueia GG
DROP POLICY IF EXISTS ap_documents_select_scoped ON public.ap_documents;
CREATE POLICY ap_documents_select_scoped ON public.ap_documents
  FOR SELECT TO authenticated
  USING (
    public.is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
    AND NOT public.has_role(auth.uid(), 'gg'::public.app_role)
  );

-- ap_uploads SELECT bloqueia GG
DROP POLICY IF EXISTS ap_uploads_select_scoped ON public.ap_uploads;
CREATE POLICY ap_uploads_select_scoped ON public.ap_uploads
  FOR SELECT TO authenticated
  USING (
    public.is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
    AND NOT public.has_role(auth.uid(), 'gg'::public.app_role)
  );

-- ap_bank_balance SELECT bloqueia GG também
DROP POLICY IF EXISTS ap_bank_balance_select_scoped ON public.ap_bank_balance;
CREATE POLICY ap_bank_balance_select_scoped ON public.ap_bank_balance
  FOR SELECT TO authenticated
  USING (
    public.is_hotel_allowed(auth.uid(), hotel_id)
    AND NOT public.has_role(auth.uid(), 'ri'::public.app_role)
    AND NOT public.has_role(auth.uid(), 'gg'::public.app_role)
  );

-- GRANTs (idempotente)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
