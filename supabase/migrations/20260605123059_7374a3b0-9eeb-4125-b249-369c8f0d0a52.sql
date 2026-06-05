
-- 1) Viewers podem listar todos os hotéis (visão global read-only)
DROP POLICY IF EXISTS hotels_select_any_role ON public.hotels;
CREATE POLICY hotels_select_any_role ON public.hotels
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid())
    AND NOT has_role(auth.uid(), 'ri'::app_role)
    AND NOT has_role(auth.uid(), 'marketing'::app_role)
    AND NOT has_role(auth.uid(), 'comercial'::app_role)
  );

-- 2) Anexos no calendário (lista de {name,url})
ALTER TABLE public.rh_calendar_posts
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
