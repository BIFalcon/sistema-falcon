-- Buckets
INSERT INTO storage.buckets (id, name, public)
VALUES ('rh-assets', 'rh-assets', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('rh-policies', 'rh-policies', false)
ON CONFLICT (id) DO NOTHING;

-- rh-assets policies
DROP POLICY IF EXISTS "rh_assets_select_public" ON storage.objects;
CREATE POLICY "rh_assets_select_public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'rh-assets');

DROP POLICY IF EXISTS "rh_assets_insert_editors" ON storage.objects;
CREATE POLICY "rh_assets_insert_editors"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rh-assets' AND public.can_edit_rh_content(auth.uid()));

DROP POLICY IF EXISTS "rh_assets_update_editors" ON storage.objects;
CREATE POLICY "rh_assets_update_editors"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'rh-assets' AND public.can_edit_rh_content(auth.uid()));

DROP POLICY IF EXISTS "rh_assets_delete_editors" ON storage.objects;
CREATE POLICY "rh_assets_delete_editors"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'rh-assets' AND public.can_edit_rh_content(auth.uid()));

-- rh-policies policies (privado)
DROP POLICY IF EXISTS "rh_policies_select_authenticated" ON storage.objects;
CREATE POLICY "rh_policies_select_authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rh-policies' AND public.has_any_role(auth.uid()));

DROP POLICY IF EXISTS "rh_policies_insert_rh" ON storage.objects;
CREATE POLICY "rh_policies_insert_rh"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rh-policies' AND public.is_rh_manager(auth.uid()));

DROP POLICY IF EXISTS "rh_policies_update_rh" ON storage.objects;
CREATE POLICY "rh_policies_update_rh"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'rh-policies' AND public.is_rh_manager(auth.uid()));

DROP POLICY IF EXISTS "rh_policies_delete_rh" ON storage.objects;
CREATE POLICY "rh_policies_delete_rh"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'rh-policies' AND public.is_rh_manager(auth.uid()));