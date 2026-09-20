CREATE OR REPLACE FUNCTION public.purge_cron_run_history()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_deleted integer := 0; v_batch integer := 0;
BEGIN
  LOOP
    DELETE FROM cron.job_run_details
    WHERE ctid IN (
      SELECT ctid FROM cron.job_run_details
      WHERE end_time < now() - interval '7 days'
         OR (end_time IS NULL AND start_time < now() - interval '7 days')
      LIMIT 50000
    );
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_deleted := v_deleted + v_batch;
    EXIT WHEN v_batch = 0;
  END LOOP;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_cron_run_history() FROM anon, public, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_cron_run_history() TO service_role;
