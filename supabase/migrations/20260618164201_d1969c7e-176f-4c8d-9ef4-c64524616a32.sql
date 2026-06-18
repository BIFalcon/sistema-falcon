
ALTER TABLE public.ap_entries
  ALTER COLUMN upload_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_transfer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transfer_from_bank text,
  ADD COLUMN IF NOT EXISTS transfer_to_bank text;

CREATE INDEX IF NOT EXISTS ap_entries_is_manual_idx ON public.ap_entries(hotel_id, is_manual) WHERE is_manual = true;
