
-- 1) Faturamento: remove notificação hotel → controladoria/patronos.
--    Mantém a rota inversa (controladoria → hotel).
CREATE OR REPLACE FUNCTION public.notify_on_ar_to_invoice_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Ações do hotel (gg/adm/gop) NÃO geram mais notificação para controladoria/patronos/GOP.
  IF v_actor_is_hotel AND NOT v_actor_is_ctrl THEN
    RETURN NEW;
  END IF;

  -- Controladoria/patronos atualizando: notifica o hotel (mantido).
  IF v_actor_is_ctrl THEN
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
$function$;

-- 2) Open Folio: nota do hotel NÃO notifica mais controladoria/patronos.
--    Mantida a função (caso controladoria adicione nota no futuro, fica preparado para não ecoar).
CREATE OR REPLACE FUNCTION public.notify_on_ar_open_folio_note()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Justificativas em Open Folio são registradas pelo hotel.
  -- Por decisão de negócio, controladoria/patronos/GOPs não são mais notificados dessas ações.
  RETURN NEW;
END;
$function$;
