CREATE OR REPLACE FUNCTION public.is_dre_uploader(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_master(_user_id)
      OR public.has_role(_user_id, 'controladoria'::app_role)
      OR public.has_role(_user_id, 'patronos'::app_role)
      OR public.has_role(_user_id, 'gop'::app_role);
$$;