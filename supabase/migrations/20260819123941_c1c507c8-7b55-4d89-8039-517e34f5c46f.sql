REVOKE ALL ON FUNCTION public.can_access_conciliacao(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_conciliacao(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_access_conciliacao(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_conciliacao(uuid) TO service_role;