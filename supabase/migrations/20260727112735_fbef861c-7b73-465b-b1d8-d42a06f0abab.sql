DROP POLICY IF EXISTS highlights_insert_authoring ON public.letter_highlights;
CREATE POLICY highlights_insert_authoring ON public.letter_highlights
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid() AND (
    is_master(auth.uid())
    OR has_role(auth.uid(), 'controladoria'::app_role)
    OR has_role(auth.uid(), 'fernando'::app_role)
    OR has_role(auth.uid(), 'ri'::app_role)
    OR ((has_role(auth.uid(), 'gop'::app_role) OR has_role(auth.uid(), 'gg'::app_role))
        AND EXISTS (SELECT 1 FROM closings c WHERE c.id = letter_highlights.closing_id AND is_hotel_allowed(auth.uid(), c.hotel_id)))
  )
);

DROP POLICY IF EXISTS letters_insert_authoring ON public.investor_letters;
CREATE POLICY letters_insert_authoring ON public.investor_letters
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid() AND (
    is_master(auth.uid())
    OR has_role(auth.uid(), 'controladoria'::app_role)
    OR has_role(auth.uid(), 'fernando'::app_role)
    OR has_role(auth.uid(), 'ri'::app_role)
    OR ((has_role(auth.uid(), 'gop'::app_role) OR has_role(auth.uid(), 'gg'::app_role))
        AND EXISTS (SELECT 1 FROM closings c WHERE c.id = investor_letters.closing_id AND is_hotel_allowed(auth.uid(), c.hotel_id)))
  )
);