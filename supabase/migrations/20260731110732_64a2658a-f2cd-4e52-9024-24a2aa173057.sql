-- 1. Replay protection store: only a hash of the jti, never the JWT itself.
CREATE TABLE IF NOT EXISTS public.be_eight_jti_replay (
  jti_hash text PRIMARY KEY,
  subject text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.be_eight_jti_replay FROM anon, authenticated;
GRANT ALL ON public.be_eight_jti_replay TO service_role;

ALTER TABLE public.be_eight_jti_replay ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "be_eight_jti_replay_service_role_only" ON public.be_eight_jti_replay;
CREATE POLICY "be_eight_jti_replay_service_role_only"
  ON public.be_eight_jti_replay
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS be_eight_jti_replay_expires_at_idx
  ON public.be_eight_jti_replay (expires_at);

-- 2. Safe cleanup of expired entries (service_role only).
CREATE OR REPLACE FUNCTION public.be_eight_purge_expired_jti()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.be_eight_jti_replay WHERE expires_at < now() - interval '1 minute';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.be_eight_purge_expired_jti() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.be_eight_purge_expired_jti() TO service_role;

-- 3. Dynamic catalog: base tables AND views/matviews of the public schema.
DROP FUNCTION IF EXISTS public.be_eight_list_tables();

CREATE FUNCTION public.be_eight_list_tables()
RETURNS TABLE(table_name text, columns text[], object_kind text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT c.relname::text,
         array_agg(a.attname::text ORDER BY a.attnum),
         CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table'
                        WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view'
                        ELSE 'other' END
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
  GROUP BY c.relname, c.relkind;
$$;

REVOKE ALL ON FUNCTION public.be_eight_list_tables() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.be_eight_list_tables() TO service_role;