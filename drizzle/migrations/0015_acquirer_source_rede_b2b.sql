ALTER TABLE public.conc_acquirer_entries
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'rede';

ALTER TABLE public.conc_acquirer_entries
  DROP CONSTRAINT IF EXISTS conc_acquirer_source_check;

ALTER TABLE public.conc_acquirer_entries
  ADD CONSTRAINT conc_acquirer_source_check CHECK (source IN ('rede','b2b'));