DO $$
DECLARE
  r record;
  svc_only text[] := ARRAY[
    'be_eight_list_tables()',
    'be_eight_purge_expired_jti()',
    'enqueue_dre_sla_reminders()'
  ];
  svc_fns text[] := ARRAY[
    'enqueue_email(text, jsonb)',
    'delete_email(text, bigint)',
    'move_to_dlq(text, text, bigint, jsonb)',
    'enqueue_workflow_notification(notification_event, uuid, text, jsonb, text, text, text, jsonb)',
    'enqueue_ar_notification(notification_event, text, app_role[], app_role[], text, text, text, jsonb)',
    'users_with_role_for_hotel(app_role, text)',
    'users_with_role_global(app_role)'
  ];
  role_fns text[] := ARRAY[
    'has_role(uuid, app_role)',
    'is_master(uuid)',
    'is_hotel_allowed(uuid, text)',
    'is_ap_manager(uuid)',
    'is_ar_manager(uuid)',
    'is_rh_manager(uuid)',
    'is_dre_uploader(uuid)',
    'is_patronos(uuid)',
    'has_any_role(uuid)',
    'has_global_data_access(uuid)',
    'can_view_hotel_data(uuid, text)',
    'can_read_dre_hotel(uuid, text)',
    'can_view_rh_directory(uuid)',
    'can_edit_rh_content(uuid)',
    'can_edit_marketing(uuid)',
    'is_marketing_audience(uuid)'
  ];
  sig text;
BEGIN
  -- 1) Funções exclusivamente server-side (service_role apenas)
  FOREACH sig IN ARRAY svc_only || svc_fns LOOP
    IF to_regprocedure('public.' || sig) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', sig);
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', sig);
    END IF;
  END LOOP;

  -- 2) Helpers de papel/hotel: usados em policies RLS por usuários autenticados
  --    e também por Edge Functions com service_role.
  FOREACH sig IN ARRAY role_fns LOOP
    IF to_regprocedure('public.' || sig) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', sig);
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', sig);
    END IF;
  END LOOP;
END $$;