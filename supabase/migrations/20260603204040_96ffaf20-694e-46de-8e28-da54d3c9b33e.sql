CREATE OR REPLACE FUNCTION public.is_protected_user(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'processos'
  );
$$;

CREATE OR REPLACE FUNCTION public.protect_admin_user_roles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.role = 'processos' THEN
    RAISE EXCEPTION 'Não é permitido remover a role processos';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;