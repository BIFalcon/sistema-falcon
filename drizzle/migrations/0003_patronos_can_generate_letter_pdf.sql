-- Patronos podem gerar novo PDF da carta (upload/substituição no bucket + gravar pdf_url)
DROP POLICY IF EXISTS letters_update_authoring ON public.investor_letters;
CREATE POLICY letters_update_authoring ON public.investor_letters
FOR UPDATE TO authenticated
USING (
  public.is_master(auth.uid())
  OR public.has_role(auth.uid(), 'controladoria'::app_role)
  OR public.has_role(auth.uid(), 'fernando'::app_role)
  OR public.has_role(auth.uid(), 'ri'::app_role)
  OR public.is_patronos(auth.uid())
  OR ((public.has_role(auth.uid(), 'gop'::app_role) OR public.has_role(auth.uid(), 'gg'::app_role))
      AND EXISTS (SELECT 1 FROM public.closings c WHERE c.id = investor_letters.closing_id AND public.is_hotel_allowed(auth.uid(), c.hotel_id)))
);

DROP POLICY IF EXISTS letters_storage_insert_scoped ON storage.objects;
CREATE POLICY letters_storage_insert_scoped ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'investor-letters'
  AND (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'controladoria'::app_role)
    OR public.has_role(auth.uid(), 'fernando'::app_role)
    OR public.has_role(auth.uid(), 'ri'::app_role)
    OR public.has_role(auth.uid(), 'gop'::app_role)
    OR public.is_patronos(auth.uid())
    OR (public.has_role(auth.uid(), 'gg'::app_role)
        AND EXISTS (SELECT 1 FROM public.closings c WHERE c.id::text = split_part(objects.name, '/', 1) AND public.is_hotel_allowed(auth.uid(), c.hotel_id)))
  )
);

DROP POLICY IF EXISTS letters_storage_update_fernando ON storage.objects;
CREATE POLICY letters_storage_update_fernando ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'investor-letters'
  AND (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'fernando'::app_role)
       OR public.has_role(auth.uid(), 'controladoria'::app_role) OR public.has_role(auth.uid(), 'ri'::app_role)
       OR public.is_patronos(auth.uid()))
)
WITH CHECK (
  bucket_id = 'investor-letters'
  AND (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'fernando'::app_role)
       OR public.has_role(auth.uid(), 'controladoria'::app_role) OR public.has_role(auth.uid(), 'ri'::app_role)
       OR public.is_patronos(auth.uid()))
);

DROP POLICY IF EXISTS letters_storage_delete_fernando ON storage.objects;
CREATE POLICY letters_storage_delete_fernando ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'investor-letters'
  AND (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'fernando'::app_role)
       OR public.has_role(auth.uid(), 'controladoria'::app_role) OR public.has_role(auth.uid(), 'ri'::app_role)
       OR public.is_patronos(auth.uid()))
);