ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS show_in_closing boolean NOT NULL DEFAULT true;