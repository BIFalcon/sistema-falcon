
-- Retorna nome/e-mail de qualquer usuário para exibir autoria de comentários
-- e demais telas colaborativas (todos os autenticados da empresa).
CREATE OR REPLACE FUNCTION public.get_profile_names(_user_ids uuid[])
RETURNS TABLE(user_id uuid, display_name text, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.display_name, p.email
  FROM public.profiles p
  WHERE p.user_id = ANY(_user_ids);
$$;

REVOKE ALL ON FUNCTION public.get_profile_names(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_profile_names(uuid[]) TO authenticated;
