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
    SELECT user_id, email, 'gop'::text
      FROM public.users_with_role_for_hotel('gop', v_closing.hotel_id)
      WHERE NOT v_author_is_gop
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