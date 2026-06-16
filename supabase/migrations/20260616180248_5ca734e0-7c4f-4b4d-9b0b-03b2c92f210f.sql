CREATE OR REPLACE FUNCTION public.protect_profile_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Backend/auth triggers and service-role/admin operations do not carry an end-user auth.uid().
  -- They must be allowed so invite/recovery verification can activate pending profiles.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow privileged users to change protected columns.
  IF public.is_master(v_uid) OR public.has_role(v_uid, 'processos'::app_role) THEN
    RETURN NEW;
  END IF;

  -- For normal self-updates, block changes to sensitive columns.
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.financeiro_subrole IS DISTINCT FROM OLD.financeiro_subrole THEN
    RAISE EXCEPTION 'Not allowed to modify protected profile fields';
  END IF;

  RETURN NEW;
END;
$$;

UPDATE public.profiles p
SET status = 'active'
FROM auth.users u
WHERE p.user_id = u.id
  AND u.email_confirmed_at IS NOT NULL
  AND p.status = 'pending';