ALTER TABLE public.rh_uploads
  ADD COLUMN IF NOT EXISTS reference_month integer,
  ADD COLUMN IF NOT EXISTS reference_year integer;

ALTER TABLE public.rh_employees
  ADD COLUMN IF NOT EXISTS reference_month integer,
  ADD COLUMN IF NOT EXISTS reference_year integer;

UPDATE public.rh_uploads
SET
  reference_month = COALESCE(reference_month, NULLIF((metadata->>'reference_month')::integer, 0), EXTRACT(MONTH FROM uploaded_at)::integer),
  reference_year = COALESCE(reference_year, NULLIF((metadata->>'reference_year')::integer, 0), EXTRACT(YEAR FROM uploaded_at)::integer)
WHERE reference_month IS NULL OR reference_year IS NULL;

UPDATE public.rh_employees e
SET
  reference_month = COALESCE(e.reference_month, u.reference_month, EXTRACT(MONTH FROM e.created_at)::integer),
  reference_year = COALESCE(e.reference_year, u.reference_year, EXTRACT(YEAR FROM e.created_at)::integer)
FROM public.rh_uploads u
WHERE e.upload_id = u.id
  AND (e.reference_month IS NULL OR e.reference_year IS NULL);

UPDATE public.rh_employees
SET
  reference_month = COALESCE(reference_month, EXTRACT(MONTH FROM created_at)::integer),
  reference_year = COALESCE(reference_year, EXTRACT(YEAR FROM created_at)::integer)
WHERE reference_month IS NULL OR reference_year IS NULL;

ALTER TABLE public.rh_uploads
  ADD CONSTRAINT rh_uploads_reference_month_check CHECK (reference_month IS NULL OR reference_month BETWEEN 1 AND 12),
  ADD CONSTRAINT rh_uploads_reference_year_check CHECK (reference_year IS NULL OR reference_year BETWEEN 2000 AND 2100);

ALTER TABLE public.rh_employees
  ADD CONSTRAINT rh_employees_reference_month_check CHECK (reference_month IS NULL OR reference_month BETWEEN 1 AND 12),
  ADD CONSTRAINT rh_employees_reference_year_check CHECK (reference_year IS NULL OR reference_year BETWEEN 2000 AND 2100);

DROP INDEX IF EXISTS public.rh_employees_key_idx;
CREATE UNIQUE INDEX IF NOT EXISTS rh_employees_period_key_idx
  ON public.rh_employees(hotel_id, employee_key, reference_year, reference_month);

CREATE INDEX IF NOT EXISTS rh_employees_period_idx
  ON public.rh_employees(reference_year, reference_month);

CREATE INDEX IF NOT EXISTS rh_uploads_period_idx
  ON public.rh_uploads(reference_year, reference_month);