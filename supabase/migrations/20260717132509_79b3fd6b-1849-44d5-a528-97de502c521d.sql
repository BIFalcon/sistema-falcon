CREATE OR REPLACE FUNCTION public.get_profile_names(_user_ids uuid[])
 RETURNS TABLE(user_id uuid, display_name text, email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT p.user_id, p.display_name, NULL::text AS email
  FROM public.profiles p
  WHERE p.user_id = ANY(_user_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_profile_names(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_names(uuid[]) TO authenticated;