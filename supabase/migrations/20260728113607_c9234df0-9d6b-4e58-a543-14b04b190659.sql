CREATE OR REPLACE FUNCTION public.notify_on_ar_upload_processed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hotel_row record;
  v_hotel_name text;
  v_event public.notification_event;
  v_subject text;
  v_body text;
  v_link text;
BEGIN
  IF NEW.parsed_rows_count IS NULL OR NEW.parsed_rows_count <= 0 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.parsed_rows_count IS NOT NULL AND OLD.parsed_rows_count > 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.kind = 'open_folio' THEN
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
        ARRAY['gg','adm']::public.app_role[],
        NULL::public.app_role[],
        v_subject, v_body, v_link,
        jsonb_build_object('upload_id', NEW.id, 'count', v_hotel_row.qty, 'total', v_hotel_row.total)
      );
    END LOOP;
  ELSIF NEW.kind = 'to_invoice' THEN
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
        ARRAY['gg','adm']::public.app_role[],
        NULL::public.app_role[],
        v_subject, v_body, v_link,
        jsonb_build_object('upload_id', NEW.id, 'count', v_hotel_row.qty, 'total', v_hotel_row.total)
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_author_is_gg boolean;
  v_author_is_gop boolean;
  v_author_is_controladoria boolean;
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

  v_author_is_gg := public.has_role(NEW.author_id, 'gg'::public.app_role);
  v_author_is_gop := public.has_role(NEW.author_id, 'gop'::public.app_role);
  v_author_is_controladoria := public.has_role(NEW.author_id, 'controladoria'::public.app_role);

  WITH all_recipients AS (
    SELECT user_id, email, 'gg'::text AS role
      FROM public.users_with_role_for_hotel('gg', v_closing.hotel_id)
      WHERE NOT v_author_is_gg
    UNION
    -- GOP só é notificado de comentários feitos pela Controladoria.
    SELECT user_id, email, 'gop'::text
      FROM public.users_with_role_for_hotel('gop', v_closing.hotel_id)
      WHERE v_author_is_controladoria AND NOT v_author_is_gop
    UNION
    SELECT user_id, email, 'controladoria'::text
      FROM public.users_with_role_global('controladoria')
      WHERE NOT v_author_is_controladoria
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', role)), '[]'::jsonb)
    INTO v_recipients
    FROM all_recipients
    WHERE user_id <> NEW.author_id;

  IF jsonb_array_length(v_recipients) = 0 THEN
    RETURN NEW;
  END IF;

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
$function$;