CREATE TABLE IF NOT EXISTS public.ap_anticipation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  year int NOT NULL,
  anticipated_amount numeric(14,2) NOT NULL DEFAULT 0,
  anticipation_rate numeric(8,4) NOT NULL DEFAULT 0,
  informed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, month, year)
);

ALTER TABLE public.ap_anticipation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ap_anticipation_financeiro_master_all"
  ON public.ap_anticipation
  FOR ALL
  TO authenticated
  USING (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'financeiro'::app_role))
  WITH CHECK (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'financeiro'::app_role));

CREATE OR REPLACE FUNCTION public.ap_anticipation_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ap_anticipation_updated_at
  BEFORE UPDATE ON public.ap_anticipation
  FOR EACH ROW
  EXECUTE FUNCTION public.ap_anticipation_touch_updated_at();