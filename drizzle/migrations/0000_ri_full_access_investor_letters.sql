-- RI passa a ter acesso completo às Cartas ao Investidor em qualquer etapa de aprovação.

DROP POLICY IF EXISTS letters_select_scoped ON public.investor_letters;
CREATE POLICY letters_select_scoped ON public.investor_letters
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.closings c
  WHERE c.id = investor_letters.closing_id
    AND public.can_view_hotel_data(auth.uid(), c.hotel_id)
));

DROP POLICY IF EXISTS highlights_select_scoped ON public.letter_highlights;
CREATE POLICY highlights_select_scoped ON public.letter_highlights
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.closings c
  WHERE c.id = letter_highlights.closing_id
    AND public.can_view_hotel_data(auth.uid(), c.hotel_id)
));

DROP POLICY IF EXISTS letter_versions_select_scoped ON public.letter_versions;
CREATE POLICY letter_versions_select_scoped ON public.letter_versions
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.closings c
  WHERE c.id = letter_versions.closing_id
    AND public.can_view_hotel_data(auth.uid(), c.hotel_id)
));

-- Storage: PDFs da carta
DROP POLICY IF EXISTS letters_storage_select_scoped ON storage.objects;
CREATE POLICY letters_storage_select_scoped ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'investor-letters'
  AND (
    public.is_master(auth.uid())
    OR public.has_global_data_access(auth.uid())
    OR public.has_role(auth.uid(), 'fernando'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id::text = split_part(objects.name, '/', 1)
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  )
);

DROP POLICY IF EXISTS letter_highlights_storage_select ON storage.objects;
CREATE POLICY letter_highlights_storage_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'letter-highlights'
  AND (
    public.is_master(auth.uid())
    OR public.has_global_data_access(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.closings c
      WHERE c.id::text = (storage.foldername(objects.name))[1]
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  )
);

-- Storage: gerar/substituir/remover PDF da carta (inclui RI)
DROP POLICY IF EXISTS letters_storage_insert_scoped ON storage.objects;
CREATE POLICY letters_storage_insert_scoped ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'investor-letters'
  AND (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(),'controladoria'::app_role)
    OR public.has_role(auth.uid(),'fernando'::app_role)
    OR public.has_role(auth.uid(),'ri'::app_role)
    OR public.has_role(auth.uid(),'gop'::app_role)
    OR (
      public.has_role(auth.uid(),'gg'::app_role)
      AND EXISTS (SELECT 1 FROM public.closings c WHERE c.id::text = split_part(objects.name,'/',1) AND public.is_hotel_allowed(auth.uid(), c.hotel_id))
    )
  )
);

DROP POLICY IF EXISTS letters_storage_update_fernando ON storage.objects;
CREATE POLICY letters_storage_update_fernando ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'investor-letters' AND (public.is_master(auth.uid()) OR public.has_role(auth.uid(),'fernando'::app_role) OR public.has_role(auth.uid(),'controladoria'::app_role) OR public.has_role(auth.uid(),'ri'::app_role)))
WITH CHECK (bucket_id = 'investor-letters' AND (public.is_master(auth.uid()) OR public.has_role(auth.uid(),'fernando'::app_role) OR public.has_role(auth.uid(),'controladoria'::app_role) OR public.has_role(auth.uid(),'ri'::app_role)));

DROP POLICY IF EXISTS letters_storage_delete_fernando ON storage.objects;
CREATE POLICY letters_storage_delete_fernando ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'investor-letters' AND (public.is_master(auth.uid()) OR public.has_role(auth.uid(),'fernando'::app_role) OR public.has_role(auth.uid(),'controladoria'::app_role) OR public.has_role(auth.uid(),'ri'::app_role)));
