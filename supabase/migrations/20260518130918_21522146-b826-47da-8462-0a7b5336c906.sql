ALTER TABLE public.ap_entries
  ADD COLUMN IF NOT EXISTS grouped_ids uuid[] NULL,
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false;