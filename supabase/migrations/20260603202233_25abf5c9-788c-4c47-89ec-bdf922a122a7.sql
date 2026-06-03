DROP VIEW IF EXISTS public.hotels_public;
REVOKE EXECUTE ON FUNCTION public.get_hotel_financial(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hotel_financial(text) TO authenticated;
