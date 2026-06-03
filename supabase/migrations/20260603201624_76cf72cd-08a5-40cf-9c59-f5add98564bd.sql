
-- Resend all messages previously skipped because domain wasn't configured.
UPDATE public.notification_queue
SET status = 'pending', dispatched_at = NULL, error_message = NULL
WHERE status = 'skipped';

-- Also retry messages that failed in the old flow.
UPDATE public.notification_queue
SET status = 'pending', error_message = NULL
WHERE status = 'failed';

-- Cron: drena notification_queue para a fila transactional_emails a cada minuto.
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'process-notifications';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'process-notifications',
  '* * * * *',
  $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.notification_queue
      WHERE status = 'pending' AND scheduled_at <= now()
    )
    THEN net.http_post(
      url := 'https://hwwwjfzmpgerrkigpgab.supabase.co/functions/v1/process-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'email_queue_service_role_key'
        )
      ),
      body := '{}'::jsonb
    )
    ELSE NULL
  END;
  $$
);
