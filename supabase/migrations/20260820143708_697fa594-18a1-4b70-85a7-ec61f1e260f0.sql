-- 1) conc_auto_reconcile: add authorization guard without rewriting body
ALTER FUNCTION public.conc_auto_reconcile(text) RENAME TO conc_auto_reconcile_impl;
REVOKE ALL ON FUNCTION public.conc_auto_reconcile_impl(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conc_auto_reconcile_impl(text) TO service_role;

CREATE OR REPLACE FUNCTION public.conc_auto_reconcile(_hotel_id text DEFAULT NULL::text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access_conciliacao(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT public.conc_auto_reconcile_impl(_hotel_id) INTO v_count;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.conc_auto_reconcile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conc_auto_reconcile(text) TO authenticated, service_role;

-- 2) enqueue_* notification helpers are internal-only (called by SECURITY DEFINER
--    triggers and by edge functions using the service role). Remove direct access.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('enqueue_workflow_notification', 'enqueue_ar_notification')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;