
-- Função que enfileira reforços de SLA de DRE após 48h sem progresso
CREATE OR REPLACE FUNCTION public.enqueue_dre_sla_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    WHERE nq.status = 'sent'
      AND nq.sla_reminder_sent_at IS NULL
      AND nq.dispatched_at IS NOT NULL
      AND nq.dispatched_at < now() - interval '48 hours'
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

    -- Só reforça se o estágio da DRE ainda não avançou (permanece pendente do
    -- destinatário). Se já foi aprovado/devolvido/etc., marca reminder para não
    -- reenviar mais.
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
$$;

REVOKE ALL ON FUNCTION public.enqueue_dre_sla_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_dre_sla_reminders() TO service_role;

-- Agenda a cada 30 minutos (idempotente)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dre-sla-reminders') THEN
    PERFORM cron.unschedule('dre-sla-reminders');
  END IF;
  PERFORM cron.schedule(
    'dre-sla-reminders',
    '*/30 * * * *',
    $cron$ SELECT public.enqueue_dre_sla_reminders(); $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'cron.schedule dre-sla-reminders failed: %', SQLERRM;
END $$;
