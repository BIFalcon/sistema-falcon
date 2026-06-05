
DROP VIEW IF EXISTS public.hotels_safe;
DROP FUNCTION IF EXISTS public.get_hotel_financial(text);

DROP POLICY IF EXISTS hotels_select_any_role ON public.hotels;
CREATE POLICY hotels_select_any_role ON public.hotels
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid())
    AND NOT has_role(auth.uid(), 'ri'::app_role)
    AND NOT has_role(auth.uid(), 'marketing'::app_role)
    AND NOT has_role(auth.uid(), 'comercial'::app_role)
  );

REVOKE SELECT (bank_accounts, cnpj) ON public.hotels FROM authenticated;
REVOKE SELECT (bank_accounts, cnpj) ON public.hotels FROM anon;
GRANT SELECT (
  id, name, brand, active, is_active, cover_url, brand_logo_url,
  opera_property_name, num_apartments, financial_system,
  show_in_closing, created_at
) ON public.hotels TO authenticated;

CREATE FUNCTION public.get_hotel_financial(_hotel_id text)
RETURNS TABLE(hotel_id text, bank_accounts jsonb, cnpj text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.is_master(auth.uid())
    OR public.has_role(auth.uid(), 'controladoria'::app_role)
    OR public.has_role(auth.uid(), 'patronos'::app_role)
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT h.id, h.bank_accounts, h.cnpj
  FROM public.hotels h
  WHERE h.id = _hotel_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_hotel_financial(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hotel_financial(text) TO authenticated;
