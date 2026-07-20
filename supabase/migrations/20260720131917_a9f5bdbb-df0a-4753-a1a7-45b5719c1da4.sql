
-- investor_letters UPDATE: add ri
DROP POLICY IF EXISTS letters_update_authoring ON public.investor_letters;
CREATE POLICY letters_update_authoring ON public.investor_letters
FOR UPDATE TO authenticated
USING (
  is_master(auth.uid())
  OR has_role(auth.uid(), 'controladoria'::app_role)
  OR has_role(auth.uid(), 'fernando'::app_role)
  OR has_role(auth.uid(), 'ri'::app_role)
  OR ((has_role(auth.uid(), 'gop'::app_role) OR has_role(auth.uid(), 'gg'::app_role))
      AND EXISTS (SELECT 1 FROM closings c WHERE c.id = investor_letters.closing_id AND is_hotel_allowed(auth.uid(), c.hotel_id)))
);

-- letter_highlights UPDATE
DROP POLICY IF EXISTS highlights_update_authoring ON public.letter_highlights;
CREATE POLICY highlights_update_authoring ON public.letter_highlights
FOR UPDATE TO authenticated
USING (
  is_master(auth.uid())
  OR has_role(auth.uid(), 'controladoria'::app_role)
  OR has_role(auth.uid(), 'fernando'::app_role)
  OR has_role(auth.uid(), 'ri'::app_role)
  OR ((has_role(auth.uid(), 'gop'::app_role) OR has_role(auth.uid(), 'gg'::app_role))
      AND EXISTS (SELECT 1 FROM closings c WHERE c.id = letter_highlights.closing_id AND is_hotel_allowed(auth.uid(), c.hotel_id)))
);

-- letter_highlights DELETE
DROP POLICY IF EXISTS highlights_delete_authoring ON public.letter_highlights;
CREATE POLICY highlights_delete_authoring ON public.letter_highlights
FOR DELETE TO authenticated
USING (
  is_master(auth.uid())
  OR has_role(auth.uid(), 'controladoria'::app_role)
  OR has_role(auth.uid(), 'fernando'::app_role)
  OR has_role(auth.uid(), 'ri'::app_role)
  OR ((has_role(auth.uid(), 'gop'::app_role) OR has_role(auth.uid(), 'gg'::app_role))
      AND EXISTS (SELECT 1 FROM closings c WHERE c.id = letter_highlights.closing_id AND is_hotel_allowed(auth.uid(), c.hotel_id)))
);

-- Storage: letter-highlights insert/delete for ri
DROP POLICY IF EXISTS letter_highlights_storage_insert ON storage.objects;
CREATE POLICY letter_highlights_storage_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'letter-highlights'
  AND (
    is_master(auth.uid())
    OR has_role(auth.uid(), 'controladoria'::app_role)
    OR has_role(auth.uid(), 'fernando'::app_role)
    OR has_role(auth.uid(), 'ri'::app_role)
    OR ((has_role(auth.uid(), 'gop'::app_role) OR has_role(auth.uid(), 'gg'::app_role))
        AND EXISTS (SELECT 1 FROM closings c WHERE (c.id)::text = (storage.foldername(objects.name))[1] AND is_hotel_allowed(auth.uid(), c.hotel_id)))
  )
);

DROP POLICY IF EXISTS letter_highlights_storage_delete ON storage.objects;
CREATE POLICY letter_highlights_storage_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'letter-highlights'
  AND (
    is_master(auth.uid())
    OR has_role(auth.uid(), 'controladoria'::app_role)
    OR has_role(auth.uid(), 'fernando'::app_role)
    OR has_role(auth.uid(), 'ri'::app_role)
    OR ((has_role(auth.uid(), 'gop'::app_role) OR has_role(auth.uid(), 'gg'::app_role))
        AND EXISTS (SELECT 1 FROM closings c WHERE (c.id)::text = (storage.foldername(objects.name))[1] AND is_hotel_allowed(auth.uid(), c.hotel_id)))
  )
);

-- Storage: letter_highlights SELECT already scoped to is_hotel_allowed, allow ri (has global read)
DROP POLICY IF EXISTS letter_highlights_storage_select ON storage.objects;
CREATE POLICY letter_highlights_storage_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'letter-highlights'
  AND (
    has_global_data_access(auth.uid())
    OR EXISTS (SELECT 1 FROM closings c WHERE (c.id)::text = (storage.foldername(objects.name))[1] AND is_hotel_allowed(auth.uid(), c.hotel_id))
  )
);
