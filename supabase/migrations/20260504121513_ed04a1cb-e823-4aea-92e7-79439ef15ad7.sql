DO $$ BEGIN
  CREATE TYPE public.ar_gg_status AS ENUM ('pendente', 'faturado', 'nao_faturado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.ar_to_invoice_entries
  ADD COLUMN IF NOT EXISTS gg_status public.ar_gg_status NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS gg_note text,
  ADD COLUMN IF NOT EXISTS gg_confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS gg_confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS ar_ti_gg_status_idx
  ON public.ar_to_invoice_entries(hotel_id, gg_status);

DO $$ BEGIN
  CREATE POLICY "ar_ti_update_gg" ON public.ar_to_invoice_entries
    FOR UPDATE
    TO authenticated
    USING (
      hotel_id IS NOT NULL
      AND public.has_role(auth.uid(), 'gg'::app_role)
      AND public.is_hotel_allowed(auth.uid(), hotel_id)
    )
    WITH CHECK (
      hotel_id IS NOT NULL
      AND public.has_role(auth.uid(), 'gg'::app_role)
      AND public.is_hotel_allowed(auth.uid(), hotel_id)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.ar_ti_enforce_gg_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_gg boolean := public.has_role(auth.uid(), 'gg'::app_role);
  is_manager boolean := public.is_ar_manager(auth.uid());
BEGIN
  IF NEW.gg_status IS DISTINCT FROM OLD.gg_status THEN
    NEW.gg_confirmed_by := auth.uid();
    NEW.gg_confirmed_at := now();
  END IF;

  IF is_gg AND NOT is_manager THEN
    IF NEW.upload_id IS DISTINCT FROM OLD.upload_id
       OR NEW.hotel_id IS DISTINCT FROM OLD.hotel_id
       OR NEW.property_name_raw IS DISTINCT FROM OLD.property_name_raw
       OR NEW.account_number IS DISTINCT FROM OLD.account_number
       OR NEW.account_name IS DISTINCT FROM OLD.account_name
       OR NEW.account_type IS DISTINCT FROM OLD.account_type
       OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
       OR NEW.invoice_status IS DISTINCT FROM OLD.invoice_status
       OR NEW.transaction_date IS DISTINCT FROM OLD.transaction_date
       OR NEW.original_amount IS DISTINCT FROM OLD.original_amount
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.paid IS DISTINCT FROM OLD.paid
       OR NEW.ar_open IS DISTINCT FROM OLD.ar_open
       OR NEW.confirmation_number IS DISTINCT FROM OLD.confirmation_number
       OR NEW.reservation_status IS DISTINCT FROM OLD.reservation_status
       OR NEW.departure_date IS DISTINCT FROM OLD.departure_date
       OR NEW.entry_key IS DISTINCT FROM OLD.entry_key
       OR NEW.raw IS DISTINCT FROM OLD.raw
    THEN
      RAISE EXCEPTION 'GG só pode atualizar status/observação de confirmação';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ar_ti_enforce_gg_update ON public.ar_to_invoice_entries;
CREATE TRIGGER trg_ar_ti_enforce_gg_update
  BEFORE UPDATE ON public.ar_to_invoice_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.ar_ti_enforce_gg_update();