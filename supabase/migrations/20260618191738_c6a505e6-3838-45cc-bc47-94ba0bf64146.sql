CREATE OR REPLACE FUNCTION public.prevent_self_subrole_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.financeiro_subrole IS DISTINCT FROM OLD.financeiro_subrole THEN
    IF NOT (
      public.is_master(auth.uid())
      OR public.has_role(auth.uid(), 'processos'::app_role)
    ) THEN
      RAISE EXCEPTION 'Não é permitido alterar financeiro_subrole';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_self_subrole_change ON public.profiles;
CREATE TRIGGER profiles_prevent_self_subrole_change
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_subrole_change();