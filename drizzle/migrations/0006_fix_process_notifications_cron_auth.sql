-- lovable-cron-fallback-reviewed: 1440 runs/day; pre-existing per-minute queue drain kept as-is — only its authentication is being repaired so pending workflow emails go out within a minute.
CREATE TABLE IF NOT EXISTS public.cron_auth (
  name text PRIMARY KEY,
  value text NOT NULL
);

REVOKE ALL ON public.cron_auth FROM anon, authenticated;
ALTER TABLE public.cron_auth ENABLE ROW LEVEL SECURITY;

INSERT INTO public.cron_auth (name, value)
VALUES ('notifications_cron_secret', '2c2f844e3c6a389268efdf63815a72ef880b3132a498857da655c67785dbaf39')
ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;

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
        'x-cron-secret', (SELECT value FROM public.cron_auth WHERE name = 'notifications_cron_secret')
      ),
      body := '{}'::jsonb
    )
    ELSE NULL
  END;
  $$
);