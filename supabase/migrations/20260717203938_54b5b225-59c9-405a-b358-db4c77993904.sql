
-- Permitir que usuários com role 'fernando' criem/editem cartas ao investidor,
-- gerenciem destaques e enviem/removam PDFs no storage.

-- investor_letters
DROP POLICY IF EXISTS letters_insert_authoring ON public.investor_letters;
CREATE POLICY letters_insert_authoring ON public.investor_letters
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    is_master(auth.uid())
    OR has_role(auth.uid(),'controladoria')
    OR has_role(auth.uid(),'fernando')
    OR (
      (has_role(auth.uid(),'gop') OR has_role(auth.uid(),'gg'))
      AND EXISTS (SELECT 1 FROM closings c WHERE c.id = investor_letters.closing_id AND is_hotel_allowed(auth.uid(), c.hotel_id))
    )
  )
);

DROP POLICY IF EXISTS letters_update_authoring ON public.investor_letters;
CREATE POLICY letters_update_authoring ON public.investor_letters
FOR UPDATE TO authenticated
USING (
  is_master(auth.uid())
  OR has_role(auth.uid(),'controladoria')
  OR has_role(auth.uid(),'fernando')
  OR (
    (has_role(auth.uid(),'gop') OR has_role(auth.uid(),'gg'))
    AND EXISTS (SELECT 1 FROM closings c WHERE c.id = investor_letters.closing_id AND is_hotel_allowed(auth.uid(), c.hotel_id))
  )
)
WITH CHECK (
  is_master(auth.uid())
  OR has_role(auth.uid(),'controladoria')
  OR has_role(auth.uid(),'fernando')
  OR EXISTS (SELECT 1 FROM closings c WHERE c.id = investor_letters.closing_id AND is_hotel_allowed(auth.uid(), c.hotel_id))
);

-- letter_highlights
DROP POLICY IF EXISTS highlights_insert_authoring ON public.letter_highlights;
CREATE POLICY highlights_insert_authoring ON public.letter_highlights
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    is_master(auth.uid())
    OR has_role(auth.uid(),'controladoria')
    OR has_role(auth.uid(),'fernando')
    OR (
      (has_role(auth.uid(),'gop') OR has_role(auth.uid(),'gg'))
      AND EXISTS (SELECT 1 FROM closings c WHERE c.id = letter_highlights.closing_id AND is_hotel_allowed(auth.uid(), c.hotel_id))
    )
  )
);

DROP POLICY IF EXISTS highlights_update_authoring ON public.letter_highlights;
CREATE POLICY highlights_update_authoring ON public.letter_highlights
FOR UPDATE TO authenticated
USING (
  is_master(auth.uid())
  OR has_role(auth.uid(),'controladoria')
  OR has_role(auth.uid(),'fernando')
  OR (
    (has_role(auth.uid(),'gop') OR has_role(auth.uid(),'gg'))
    AND EXISTS (SELECT 1 FROM closings c WHERE c.id = letter_highlights.closing_id AND is_hotel_allowed(auth.uid(), c.hotel_id))
  )
)
WITH CHECK (
  is_master(auth.uid())
  OR has_role(auth.uid(),'controladoria')
  OR has_role(auth.uid(),'fernando')
  OR EXISTS (SELECT 1 FROM closings c WHERE c.id = letter_highlights.closing_id AND is_hotel_allowed(auth.uid(), c.hotel_id))
);

DROP POLICY IF EXISTS highlights_delete_authoring ON public.letter_highlights;
CREATE POLICY highlights_delete_authoring ON public.letter_highlights
FOR DELETE TO authenticated
USING (
  is_master(auth.uid())
  OR has_role(auth.uid(),'controladoria')
  OR has_role(auth.uid(),'fernando')
  OR (
    (has_role(auth.uid(),'gop') OR has_role(auth.uid(),'gg'))
    AND EXISTS (SELECT 1 FROM closings c WHERE c.id = letter_highlights.closing_id AND is_hotel_allowed(auth.uid(), c.hotel_id))
  )
);

-- Storage: investor-letters (upload/gerar PDF)
DROP POLICY IF EXISTS letters_storage_insert_scoped ON storage.objects;
CREATE POLICY letters_storage_insert_scoped ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'investor-letters'
  AND (
    is_master(auth.uid())
    OR has_role(auth.uid(),'controladoria')
    OR has_role(auth.uid(),'fernando')
    OR has_role(auth.uid(),'gop')
    OR (
      has_role(auth.uid(),'gg')
      AND EXISTS (SELECT 1 FROM closings c WHERE c.id::text = split_part(objects.name,'/',1) AND is_hotel_allowed(auth.uid(), c.hotel_id))
    )
  )
);

-- Permite fernando substituir/remover PDFs também
DROP POLICY IF EXISTS letters_storage_update_master ON storage.objects;
CREATE POLICY letters_storage_update_fernando ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'investor-letters' AND (is_master(auth.uid()) OR has_role(auth.uid(),'fernando') OR has_role(auth.uid(),'controladoria')))
WITH CHECK (bucket_id = 'investor-letters' AND (is_master(auth.uid()) OR has_role(auth.uid(),'fernando') OR has_role(auth.uid(),'controladoria')));

DROP POLICY IF EXISTS letters_storage_delete_master ON storage.objects;
CREATE POLICY letters_storage_delete_fernando ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'investor-letters' AND (is_master(auth.uid()) OR has_role(auth.uid(),'fernando') OR has_role(auth.uid(),'controladoria')));

-- Storage: letter-highlights (fotos dos destaques)
DROP POLICY IF EXISTS letter_highlights_storage_insert ON storage.objects;
CREATE POLICY letter_highlights_storage_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'letter-highlights'
  AND (
    is_master(auth.uid())
    OR has_role(auth.uid(),'controladoria')
    OR has_role(auth.uid(),'fernando')
    OR (
      (has_role(auth.uid(),'gop') OR has_role(auth.uid(),'gg'))
      AND EXISTS (SELECT 1 FROM closings c WHERE c.id::text = (storage.foldername(objects.name))[1] AND is_hotel_allowed(auth.uid(), c.hotel_id))
    )
  )
);

DROP POLICY IF EXISTS letter_highlights_storage_delete ON storage.objects;
CREATE POLICY letter_highlights_storage_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'letter-highlights'
  AND (
    is_master(auth.uid())
    OR has_role(auth.uid(),'controladoria')
    OR has_role(auth.uid(),'fernando')
    OR (
      (has_role(auth.uid(),'gop') OR has_role(auth.uid(),'gg'))
      AND EXISTS (SELECT 1 FROM closings c WHERE c.id::text = (storage.foldername(objects.name))[1] AND is_hotel_allowed(auth.uid(), c.hotel_id))
    )
  )
);
