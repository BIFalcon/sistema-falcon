-- Add created_at to conciliation lines (append-only) so they have an incremental column
ALTER TABLE public.conciliation_journal_lines
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.conciliation_razao_lines
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- RPC that lists all public-schema base tables and their columns, used by the
-- be-eight-export edge function for dynamic table discovery. Restricted to
-- service_role (only the edge function uses it).
CREATE OR REPLACE FUNCTION public.be_eight_list_tables()
RETURNS TABLE(table_name text, columns text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT c.relname::text,
         array_agg(a.attname::text ORDER BY a.attnum)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  GROUP BY c.relname;
$$;

REVOKE ALL ON FUNCTION public.be_eight_list_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.be_eight_list_tables() TO service_role;