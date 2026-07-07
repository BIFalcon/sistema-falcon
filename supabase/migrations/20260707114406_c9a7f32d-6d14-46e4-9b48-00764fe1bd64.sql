
-- Helper: quem pode ver o organograma / conteúdo institucional do RH
CREATE OR REPLACE FUNCTION public.can_view_rh_directory(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_master(_user_id)
      OR public.has_role(_user_id, 'rh'::app_role)
      OR public.has_role(_user_id, 'gg'::app_role)
      OR public.has_role(_user_id, 'adm'::app_role)
      OR public.has_role(_user_id, 'gop'::app_role)
      OR public.has_role(_user_id, 'controladoria'::app_role)
      OR public.has_role(_user_id, 'patronos'::app_role)
      OR public.has_role(_user_id, 'ri'::app_role)
      OR public.has_role(_user_id, 'fernando'::app_role);
$$;

-- rh_org_nodes: restringe SELECT
DROP POLICY IF EXISTS rh_org_nodes_select ON public.rh_org_nodes;
CREATE POLICY rh_org_nodes_select ON public.rh_org_nodes
FOR SELECT TO authenticated
USING (public.can_view_rh_directory(auth.uid()));

-- Storage: rh-photos e rh-assets
DROP POLICY IF EXISTS "rh-photos-authenticated-read" ON storage.objects;
CREATE POLICY "rh-photos-authenticated-read" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'rh-photos' AND public.can_view_rh_directory(auth.uid()));

DROP POLICY IF EXISTS "rh-assets-authenticated-read" ON storage.objects;
CREATE POLICY "rh-assets-authenticated-read" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'rh-assets' AND public.can_view_rh_directory(auth.uid()));

-- system_settings: só admin lê tudo; a chave pública falcon_logo_url continua visível
DROP POLICY IF EXISTS system_settings_select_any_role ON public.system_settings;
CREATE POLICY system_settings_select_admin ON public.system_settings
FOR SELECT TO authenticated
USING (
  public.is_master(auth.uid())
  OR public.has_role(auth.uid(), 'processos'::app_role)
);

CREATE POLICY system_settings_select_public_keys ON public.system_settings
FOR SELECT TO authenticated
USING (key IN ('falcon_logo_url'));
