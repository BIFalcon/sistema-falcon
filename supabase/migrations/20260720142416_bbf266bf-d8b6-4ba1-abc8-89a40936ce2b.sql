
-- RI: acesso de leitura ao registro de versões da DRE quando o fechamento está aprovado
DROP POLICY IF EXISTS dre_versions_select_ri_approved ON public.dre_versions;
CREATE POLICY dre_versions_select_ri_approved ON public.dre_versions
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'ri'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id = dre_versions.closing_id
        AND c.status_dre = 'aprovado'::public.closing_status
    )
  );

-- RI: acesso de leitura ao arquivo no bucket "closings" quando o fechamento está aprovado
DROP POLICY IF EXISTS closings_storage_select_ri_approved ON storage.objects;
CREATE POLICY closings_storage_select_ri_approved ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'closings'
    AND public.has_role(auth.uid(), 'ri'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id::text = split_part(storage.objects.name, '/', 1)
        AND c.status_dre = 'aprovado'::public.closing_status
    )
  );
