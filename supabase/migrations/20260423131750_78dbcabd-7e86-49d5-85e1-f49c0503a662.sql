-- ============================================================================
-- FILA DE NOTIFICAÇÕES DO WORKFLOW DE FECHAMENTO
-- ============================================================================

CREATE TYPE public.notification_event AS ENUM (
  'dre_first_preview',
  'dre_comment',
  'dre_new_preview',
  'dre_controladoria_approved',
  'dre_gop_approved',
  'dre_fernando_approved',
  'dre_returned',
  'carta_gg_approved',
  'carta_comment',
  'carta_gop_approved',
  'carta_fernando_approved',
  'carta_returned'
);

CREATE TYPE public.notification_status AS ENUM ('pending', 'dispatched', 'failed', 'skipped');

CREATE TABLE public.notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event public.notification_event NOT NULL,
  closing_id uuid NOT NULL REFERENCES public.closings(id) ON DELETE CASCADE,
  hotel_id text NOT NULL,
  recipient_user_id uuid NOT NULL,
  recipient_email text,
  recipient_role text,
  subject text NOT NULL,
  body_md text NOT NULL,
  link_url text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.notification_status NOT NULL DEFAULT 'pending',
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_queue_status ON public.notification_queue(status, scheduled_at);
CREATE INDEX idx_notification_queue_closing ON public.notification_queue(closing_id);
CREATE INDEX idx_notification_queue_recipient ON public.notification_queue(recipient_user_id, created_at DESC);

ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_queue_select_master" ON public.notification_queue
  FOR SELECT TO authenticated
  USING (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'processos') OR recipient_user_id = auth.uid());

CREATE POLICY "notification_queue_master_modify" ON public.notification_queue
  FOR ALL TO authenticated
  USING (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'processos'))
  WITH CHECK (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'processos'));

CREATE TABLE public.notification_unsubscribes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event public.notification_event,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event)
);

ALTER TABLE public.notification_unsubscribes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unsub_select_self" ON public.notification_unsubscribes
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_master(auth.uid()));
CREATE POLICY "unsub_insert_self" ON public.notification_unsubscribes
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "unsub_delete_self" ON public.notification_unsubscribes
  FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.is_master(auth.uid()));

-- ============================================================================
-- HELPERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.users_with_role_for_hotel(_role public.app_role, _hotel_id text)
RETURNS TABLE(user_id uuid, email text, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.user_id, p.email, p.display_name
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = _role
  JOIN public.user_hotels uh ON uh.user_id = p.user_id AND uh.hotel_id = _hotel_id
  WHERE p.status = 'active' AND p.email IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.users_with_role_global(_role public.app_role)
RETURNS TABLE(user_id uuid, email text, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.user_id, p.email, p.display_name
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = _role
  WHERE p.status = 'active' AND p.email IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.is_unsubscribed(_user_id uuid, _event public.notification_event)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.notification_unsubscribes
    WHERE user_id = _user_id AND (event IS NULL OR event = _event)
  );
$$;

CREATE OR REPLACE FUNCTION public.month_pt(_m int)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
  SELECT (ARRAY['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'])[_m];
$$;

CREATE OR REPLACE FUNCTION public.enqueue_workflow_notification(
  _event public.notification_event,
  _closing_id uuid,
  _hotel_id text,
  _recipients jsonb,
  _subject text,
  _body_md text,
  _link_url text,
  _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r jsonb;
  inserted int := 0;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(_recipients) LOOP
    IF (r->>'user_id') IS NULL OR (r->>'email') IS NULL THEN CONTINUE; END IF;
    IF public.is_unsubscribed((r->>'user_id')::uuid, _event) THEN CONTINUE; END IF;
    INSERT INTO public.notification_queue (
      event, closing_id, hotel_id, recipient_user_id, recipient_email,
      recipient_role, subject, body_md, link_url, payload
    ) VALUES (
      _event, _closing_id, _hotel_id, (r->>'user_id')::uuid, r->>'email',
      r->>'role', _subject, _body_md, _link_url, _payload
    );
    inserted := inserted + 1;
  END LOOP;
  RETURN inserted;
END;
$$;

-- ============================================================================
-- TRIGGER: nova versão DRE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.notify_on_dre_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'financeiro')), '[]'::jsonb)
      INTO v_fin_recipients FROM public.users_with_role_global('financeiro');
    PERFORM public.enqueue_workflow_notification('dre_first_preview', v_closing.id, v_closing.hotel_id, v_fin_recipients,
      '[' || v_hotel.name || '] Estimativa de distribuição — ' || v_period,
      'A 1ª prévia da DRE de **' || v_hotel.name || '** (' || v_period || ') foi postada. ' ||
      'Acesse o sistema para visualizar a **previsão estimada de distribuição**.' || E'\n\n' ||
      '[Visualizar estimativa](' || v_link || ')',
      v_link, jsonb_build_object('version', NEW.version_number, 'audience', 'financeiro'));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_dre_version ON public.dre_versions;
