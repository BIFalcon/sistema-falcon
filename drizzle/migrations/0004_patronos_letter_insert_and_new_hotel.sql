DROP POLICY IF EXISTS letters_insert_authoring ON public.investor_letters;
CREATE POLICY letters_insert_authoring ON public.investor_letters
FOR INSERT TO authenticated
WITH CHECK (
  (created_by = auth.uid())
  AND (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'controladoria'::app_role)
    OR public.has_role(auth.uid(), 'fernando'::app_role)
    OR public.has_role(auth.uid(), 'ri'::app_role)
    OR public.is_patronos(auth.uid())
    OR (
      (public.has_role(auth.uid(), 'gop'::app_role) OR public.has_role(auth.uid(), 'gg'::app_role))
      AND EXISTS (
        SELECT 1 FROM public.closings c
        WHERE c.id = investor_letters.closing_id
          AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
      )
    )
  )
);

INSERT INTO public.hotels (id, name, brand, active, is_active, show_in_closing, rh_only)
VALUES ('vitoria-palace', 'Vitória Palace Hotel', 'Falcon', true, true, true, false)
ON CONFLICT (id) DO NOTHING;