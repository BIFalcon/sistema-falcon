-- 1. Tighten ar_client_contracts SELECT
DROP POLICY IF EXISTS ar_contracts_select_scoped ON public.ar_client_contracts;
CREATE POLICY ar_contracts_select_scoped ON public.ar_client_contracts
FOR SELECT TO authenticated
USING (
  public.is_master(auth.uid())
  OR public.has_role(auth.uid(), 'controladoria')
  OR public.has_role(auth.uid(), 'patronos')
  OR public.is_ar_manager(auth.uid())
  OR (
    (public.has_role(auth.uid(), 'adm') OR public.has_role(auth.uid(), 'gg'))
    AND public.is_hotel_allowed(auth.uid(), hotel_id)
  )
);

-- 2. Revoke EXECUTE on all SECURITY DEFINER functions from anon/PUBLIC
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
  END LOOP;
END $$;

-- 3. Re-grant EXECUTE to authenticated only for RPCs/helpers the app calls
GRANT EXECUTE ON FUNCTION public.can_edit_marketing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_rh_content(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_dre_hotel(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_hotel_data(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_rh_directory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_ar_notification(notification_event, text, app_role[], app_role[], text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_workflow_notification(notification_event, uuid, text, jsonb, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ap_category_monthly_series(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_financeiro_subrole(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hotel_financial(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_latest_dre_lines(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_latest_dre_lines_by_closings(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_names(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_rh_employees_for_user(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_year_latest_dre_lines(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_global_data_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ap_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ar_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_financeiro_coordenadora(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_financeiro_equipe(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_hotel_allowed(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_marketing_audience(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_master(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_patronos(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_protected_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_rh_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_unsubscribed(uuid, notification_event) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_dre_uploader(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_envio_sent(uuid, boolean) TO authenticated;
