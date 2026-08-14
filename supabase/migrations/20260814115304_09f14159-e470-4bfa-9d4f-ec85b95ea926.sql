REVOKE EXECUTE ON FUNCTION public.list_accessible_hotels() FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_accessible_hotels() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_accessible_hotels() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_accessible_hotels() TO service_role;