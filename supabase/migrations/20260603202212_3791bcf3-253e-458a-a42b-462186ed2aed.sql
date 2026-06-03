-- Restrict hotels.bank_accounts: create view excluding sensitive cols + tighten SELECT policy
DROP POLICY IF EXISTS hotels_select_any_role ON public.hotels;

CREATE POLICY hotels_select_financial
ON public.hotels
FOR SELECT
TO authenticated
USING (
  is_master(auth.uid())
  OR has_role(auth.uid(), 'controladoria'::app_role)
  OR has_role(auth.uid(), 'patronos'::app_role)
);

-- Safe view for other roles that need hotel metadata but not bank_accounts/cnpj
CREATE OR REPLACE VIEW public.hotels_public AS
SELECT
  id, name, brand, brand_logo_url, cover_url,
  is_active, active, show_in_closing,
  num_apartments, opera_property_name, financial_system,
  created_at
FROM public.hotels;

GRANT SELECT ON public.hotels_public TO authenticated;

-- Allow non-financial roles to read non-sensitive hotel data via second permissive policy
CREATE POLICY hotels_select_basic_no_secrets
ON public.hotels
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid())
  AND NOT has_role(auth.uid(), 'viewer'::app_role)
  AND NOT has_role(auth.uid(), 'ri'::app_role)
  AND NOT has_role(auth.uid(), 'marketing'::app_role)
  AND NOT has_role(auth.uid(), 'comercial'::app_role)
);

-- Note: above still exposes bank_accounts. Replace with column-aware approach:
DROP POLICY hotels_select_basic_no_secrets ON public.hotels;

-- Revoke direct column access to bank_accounts/cnpj for authenticated; keep for service_role
REVOKE SELECT ON public.hotels FROM authenticated;
GRANT SELECT (
  id, name, brand, brand_logo_url, cover_url,
  is_active, active, show_in_closing,
  num_apartments, opera_property_name, financial_system,
  created_at
) ON public.hotels TO authenticated;

-- Grant bank_accounts/cnpj only to financial roles via separate grant is not possible per-role in PG without separate role.
-- Use a SECURITY DEFINER function for financial users when they need bank_accounts.
-- Recreate broad policy allowing any role to SELECT (column grants enforce restriction)
DROP POLICY hotels_select_financial ON public.hotels;

CREATE POLICY hotels_select_any_role
ON public.hotels
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid())
  AND NOT has_role(auth.uid(), 'viewer'::app_role)
  AND NOT has_role(auth.uid(), 'ri'::app_role)
  AND NOT has_role(auth.uid(), 'marketing'::app_role)
  AND NOT has_role(auth.uid(), 'comercial'::app_role)
);

-- Additional column grants for sensitive fields, restricted via RLS column check function
GRANT SELECT (bank_accounts, cnpj) ON public.hotels TO authenticated;

-- Enforce via additional restrictive policy on sensitive columns is not directly possible.
-- Instead: create a separate row-level RESTRICTIVE policy that denies rows when sensitive cols requested by non-financial roles isn't feasible.
-- Use trigger-free approach: revoke column grants for sensitive cols from generic authenticated
REVOKE SELECT (bank_accounts, cnpj) ON public.hotels FROM authenticated;

-- Provide SECURITY DEFINER function for financial roles to fetch bank_accounts
CREATE OR REPLACE FUNCTION public.get_hotel_financial(_hotel_id text)
RETURNS TABLE(id text, bank_accounts jsonb, cnpj text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.id, h.bank_accounts, h.cnpj
  FROM public.hotels h
  WHERE h.id = _hotel_id
    AND (
      public.is_master(auth.uid())
      OR public.has_role(auth.uid(), 'controladoria'::app_role)
      OR public.has_role(auth.uid(), 'patronos'::app_role)
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_hotel_financial(text) TO authenticated;

-- ============================================================
-- user_roles / user_hotels / user_permissions: restrict enumeration
-- ============================================================

-- user_roles
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' AND cmd='SELECT' LOOP
    EXECUTE format('DROP POLICY %I ON public.user_roles', r.policyname);
  END LOOP;
END$$;

CREATE POLICY user_roles_select_self_or_admin
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_master(auth.uid())
  OR public.has_role(auth.uid(), 'fernando'::app_role)
);

-- user_hotels
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='user_hotels' AND cmd='SELECT' LOOP
    EXECUTE format('DROP POLICY %I ON public.user_hotels', r.policyname);
  END LOOP;
END$$;

CREATE POLICY user_hotels_select_self_or_admin
ON public.user_hotels
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_master(auth.uid())
  OR public.has_role(auth.uid(), 'fernando'::app_role)
);

-- user_permissions
DO $$
DECLARE r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='user_permissions') THEN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='user_permissions' AND cmd='SELECT' LOOP
      EXECUTE format('DROP POLICY %I ON public.user_permissions', r.policyname);
    END LOOP;
    EXECUTE 'CREATE POLICY user_permissions_select_self_or_admin ON public.user_permissions FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_master(auth.uid()) OR public.has_role(auth.uid(), ''fernando''::app_role))';
  END IF;
END$$;
