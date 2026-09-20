-- 1) Fix: enum notification_status has no 'sent' value; dispatched is the correct one
CREATE OR REPLACE FUNCTION public.enqueue_dre_sla_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_hotel public.hotels%ROWTYPE;
  v_closing public.closings%ROWTYPE;
  v_period text;
  v_link text;
  v_subject text;
  v_body text;
  v_stage_still_pending boolean;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT nq.*
    FROM public.notification_queue nq
    WHERE nq.status = 'dispatched'
      AND nq.sla_reminder_sent_at IS NULL
      AND nq.dispatched_at IS NOT NULL
      AND nq.dispatched_at < now() - interval '48 hours'
      AND nq.dispatched_at > now() - interval '7 days'
      AND nq.event::text IN (
        'dre_first_preview','dre_new_preview',
        'dre_controladoria_approved','dre_gop_approved','dre_returned'
      )
      AND (nq.payload->>'sla_hours') = '48'
      AND nq.closing_id IS NOT NULL
  LOOP
    SELECT * INTO v_closing FROM public.closings WHERE id = r.closing_id;
    IF v_closing.id IS NULL THEN
      UPDATE public.notification_queue SET sla_reminder_sent_at = now() WHERE id = r.id;
      CONTINUE;
    END IF;

    v_stage_still_pending := CASE r.event::text
      WHEN 'dre_first_preview'          THEN v_closing.status_dre IN ('aguardando_comentarios','em_analise')
      WHEN 'dre_new_preview'            THEN v_closing.status_dre IN ('aguardando_comentarios','em_analise')
      WHEN 'dre_controladoria_approved' THEN v_closing.status_dre = 'aguardando_gop'
      WHEN 'dre_gop_approved'           THEN v_closing.status_dre = 'aguardando_fernando'
      WHEN 'dre_returned'               THEN v_closing.status_dre = 'devolvido'
      ELSE false
    END;

    IF NOT v_stage_still_pending THEN
      UPDATE public.notification_queue SET sla_reminder_sent_at = now() WHERE id = r.id;
      CONTINUE;
    END IF;

    SELECT * INTO v_hotel FROM public.hotels WHERE id = r.hotel_id;
    v_period := public.month_pt(v_closing.month) || '/' || v_closing.year;
    v_link := COALESCE(r.link_url, '/fechamento/dre?closing=' || v_closing.id::text);

    v_subject := '[LEMBRETE] ' || COALESCE(v_hotel.name, r.hotel_id) ||
                 ' — SLA de 48h da DRE vencido (' || v_period || ')';
    v_body := 'Este é um **lembrete automático**: já se passaram **48 horas** desde o envio da notificação abaixo, ' ||
              'e a DRE de **' || COALESCE(v_hotel.name, r.hotel_id) || '** (' || v_period || ') ' ||
              'ainda aguarda a sua ação.' || E'\n\n' ||
              '**Aviso original:**' || E'\n> ' || replace(r.subject, E'\n', E'\n> ') || E'\n\n' ||
              'Por favor, acesse o sistema e **comente/aprove/devolva** o quanto antes.' || E'\n\n' ||
              '[Abrir no sistema](' || v_link || ')';

    IF NOT public.is_unsubscribed(r.recipient_user_id, 'dre_sla_reminder'::public.notification_event) THEN
      INSERT INTO public.notification_queue (
        event, closing_id, hotel_id, recipient_user_id, recipient_email,
        recipient_role, subject, body_md, link_url, payload
      ) VALUES (
        'dre_sla_reminder'::public.notification_event,
        r.closing_id, r.hotel_id, r.recipient_user_id, r.recipient_email,
        r.recipient_role, v_subject, v_body, v_link,
        jsonb_build_object('original_notification_id', r.id, 'original_event', r.event::text)
      );
      v_count := v_count + 1;
    END IF;

    UPDATE public.notification_queue SET sla_reminder_sent_at = now() WHERE id = r.id;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enqueue_dre_sla_reminders() FROM anon, public, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_dre_sla_reminders() TO service_role;

-- 2) Evita enxurrada retroativa: notificações antigas (>7 dias) não geram lembrete
UPDATE public.notification_queue
SET sla_reminder_sent_at = now()
WHERE status = 'dispatched'
  AND sla_reminder_sent_at IS NULL
  AND dispatched_at IS NOT NULL
  AND dispatched_at < now() - interval '7 days'
  AND event::text IN (
    'dre_first_preview','dre_new_preview',
    'dre_controladoria_approved','dre_gop_approved','dre_returned'
  )
  AND (payload->>'sla_hours') = '48';

-- 3) Retenção do histórico do cron: mantém 7 dias, limpeza diária
CREATE OR REPLACE FUNCTION public.purge_cron_run_history()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_deleted integer := 0; v_batch integer;
BEGIN
  LOOP
    DELETE FROM cron.job_run_details
    WHERE ctid IN (
      SELECT ctid FROM cron.job_run_details
      WHERE end_time < now() - interval '7 days'
         OR (end_time IS NULL AND start_time < now() - interval '7 days')
      LIMIT 50000
    );
    v_batch := ROW_COUNT_PLACEHOLDER;
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_deleted := v_deleted + v_batch;
    EXIT WHEN v_batch = 0;
  END LOOP;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_cron_run_history() FROM anon, public, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_cron_run_history() TO service_role;

SELECT cron.schedule('purge-cron-run-history', '20 4 * * *', 'SELECT public.purge_cron_run_history();');
