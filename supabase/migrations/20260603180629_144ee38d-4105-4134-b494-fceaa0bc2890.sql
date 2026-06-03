DROP POLICY IF EXISTS letters_insert_authoring ON public.investor_letters;
CREATE POLICY letters_insert_authoring ON public.investor_letters
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id = investor_letters.closing_id
      AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
  )
  AND (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'controladoria'::app_role)
    OR public.has_role(auth.uid(), 'gop'::app_role)
    OR public.has_role(auth.uid(), 'gg'::app_role)
  )
);