CREATE TRIGGER trg_notify_on_dre_version
  AFTER INSERT ON public.dre_versions
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_dre_version();

-- ============================================================================
-- TRIGGER: comentário DRE/Carta
-- ============================================================================
CREATE OR REPLACE FUNCTION public.notify_on_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_closing public.closings%ROWTYPE;
  v_hotel public.hotels%ROWTYPE;
  v_period text;
  v_link text;
  v_event public.notification_event;
  v_subject text;
  v_body text;
  v_recipients jsonb := '[]'::jsonb;
  v_author_name text;
BEGIN
  SELECT * INTO v_closing FROM public.closings WHERE id = NEW.closing_id;
  SELECT * INTO v_hotel FROM public.hotels WHERE id = v_closing.hotel_id;
  v_period := public.month_pt(v_closing.month) || '/' || v_closing.year;
  v_link := '/fechamento/' || NEW.stage::text || '?closing=' || v_closing.id::text;
  v_event := CASE WHEN NEW.stage = 'dre' THEN 'dre_comment'::public.notification_event
                  WHEN NEW.stage = 'carta' THEN 'carta_comment'::public.notification_event
                  ELSE NULL END;
  IF v_event IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(display_name, email) INTO v_author_name
    FROM public.profiles WHERE user_id = NEW.author_id;

  WITH all_recipients AS (
    SELECT user_id, email, 'gg'::text AS role FROM public.users_with_role_for_hotel('gg', v_closing.hotel_id)
    UNION
    SELECT user_id, email, 'gop'::text FROM public.users_with_role_for_hotel('gop', v_closing.hotel_id)
    UNION
    SELECT user_id, email, 'controladoria'::text FROM public.users_with_role_global('controladoria')
    UNION
    SELECT user_id, email, 'fernando'::text FROM public.users_with_role_global('fernando')
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', role)), '[]'::jsonb)
    INTO v_recipients FROM all_recipients WHERE user_id <> NEW.author_id;

  v_subject := '[' || v_hotel.name || '] Novo comentário ' ||
    CASE WHEN NEW.stage = 'dre' THEN 'na DRE' ELSE 'na Carta' END ||
    ' — ' || v_period;
  v_body := COALESCE(v_author_name, 'Um usuário') || ' deixou um novo comentário ' ||
    CASE WHEN NEW.stage = 'dre' THEN 'na DRE' ELSE 'na Carta ao Investidor' END ||
    ' de **' || v_hotel.name || '** (' || v_period || ').' || E'\n\n' ||
    '> ' || NEW.content || E'\n\n' ||
    'SLA: **' || (CASE WHEN NEW.stage = 'dre' THEN '48 horas' ELSE '24 horas' END) || '** para resposta.' || E'\n\n' ||
    '[Abrir no sistema](' || v_link || ')';

  PERFORM public.enqueue_workflow_notification(v_event, v_closing.id, v_closing.hotel_id, v_recipients, v_subject, v_body, v_link,
    jsonb_build_object('comment_id', NEW.id, 'author_id', NEW.author_id));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_comment ON public.comments;
CREATE TRIGGER trg_notify_on_comment
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_comment();

-- ============================================================================
-- TRIGGER: mudança de status do closing
-- ============================================================================
CREATE OR REPLACE FUNCTION public.notify_on_closing_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

  -- DRE: Controladoria aprovou -> avisa GOP
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

  -- DRE: GOP aprovou -> avisa Fernando
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

  -- DRE: Fernando aprovou
  IF NEW.status_dre = 'aprovado' AND OLD.status_dre IS DISTINCT FROM 'aprovado' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'financeiro')), '[]'::jsonb)
      INTO v_recipients FROM public.users_with_role_global('financeiro');
    v_subject := '[' || v_hotel.name || '] DRE aprovada — distribuição liberada — ' || v_period;
    v_body := 'A DRE de **' || v_hotel.name || '** (' || v_period || ') foi aprovada por Fernando.' || E'\n\n' ||
      'A **distribuição está liberada**. Acesse o módulo Financeiro para registrar a decisão final.' || E'\n\n' ||
      '[Abrir Financeiro](' || v_link_fin || ')';
    PERFORM public.enqueue_workflow_notification('dre_fernando_approved', NEW.id, NEW.hotel_id, v_recipients, v_subject, v_body, v_link_fin,
      jsonb_build_object('audience', 'financeiro'));

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
  END IF;

  -- DRE devolvida
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

  -- CARTA: GG aprovou (no fluxo atual passa direto para aguardando_fernando)
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
  END IF;

  -- CARTA: Fernando aprovou -> RI
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
  END IF;

  -- CARTA devolvida
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

DROP TRIGGER IF EXISTS trg_notify_on_closing_status ON public.closings;
CREATE TRIGGER trg_notify_on_closing_status
  AFTER UPDATE ON public.closings
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_closing_status_change();