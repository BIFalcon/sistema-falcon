-- 1. Status do usuário
DO $$ BEGIN
  CREATE TYPE public.user_status AS ENUM ('active', 'pending', 'banned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status public.user_status NOT NULL DEFAULT 'pending';

-- Backfill: usuários que já confirmaram e-mail = active
UPDATE public.profiles p
SET status = 'active'
FROM auth.users u
WHERE p.user_id = u.id AND u.email_confirmed_at IS NOT NULL AND p.status = 'pending';

-- 2. Permissões granulares (chave-valor) — fase 2 vai popular pela UI
CREATE TABLE IF NOT EXISTS public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  permission_key text NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON public.user_permissions(user_id);

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_permissions_select_any_role"
  ON public.user_permissions FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid()) OR user_id = auth.uid());

CREATE POLICY "user_permissions_master_modify"
  ON public.user_permissions FOR ALL
  TO authenticated
  USING (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'processos'::app_role))
  WITH CHECK (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'processos'::app_role));

-- 3. Helper: verificar se um user_id é "intocável" (processos ou fernando)
CREATE OR REPLACE FUNCTION public.is_protected_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('processos', 'fernando')
  );
$$;

-- 4. Bloqueio: ninguém pode remover roles processos/fernando, nem banir esses users
CREATE OR REPLACE FUNCTION public.protect_admin_user_roles()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.role IN ('processos', 'fernando') THEN
    RAISE EXCEPTION 'Não é permitido remover roles processos/fernando';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_admin_user_roles ON public.user_roles;
CREATE TRIGGER trg_protect_admin_user_roles
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_admin_user_roles();

CREATE OR REPLACE FUNCTION public.protect_admin_profile_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'banned' AND public.is_protected_user(NEW.user_id) THEN
    RAISE EXCEPTION 'Não é permitido desativar usuários processos/fernando';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_admin_profile_status ON public.profiles;
CREATE TRIGGER trg_protect_admin_profile_status
  BEFORE UPDATE OF status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_admin_profile_status();

-- 5. Permitir que processos também gerencie roles e vínculos com hotéis
DROP POLICY IF EXISTS "user_roles_processos_insert" ON public.user_roles;
CREATE POLICY "user_roles_processos_insert"
  ON public.user_roles FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'processos'::app_role) OR public.is_master(auth.uid()));

DROP POLICY IF EXISTS "user_roles_processos_delete" ON public.user_roles;
CREATE POLICY "user_roles_processos_delete"
  ON public.user_roles FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'processos'::app_role) OR public.is_master(auth.uid()));

DROP POLICY IF EXISTS "user_hotels_processos_insert" ON public.user_hotels;
CREATE POLICY "user_hotels_processos_insert"
  ON public.user_hotels FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'processos'::app_role) OR public.is_master(auth.uid()));

DROP POLICY IF EXISTS "user_hotels_processos_delete" ON public.user_hotels;
CREATE POLICY "user_hotels_processos_delete"
  ON public.user_hotels FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'processos'::app_role) OR public.is_master(auth.uid()));

-- 6. Profiles: processos pode atualizar status de qualquer um
DROP POLICY IF EXISTS "profiles_processos_update" ON public.profiles;
CREATE POLICY "profiles_processos_update"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'processos'::app_role) OR public.is_master(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'processos'::app_role) OR public.is_master(auth.uid()));