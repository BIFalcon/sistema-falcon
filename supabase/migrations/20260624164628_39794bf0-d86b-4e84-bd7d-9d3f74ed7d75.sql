
DROP POLICY IF EXISTS rh_employees_select ON public.rh_employees;
CREATE POLICY rh_employees_select_managers ON public.rh_employees
  FOR SELECT
  USING (public.is_rh_manager(auth.uid()));

CREATE OR REPLACE FUNCTION public.get_rh_employees_for_user(
  _hotel_id text DEFAULT NULL,
  _reference_month int DEFAULT NULL,
  _reference_year int DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  hotel_id text,
  upload_id uuid,
  employee_key text,
  name text,
  cpf text,
  "position" text,
  department text,
  gender text,
  birth_date date,
  admission_date date,
  termination_date date,
  termination_reason text,
  salary numeric,
  status text,
  source_format text,
  raw jsonb,
  reference_month int,
  reference_year int,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_manager boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_is_manager := public.is_rh_manager(v_uid);

  IF NOT v_is_manager THEN
    IF _hotel_id IS NULL THEN
      RAISE EXCEPTION 'hotel_id obrigatório';
    END IF;
    IF NOT (
      public.has_role(v_uid, 'gg'::public.app_role)
      AND public.is_hotel_allowed(v_uid, _hotel_id)
    ) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.hotel_id,
    e.upload_id,
    e.employee_key,
    e.name,
    CASE WHEN v_is_manager THEN e.cpf ELSE NULL END,
    e."position",
    e.department,
    e.gender,
    CASE WHEN v_is_manager THEN e.birth_date ELSE NULL END,
    e.admission_date,
    CASE WHEN v_is_manager THEN e.termination_date ELSE NULL END,
    CASE WHEN v_is_manager THEN e.termination_reason ELSE NULL END,
    CASE WHEN v_is_manager THEN e.salary ELSE NULL END,
    e.status,
    e.source_format,
    CASE WHEN v_is_manager THEN e.raw ELSE '{}'::jsonb END,
    e.reference_month,
    e.reference_year,
    e.created_at,
    e.updated_at
  FROM public.rh_employees e
  WHERE (_hotel_id IS NULL OR e.hotel_id = _hotel_id)
    AND (_reference_month IS NULL OR e.reference_month = _reference_month)
    AND (_reference_year IS NULL OR e.reference_year = _reference_year)
  ORDER BY e.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_rh_employees_for_user(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rh_employees_for_user(text, int, int) TO authenticated;

DROP POLICY IF EXISTS hotel_assets_public_read ON storage.objects;
CREATE POLICY hotel_assets_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'hotel-assets');
