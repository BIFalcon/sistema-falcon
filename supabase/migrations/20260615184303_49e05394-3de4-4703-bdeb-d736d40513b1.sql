
-- 1) Permitir notification_queue.closing_id NULL (eventos de AR não estão atrelados a um fechamento)
ALTER TABLE public.notification_queue DROP CONSTRAINT IF EXISTS notification_queue_closing_id_fkey;
ALTER TABLE public.notification_queue ALTER COLUMN closing_id DROP NOT NULL;
ALTER TABLE public.notification_queue
  ADD CONSTRAINT notification_queue_closing_id_fkey
  FOREIGN KEY (closing_id) REFERENCES public.closings(id) ON DELETE CASCADE;

-- 2) Helper: enfileira notificação para usuários com role específico em um hotel (ou global)
CREATE OR REPLACE FUNCTION public.enqueue_ar_notification(
  _event public.notification_event,
  _hotel_id text,
  _roles_for_hotel public.app_role[],
  _roles_global public.app_role[],
  _subject text,
  _body_md text,
  _link_url text,
  _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  inserted int := 0;
  rrole public.app_role;
BEGIN
  -- Papéis de hotel
  IF _roles_for_hotel IS NOT NULL THEN
    FOREACH rrole IN ARRAY _roles_for_hotel LOOP
      FOR r IN SELECT * FROM public.users_with_role_for_hotel(rrole, _hotel_id) LOOP
        IF r.user_id IS NULL OR r.email IS NULL THEN CONTINUE; END IF;
        IF public.is_unsubscribed(r.user_id, _event) THEN CONTINUE; END IF;
        INSERT INTO public.notification_queue (
          event, closing_id, hotel_id, recipient_user_id, recipient_email,
          recipient_role, subject, body_md, link_url, payload
        ) VALUES (
          _event, NULL, _hotel_id, r.user_id, r.email,
          rrole::text, _subject, _body_md, _link_url, _payload
        );
        inserted := inserted + 1;
      END LOOP;
    END LOOP;
  END IF;

  -- Papéis globais
  IF _roles_global IS NOT NULL THEN
    FOREACH rrole IN ARRAY _roles_global LOOP
      FOR r IN SELECT * FROM public.users_with_role_global(rrole) LOOP
        IF r.user_id IS NULL OR r.email IS NULL THEN CONTINUE; END IF;
        IF public.is_unsubscribed(r.user_id, _event) THEN CONTINUE; END IF;
        INSERT INTO public.notification_queue (
          event, closing_id, hotel_id, recipient_user_id, recipient_email,
          recipient_role, subject, body_md, link_url, payload
        ) VALUES (
          _event, NULL, _hotel_id, r.user_id, r.email,
          rrole::text, _subject, _body_md, _link_url, _payload
        );
        inserted := inserted + 1;
      END LOOP;
    END LOOP;
  END IF;

  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_ar_notification(public.notification_event, text, public.app_role[], public.app_role[], text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_ar_notification(public.notification_event, text, public.app_role[], public.app_role[], text, text, text, jsonb) TO service_role;

-- 3) Trigger: ar_to_invoice_entries - mudanças de status / pagamento / inadimplencia / documentos
CREATE OR REPLACE FUNCTION public.notify_on_ar_to_invoice_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hotel public.hotels%ROWTYPE;
  v_actor_is_hotel boolean;
  v_actor_is_ctrl boolean;
  v_actor_name text;
  v_changed boolean := false;
  v_summary text := '';
  v_subject text;
  v_body text;
  v_link text;
  v_who text;
BEGIN
  IF NEW.hotel_id IS NULL THEN RETURN NEW; END IF;

  -- Detecta o que mudou (apenas campos de negócio relevantes)
  IF NEW.gg_status IS DISTINCT FROM OLD.gg_status THEN
    v_changed := true;
    v_summary := v_summary || E'\n- Status: ' || COALESCE(OLD.gg_status::text,'—') || ' → ' || COALESCE(NEW.gg_status::text,'—');
  END IF;
  IF NEW.is_paid IS DISTINCT FROM OLD.is_paid THEN
    v_changed := true;
    v_summary := v_summary || E'\n- Marcado como pago: ' || COALESCE(NEW.is_paid::text,'false');
  END IF;
  IF NEW.is_defaulting IS DISTINCT FROM OLD.is_defaulting THEN
    v_changed := true;
    v_summary := v_summary || E'\n- Marcado como inadimplente: ' || COALESCE(NEW.is_defaulting::text,'false');
  END IF;
  IF NEW.billed_at IS DISTINCT FROM OLD.billed_at AND NEW.billed_at IS NOT NULL THEN
    v_changed := true;
    v_summary := v_summary || E'\n- Faturado em: ' || to_char(NEW.billed_at,'DD/MM/YYYY');
  END IF;
  IF NEW.is_not_billable IS DISTINCT FROM OLD.is_not_billable THEN
    v_changed := true;
    v_summary := v_summary || E'\n- Marcado como não faturável: ' || COALESCE(NEW.is_not_billable::text,'false');
  END IF;
  IF NEW.documents_problem_note IS DISTINCT FROM OLD.documents_problem_note AND NEW.documents_problem_note IS NOT NULL THEN
    v_changed := true;
    v_summary := v_summary || E'\n- Problema com documentos registrado';
  END IF;
  IF (NEW.invoice_file_1 IS DISTINCT FROM OLD.invoice_file_1 AND NEW.invoice_file_1 IS NOT NULL)
     OR (NEW.invoice_file_2 IS DISTINCT FROM OLD.invoice_file_2 AND NEW.invoice_file_2 IS NOT NULL) THEN
    v_changed := true;
    v_summary := v_summary || E'\n- Documento(s) anexado(s)';
  END IF;

  IF NOT v_changed THEN RETURN NEW; END IF;

  SELECT * INTO v_hotel FROM public.hotels WHERE id = NEW.hotel_id;
  SELECT COALESCE(display_name, email) INTO v_actor_name FROM public.profiles WHERE user_id = v_uid;

  v_actor_is_hotel := v_uid IS NOT NULL AND (
    public.has_role(v_uid,'gg'::public.app_role)
    OR public.has_role(v_uid,'adm'::public.app_role)
    OR public.has_role(v_uid,'gop'::public.app_role)
  );
  v_actor_is_ctrl := v_uid IS NOT NULL AND (
    public.is_master(v_uid)
    OR public.has_role(v_uid,'controladoria'::public.app_role)
    OR public.has_role(v_uid,'patronos'::public.app_role)
  );

  v_link := '/financeiro/contas-receber?hotel=' || NEW.hotel_id || '&tab=faturamento';
  v_who := COALESCE(v_actor_name, 'um usuário');

  IF v_actor_is_hotel AND NOT v_actor_is_ctrl THEN
    v_subject := '[' || COALESCE(v_hotel.name, NEW.hotel_id) || '] Atualização em Faturamento';
    v_body := v_who || ' (hotel) atualizou um registro de **Faturamento** em **' || COALESCE(v_hotel.name, NEW.hotel_id) || '**.' ||
      E'\n\n**Cliente:** ' || COALESCE(NEW.account_name, NEW.property_name_raw, '—') ||
      CASE WHEN NEW.invoice_number IS NOT NULL THEN E'\n**Nota:** ' || NEW.invoice_number ELSE '' END ||
      CASE WHEN NEW.amount IS NOT NULL THEN E'\n**Valor:** R$ ' || to_char(NEW.amount,'FM999G999G990D00') ELSE '' END ||
      E'\n\n**Alterações:**' || v_summary ||
      E'\n\n[Abrir Faturamento](' || v_link || ')';
    PERFORM public.enqueue_ar_notification(
      'ar_hotel_action_to_controladoria'::public.notification_event,
      NEW.hotel_id,
      NULL::public.app_role[],
      ARRAY['controladoria','patronos']::public.app_role[],
      v_subject, v_body, v_link,
      jsonb_build_object('entry_id', NEW.id, 'actor_user_id', v_uid)
    );
  ELSIF v_actor_is_ctrl THEN
    v_subject := '[' || COALESCE(v_hotel.name, NEW.hotel_id) || '] Atualização da Controladoria em Faturamento';
    v_body := v_who || ' (controladoria) atualizou um registro de **Faturamento** em **' || COALESCE(v_hotel.name, NEW.hotel_id) || '**.' ||
      E'\n\n**Cliente:** ' || COALESCE(NEW.account_name, NEW.property_name_raw, '—') ||
      CASE WHEN NEW.invoice_number IS NOT NULL THEN E'\n**Nota:** ' || NEW.invoice_number ELSE '' END ||
      CASE WHEN NEW.amount IS NOT NULL THEN E'\n**Valor:** R$ ' || to_char(NEW.amount,'FM999G999G990D00') ELSE '' END ||
      E'\n\n**Alterações:**' || v_summary ||
      E'\n\n[Abrir Faturamento](' || v_link || ')';
    PERFORM public.enqueue_ar_notification(
      'ar_controladoria_action_to_hotel'::public.notification_event,
      NEW.hotel_id,
      ARRAY['gg','adm','gop']::public.app_role[],
      NULL::public.app_role[],
      v_subject, v_body, v_link,
      jsonb_build_object('entry_id', NEW.id, 'actor_user_id', v_uid)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_ar_to_invoice_change ON public.ar_to_invoice_entries;
CREATE TRIGGER trg_notify_on_ar_to_invoice_change
  AFTER UPDATE ON public.ar_to_invoice_entries
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_ar_to_invoice_change();

-- 4) Trigger: ar_open_folio_notes - hotel registra justificativa → notifica controladoria
CREATE OR REPLACE FUNCTION public.notify_on_ar_open_folio_note()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hotel public.hotels%ROWTYPE;
  v_actor_name text;
  v_subject text;
  v_body text;
  v_link text;
  v_who text;
  v_folio public.ar_open_folio_entries%ROWTYPE;
BEGIN
  IF NEW.hotel_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_hotel FROM public.hotels WHERE id = NEW.hotel_id;
  SELECT COALESCE(display_name, email) INTO v_actor_name FROM public.profiles WHERE user_id = COALESCE(NEW.author_id, v_uid);
  SELECT * INTO v_folio FROM public.ar_open_folio_entries
    WHERE hotel_id = NEW.hotel_id AND confirmation_number = NEW.confirmation_number
    ORDER BY created_at DESC LIMIT 1;

  v_link := '/financeiro/contas-receber?hotel=' || NEW.hotel_id || '&tab=open-folio';
  v_who := COALESCE(v_actor_name, 'um usuário do hotel');
  v_subject := '[' || COALESCE(v_hotel.name, NEW.hotel_id) || '] Nova justificativa em Open Folio';
  v_body := v_who || ' registrou uma justificativa em **Open Folio** de **' || COALESCE(v_hotel.name, NEW.hotel_id) || '**.' ||
    E'\n\n**Confirmação:** ' || NEW.confirmation_number ||
    CASE WHEN v_folio.first_name IS NOT NULL OR v_folio.last_name IS NOT NULL
         THEN E'\n**Hóspede:** ' || COALESCE(v_folio.first_name,'') || ' ' || COALESCE(v_folio.last_name,'') ELSE '' END ||
    CASE WHEN v_folio.balance IS NOT NULL
         THEN E'\n**Saldo:** R$ ' || to_char(v_folio.balance,'FM999G999G990D00') ELSE '' END ||
    CASE WHEN NEW.expected_payment_date IS NOT NULL
         THEN E'\n**Data prevista de faturamento:** ' || to_char(NEW.expected_payment_date,'DD/MM/YYYY') ELSE '' END ||
    E'\n\n> ' || NEW.note ||
    E'\n\n[Abrir Open Folio](' || v_link || ')';

  PERFORM public.enqueue_ar_notification(
    'ar_hotel_action_to_controladoria'::public.notification_event,
    NEW.hotel_id,
    NULL::public.app_role[],
    ARRAY['controladoria','patronos']::public.app_role[],
    v_subject, v_body, v_link,
    jsonb_build_object('note_id', NEW.id, 'confirmation_number', NEW.confirmation_number, 'actor_user_id', COALESCE(NEW.author_id, v_uid))
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_ar_open_folio_note ON public.ar_open_folio_notes;
CREATE TRIGGER trg_notify_on_ar_open_folio_note
  AFTER INSERT ON public.ar_open_folio_notes
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_ar_open_folio_note();

-- 5) Trigger: ar_uploads - controladoria publica novo relatório → notifica hotéis afetados
CREATE OR REPLACE FUNCTION public.notify_on_ar_upload_processed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hotel_row record;
  v_hotel_name text;
  v_event public.notification_event;
  v_subject text;
  v_body text;
  v_link text;
  v_kind_label text;
BEGIN
  IF NEW.parsed_rows_count IS NULL OR NEW.parsed_rows_count <= 0 THEN RETURN NEW; END IF;
  -- só dispara quando deixa de ser nulo/zero (no insert ou primeiro update após parse)
  IF TG_OP = 'UPDATE'
     AND OLD.parsed_rows_count IS NOT NULL AND OLD.parsed_rows_count > 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.kind = 'open_folio' THEN
    v_kind_label := 'Open Folio';
    v_event := 'ar_open_folio_upload_to_hotel'::public.notification_event;
    FOR v_hotel_row IN
      SELECT hotel_id, COUNT(*) AS qty, COALESCE(SUM(balance),0)::numeric AS total
      FROM public.ar_open_folio_entries
      WHERE upload_id = NEW.id AND hotel_id IS NOT NULL
      GROUP BY hotel_id
    LOOP
      SELECT name INTO v_hotel_name FROM public.hotels WHERE id = v_hotel_row.hotel_id;
      v_link := '/financeiro/contas-receber?hotel=' || v_hotel_row.hotel_id || '&tab=open-folio';
      v_subject := '[' || COALESCE(v_hotel_name, v_hotel_row.hotel_id) || '] Novo relatório de Open Folio publicado';
      v_body := 'A controladoria publicou um novo relatório de **Open Folio**.' ||
        E'\n\n**Folios em aberto:** ' || v_hotel_row.qty ||
        E'\n**Saldo total:** R$ ' || to_char(v_hotel_row.total,'FM999G999G990D00') ||
        E'\n\nAcesse o sistema para justificar cada folio.' ||
        E'\n\n[Abrir Open Folio](' || v_link || ')';
      PERFORM public.enqueue_ar_notification(
        v_event,
        v_hotel_row.hotel_id,
        ARRAY['gg','adm','gop']::public.app_role[],
        NULL::public.app_role[],
        v_subject, v_body, v_link,
        jsonb_build_object('upload_id', NEW.id, 'count', v_hotel_row.qty, 'total', v_hotel_row.total)
      );
    END LOOP;
  ELSIF NEW.kind = 'to_invoice' THEN
    v_kind_label := 'Faturamento';
    v_event := 'ar_to_invoice_upload_to_hotel'::public.notification_event;
    FOR v_hotel_row IN
      SELECT hotel_id, COUNT(*) AS qty, COALESCE(SUM(amount),0)::numeric AS total
      FROM public.ar_to_invoice_entries
      WHERE upload_id = NEW.id AND hotel_id IS NOT NULL
      GROUP BY hotel_id
    LOOP
      SELECT name INTO v_hotel_name FROM public.hotels WHERE id = v_hotel_row.hotel_id;
      v_link := '/financeiro/contas-receber?hotel=' || v_hotel_row.hotel_id || '&tab=faturamento';
      v_subject := '[' || COALESCE(v_hotel_name, v_hotel_row.hotel_id) || '] Novo relatório de Faturamento publicado';
      v_body := 'A controladoria publicou um novo relatório de **Faturamento**.' ||
        E'\n\n**Registros:** ' || v_hotel_row.qty ||
        E'\n**Valor total:** R$ ' || to_char(v_hotel_row.total,'FM999G999G990D00') ||
        E'\n\nAcesse o sistema para acompanhar e marcar como faturado/pago/inadimplente.' ||
        E'\n\n[Abrir Faturamento](' || v_link || ')';
      PERFORM public.enqueue_ar_notification(
        v_event,
        v_hotel_row.hotel_id,
        ARRAY['gg','adm','gop']::public.app_role[],
        NULL::public.app_role[],
        v_subject, v_body, v_link,
        jsonb_build_object('upload_id', NEW.id, 'count', v_hotel_row.qty, 'total', v_hotel_row.total)
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_ar_upload_processed ON public.ar_uploads;
CREATE TRIGGER trg_notify_on_ar_upload_processed
  AFTER INSERT OR UPDATE OF parsed_rows_count ON public.ar_uploads
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_ar_upload_processed();
