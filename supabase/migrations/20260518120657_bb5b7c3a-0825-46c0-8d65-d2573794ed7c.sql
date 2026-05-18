ALTER TABLE public.ap_entries
  ADD COLUMN IF NOT EXISTS original_amount numeric(14,2) NULL;

UPDATE public.ap_entries
SET original_amount = amount
WHERE original_amount IS NULL;