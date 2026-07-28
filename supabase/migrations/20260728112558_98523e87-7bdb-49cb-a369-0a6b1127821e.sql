DROP POLICY IF EXISTS hotels_select_any_role ON public.hotels;

CREATE POLICY hotels_select_any_role
ON public.hotels
FOR SELECT
USING (
  has_any_role(auth.uid())
  AND NOT has_role(auth.uid(), 'marketing'::app_role)
  AND NOT has_role(auth.uid(), 'comercial'::app_role)
  AND public.can_view_hotel_data(auth.uid(), id)
);