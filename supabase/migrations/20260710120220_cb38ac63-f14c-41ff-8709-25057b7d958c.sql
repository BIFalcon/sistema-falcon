ALTER TABLE public.ap_anticipation
  ADD COLUMN IF NOT EXISTS valor_liquido numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_descontado numeric(14,2),
  ADD COLUMN IF NOT EXISTS data_antecipacao date,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date;

ALTER TABLE public.ap_anticipation
  DROP CONSTRAINT IF EXISTS ap_anticipation_hotel_id_month_year_key;

CREATE INDEX IF NOT EXISTS idx_ap_anticipation_hotel
  ON public.ap_anticipation(hotel_id, data_antecipacao);