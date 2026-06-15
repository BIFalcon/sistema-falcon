ALTER TABLE public.ap_entries ADD COLUMN IF NOT EXISTS archived_upload_id uuid REFERENCES public.ap_uploads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ap_entries_archived_reason_idx ON public.ap_entries (hotel_id, archived_reason) WHERE archived_at IS NOT NULL;

-- Backfill: lançamentos arquivados sem motivo e que não foram pagos = removidos do OMIE
UPDATE public.ap_entries
SET archived_reason = 'omie_removed'
WHERE archived_at IS NOT NULL
  AND archived_reason IS NULL
  AND payment_status <> 'pago';