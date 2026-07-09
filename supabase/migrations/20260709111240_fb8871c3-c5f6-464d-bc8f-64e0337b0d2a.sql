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

  IF NOT v_is_manager AND _hotel_id IS NOT NULL THEN
    IF NOT public.is_hotel_allowed(v_uid, _hotel_id) THEN
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
  WHERE
    (
      v_is_manager
      OR (_hotel_id IS NOT NULL AND public.is_hotel_allowed(v_uid, e.hotel_id))
      OR (
        _hotel_id IS NULL
        AND EXISTS (
          SELECT 1 FROM public.user_hotels uh
          WHERE uh.user_id = v_uid AND uh.hotel_id = e.hotel_id
        )
      )
    )
    AND (_hotel_id IS NULL OR e.hotel_id = _hotel_id)
    AND (_reference_month IS NULL OR e.reference_month = _reference_month)
    AND (_reference_year IS NULL OR e.reference_year = _reference_year)
  ORDER BY e.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_rh_employees_for_user(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rh_employees_for_user(text, int, int) TO authenticated;