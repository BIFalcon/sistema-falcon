ALTER TABLE public.ar_open_folio_entries
  ADD COLUMN IF NOT EXISTS expected_payment_date date,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS entry_key text;

UPDATE public.ar_open_folio_entries
SET entry_key = COALESCE(confirmation_number,'') || '|' ||
                COALESCE(property_name_raw,'') || '|' ||
                COALESCE(arrival_date::text,'') || '|' ||
                COALESCE(departure_date::text,'')
WHERE entry_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ar_open_folio_entries_entry_key_uniq
  ON public.ar_open_folio_entries(entry_key)
  WHERE entry_key IS NOT NULL AND confirmation_number IS NOT NULL;

DROP POLICY IF EXISTS ar_of_update_managers ON public.ar_open_folio_entries;
CREATE POLICY ar_of_update_managers ON public.ar_open_folio_entries
  FOR UPDATE TO authenticated
  USING (public.is_ar_manager(auth.uid()))
  WITH CHECK (public.is_ar_manager(auth.uid()));

ALTER TABLE public.ar_open_folio_notes
  ADD COLUMN IF NOT EXISTS expected_payment_date date;

ALTER TABLE public.ap_entries
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_distribution boolean NOT NULL DEFAULT false;

-- Normaliza acentos com translate (sem extensão unaccent)
UPDATE public.ap_entries
SET is_distribution = true
WHERE is_distribution = false
  AND (
    lower(translate(coalesce(category,''),    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) LIKE '%distribuicao de lucros%'
    OR lower(translate(coalesce(description,''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) LIKE '%distribuicao de lucros%'
  );
