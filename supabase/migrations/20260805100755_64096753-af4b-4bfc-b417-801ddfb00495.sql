-- Be Eight export catalog: provable pagination key discovery from pg_catalog.
-- No manual per-table allowlist; new business tables/columns keep flowing in.
DROP FUNCTION IF EXISTS public.be_eight_list_tables();

CREATE OR REPLACE FUNCTION public.be_eight_list_tables()
RETURNS TABLE(
  table_name text,
  columns text[],
  object_kind text,
  pagination_columns text[],
  pagination_kind text,
  pagination_verified boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH objs AS (
    SELECT c.oid,
           c.relname::text AS relname,
           c.relkind,
           CASE c.relkind
             WHEN 'r' THEN 'table'
             WHEN 'p' THEN 'table'
             WHEN 'v' THEN 'view'
             WHEN 'm' THEN 'materialized_view'
             ELSE 'other'
           END AS object_kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p','v','m')
  ),
  cols AS (
    SELECT o.oid,
           array_agg(a.attname::text ORDER BY a.attnum) AS columns
    FROM objs o
    JOIN pg_attribute a ON a.attrelid = o.oid AND a.attnum > 0 AND NOT a.attisdropped
    GROUP BY o.oid
  ),
  -- Candidate keys: only PRIMARY KEY or UNIQUE indexes that are valid, ready,
  -- non-partial, expression-free. Only the leading key columns count (INCLUDE
  -- columns are ignored). Every key column must be NOT NULL.
  cand AS (
    SELECT o.oid,
           i.indexrelid,
           ic.relname::text AS index_name,
           i.indisprimary,
           i.indnkeyatts,
           (
             SELECT array_agg(att.attname::text ORDER BY k.ord)
             FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
             JOIN pg_attribute att
               ON att.attrelid = o.oid AND att.attnum = k.attnum
             WHERE k.ord <= i.indnkeyatts
           ) AS key_cols,
           (
             SELECT bool_and(att.attnotnull)
             FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
             JOIN pg_attribute att
               ON att.attrelid = o.oid AND att.attnum = k.attnum
             WHERE k.ord <= i.indnkeyatts
           ) AS all_not_null,
           (
             SELECT count(*)
             FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
             WHERE k.ord <= i.indnkeyatts AND k.attnum = 0
           ) AS expr_cols
    FROM objs o
    JOIN pg_index i ON i.indrelid = o.oid
    JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE o.relkind IN ('r','p','m')
      AND (i.indisprimary OR i.indisunique)
      AND i.indisvalid
      AND i.indisready
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
  ),
  best AS (
    SELECT DISTINCT ON (oid)
           oid,
           key_cols,
           CASE WHEN indisprimary THEN 'primary_key' ELSE 'unique_not_null' END AS pagination_kind
    FROM cand
    WHERE expr_cols = 0
      AND all_not_null IS TRUE
      AND key_cols IS NOT NULL
      AND array_length(key_cols, 1) >= 1
    ORDER BY oid, indisprimary DESC, array_length(key_cols, 1) ASC, index_name ASC
  )
  SELECT o.relname,
         COALESCE(cl.columns, ARRAY[]::text[]),
         o.object_kind,
         b.key_cols,
         b.pagination_kind,
         (b.key_cols IS NOT NULL)
  FROM objs o
  LEFT JOIN cols cl ON cl.oid = o.oid
  LEFT JOIN best b ON b.oid = o.oid;
$function$;

REVOKE ALL ON FUNCTION public.be_eight_list_tables() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.be_eight_list_tables() FROM anon;
REVOKE ALL ON FUNCTION public.be_eight_list_tables() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.be_eight_list_tables() TO service_role;