CREATE OR REPLACE FUNCTION public.notify_on_closing_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- Notifica GOP (para saber)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', user_id, 'email', email, 'role', 'gop'
    )), '[]'::jsonb)
      INTO v_recipients
      FROM public.users_with_role_for_hotel('gop', NEW.hotel_id);
    v_subject := '[' || v_hotel.name || '] DRE aprovada por Fernando — ' || v_period;
    v_body := 'Fernando aprovou a DRE de **' || v_hotel.name || '** (' || v_period || ').' ||
      E'\n\n' || '[Ver DRE](' || v_link_dre || ')';
    PERFORM public.enqueue_workflow_notification(
      'dre_fernando_approved', NEW.id, NEW.hotel_id,
      v_recipients, v_subject, v_body, v_link_dre,
      jsonb_build_object('audience', 'gop'));

    -- Notifica Controladoria (para saber)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', user_id, 'email', email, 'role', 'controladoria'
    )), '[]'::jsonb)
      INTO v_recipients
      FROM public.users_with_role_global('controladoria');
    v_subject := '[' || v_hotel.name || '] DRE aprovada por Fernando — ' || v_period;
    PERFORM public.enqueue_workflow_notification(
      'dre_fernando_approved', NEW.id, NEW.hotel_id,
      v_recipients, v_subject, v_body, v_link_dre,
      jsonb_build_object('audience', 'controladoria'));
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

    -- Notifica RI (para saber)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', user_id, 'email', email, 'role', 'ri'
    )), '[]'::jsonb)
      INTO v_recipients
      FROM public.users_with_role_global('ri');
    v_subject := '[' || v_hotel.name || '] Carta aprovada pelo GG — ' || v_period;
    v_body := 'O GG aprovou a Carta de **' || v_hotel.name ||
      '** (' || v_period || '). Aguardando revisão do GOP e Fernando.' ||
      E'\n\n' || '[Ver Carta](' || v_link_carta || ')';
    PERFORM public.enqueue_workflow_notification(
      'carta_gg_approved', NEW.id, NEW.hotel_id,
      v_recipients, v_subject, v_body, v_link_carta,
      jsonb_build_object('audience', 'ri'));
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

    -- Notifica GOP (para saber)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', user_id, 'email', email, 'role', 'gop'
    )), '[]'::jsonb)
      INTO v_recipients
      FROM public.users_with_role_for_hotel('gop', NEW.hotel_id);
    v_subject := '[' || v_hotel.name || '] Carta aprovada por Fernando — ' || v_period;
    v_body := 'Fernando aprovou a Carta ao Investidor de **' ||
      v_hotel.name || '** (' || v_period || ').' ||
      E'\n\n' || '[Ver Carta](' || v_link_carta || ')';
    PERFORM public.enqueue_workflow_notification(
      'carta_fernando_approved', NEW.id, NEW.hotel_id,
      v_recipients, v_subject, v_body, v_link_carta,
      jsonb_build_object('audience', 'gop'));
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
$function$;