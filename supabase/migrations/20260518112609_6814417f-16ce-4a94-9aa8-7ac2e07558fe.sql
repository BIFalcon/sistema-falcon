ALTER TABLE public.ar_to_invoice_entries
  ADD COLUMN IF NOT EXISTS paid_date date NULL,
  ADD COLUMN IF NOT EXISTS paid_note text NULL,
  ADD COLUMN IF NOT EXISTS estimated_due_date date NULL;