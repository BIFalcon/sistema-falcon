
-- ============================================================
-- #1: RH - permitir operacoes/viewer/fernando/ri ver dashboard
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_view_rh_directory(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_master(_user_id)
      OR public.has_role(_user_id, 'rh'::app_role)
      OR public.has_role(_user_id, 'gg'::app_role)
      OR public.has_role(_user_id, 'adm'::app_role)
      OR public.has_role(_user_id, 'gop'::app_role)
      OR public.has_role(_user_id, 'controladoria'::app_role)
      OR public.has_role(_user_id, 'patronos'::app_role)
      OR public.has_role(_user_id, 'ri'::app_role)
      OR public.has_role(_user_id, 'fernando'::app_role)
      OR public.has_role(_user_id, 'operacoes'::app_role)
      OR public.has_role(_user_id, 'viewer'::app_role);
$$;

CREATE OR REPLACE FUNCTION public.get_rh_employees_for_user(_hotel_id text DEFAULT NULL::text, _reference_month integer DEFAULT NULL::integer, _reference_year integer DEFAULT NULL::integer)
RETURNS TABLE(id uuid, hotel_id text, upload_id uuid, employee_key text, name text, cpf text, "position" text, department text, gender text, birth_date date, admission_date date, termination_date date, termination_reason text, salary numeric, status text, source_format text, raw jsonb, reference_month integer, reference_year integer, created_at timestamp with time zone, updated_at timestamp with time zone)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_manager boolean;
  v_has_broad_view boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_is_manager := public.is_rh_manager(v_uid);

  v_has_broad_view :=
        v_is_manager
     OR public.has_role(v_uid, 'controladoria'::app_role)
     OR public.has_role(v_uid, 'patronos'::app_role)
     OR public.has_role(v_uid, 'ri'::app_role)
     OR public.has_role(v_uid, 'viewer'::app_role)
     OR public.has_role(v_uid, 'fernando'::app_role)
     OR public.has_role(v_uid, 'operacoes'::app_role);

  IF NOT v_is_manager AND _hotel_id IS NOT NULL THEN
    IF NOT (
      v_has_broad_view
      OR public.is_hotel_allowed(v_uid, _hotel_id)
      OR EXISTS (SELECT 1 FROM public.user_hotels uh WHERE uh.user_id = v_uid AND uh.hotel_id = _hotel_id)
    ) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    e.id, e.hotel_id, e.upload_id, e.employee_key, e.name,
    CASE WHEN v_is_manager THEN e.cpf ELSE NULL END,
    e."position", e.department, e.gender,
    CASE WHEN v_is_manager THEN e.birth_date ELSE NULL END,
    e.admission_date,
    CASE WHEN v_is_manager THEN e.termination_date ELSE NULL END,
    CASE WHEN v_is_manager THEN e.termination_reason ELSE NULL END,
    CASE WHEN v_is_manager THEN e.salary ELSE NULL END,
    e.status, e.source_format,
    CASE WHEN v_is_manager THEN e.raw ELSE '{}'::jsonb END,
    e.reference_month, e.reference_year, e.created_at, e.updated_at
  FROM public.rh_employees e
  WHERE
    (
      v_is_manager
      OR v_has_broad_view
      OR EXISTS (SELECT 1 FROM public.user_hotels uh WHERE uh.user_id = v_uid AND uh.hotel_id = e.hotel_id)
    )
    AND (_hotel_id IS NULL OR e.hotel_id = _hotel_id)
    AND (_reference_month IS NULL OR e.reference_month = _reference_month)
    AND (_reference_year IS NULL OR e.reference_year = _reference_year)
  ORDER BY e.name;
END;
$$;

-- ============================================================
-- #2: dre_download_log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dre_download_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dre_version_id uuid NOT NULL REFERENCES public.dre_versions(id) ON DELETE CASCADE,
  closing_id uuid NOT NULL REFERENCES public.closings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  user_email text,
  user_display_name text,
  file_name text,
  version_number integer,
  downloaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dre_download_log_closing ON public.dre_download_log(closing_id, downloaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_dre_download_log_version ON public.dre_download_log(dre_version_id, downloaded_at DESC);

GRANT SELECT, INSERT ON public.dre_download_log TO authenticated;
GRANT ALL ON public.dre_download_log TO service_role;

ALTER TABLE public.dre_download_log ENABLE ROW LEVEL SECURITY;

-- INSERT: qualquer autenticado com acesso ao fechamento pode registrar o próprio download
CREATE POLICY "dre_download_log_insert_self"
  ON public.dre_download_log FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id = closing_id
        AND (public.has_global_data_access(auth.uid())
             OR public.is_hotel_allowed(auth.uid(), c.hotel_id))
    )
  );

-- SELECT: master/controladoria/patronos/viewer
CREATE POLICY "dre_download_log_select_privileged"
  ON public.dre_download_log FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'controladoria'::app_role)
    OR public.has_role(auth.uid(), 'patronos'::app_role)
    OR public.has_role(auth.uid(), 'viewer'::app_role)
  );

-- ============================================================
-- #3: Reforço de SLA de 48h para DREs
-- ============================================================
ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS sla_reminder_sent_at timestamptz;

ALTER TYPE public.notification_event ADD VALUE IF NOT EXISTS 'dre_sla_reminder';
