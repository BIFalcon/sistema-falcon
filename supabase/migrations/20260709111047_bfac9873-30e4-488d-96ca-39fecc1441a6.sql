REVOKE EXECUTE ON FUNCTION public.users_with_role_for_hotel(public.app_role, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.users_with_role_for_hotel(public.app_role, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.users_with_role_for_hotel(public.app_role, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.users_with_role_for_hotel(public.app_role, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.users_with_role_global(public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.users_with_role_global(public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.users_with_role_global(public.app_role) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.users_with_role_global(public.app_role) TO service_role;