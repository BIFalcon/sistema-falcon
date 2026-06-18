ALTER TABLE public.ar_to_invoice_entries
  ADD COLUMN IF NOT EXISTS nota_number text,
  ADD COLUMN IF NOT EXISTS boleto_number text,
  ADD COLUMN IF NOT EXISTS boleto_due_date date,
  ADD COLUMN IF NOT EXISTS doc_extraction_status text,
  ADD COLUMN IF NOT EXISTS doc_extraction_details jsonb;