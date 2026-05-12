-- Substitui os 2 índices únicos parciais por um único índice não-parcial,
-- para que ON CONFLICT (entry_key) funcione no upsert do parse-ar-report.
DROP INDEX IF EXISTS public.ar_open_folio_entries_entry_key_uniq;
DROP INDEX IF EXISTS public.ar_open_folio_entries_entry_key_uidx;

-- Limpa duplicatas (se houver) mantendo o registro mais recente por entry_key.
DELETE FROM public.ar_open_folio_entries a
USING public.ar_open_folio_entries b
WHERE a.entry_key IS NOT NULL
  AND a.entry_key = b.entry_key
  AND a.created_at < b.created_at;

CREATE UNIQUE INDEX ar_open_folio_entries_entry_key_key
  ON public.ar_open_folio_entries (entry_key);