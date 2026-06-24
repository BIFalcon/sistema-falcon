CREATE OR REPLACE FUNCTION public.guard_profile_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_privileged boolean;
BEGIN
  -- Service role / internal calls (no auth.uid) bypass the guard.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  v_privileged := public.is_master(v_uid) OR public.is_patronos(v_uid);

  IF v_privileged THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Não é permitido alterar o status do próprio perfil';
  END IF;

  IF NEW.financeiro_subrole IS DISTINCT FROM OLD.financeiro_subrole THEN
    RAISE EXCEPTION 'Não é permitido alterar o sub-papel financeiro do próprio perfil';
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Não é permitido alterar user_id';
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Não é permitido alterar o email diretamente';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_self_update ON public.profiles;
CREATE TRIGGER profiles_guard_self_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_self_update();