CREATE OR REPLACE FUNCTION public.protect_profile_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow privileged roles to change any column
  IF public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'processos'::app_role) THEN
    RETURN NEW;
  END IF;

  -- For self-updates, block changes to sensitive columns
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.financeiro_subrole IS DISTINCT FROM OLD.financeiro_subrole THEN
    RAISE EXCEPTION 'Not allowed to modify protected profile fields';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_self_update ON public.profiles;
CREATE TRIGGER trg_protect_profile_self_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_self_update();