-- 1) Papéis com visão global passam a incluir 'viewer' e 'ri'
CREATE OR REPLACE FUNCTION public.can_view_hotel_data(_user_id uuid, _hotel_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.is_master(_user_id)
    OR public.has_role(_user_id, 'controladoria')
    OR public.has_role(_user_id, 'patronos')
    OR public.has_role(_user_id, 'operacoes')
    OR public.has_role(_user_id, 'fernando')
    OR public.has_role(_user_id, 'rh')
    OR public.has_role(_user_id, 'viewer')
    OR public.has_role(_user_id, 'ri')
    OR EXISTS (
      SELECT 1 FROM public.user_hotels
      WHERE user_id = _user_id AND hotel_id = _hotel_id
    );
$function$;

-- 2) Fonte única de verdade para o filtro de hotéis (sem colunas sensíveis)
CREATE OR REPLACE FUNCTION public.list_accessible_hotels()
RETURNS TABLE(
  id text,
  name text,
  brand text,
  active boolean,
  is_active boolean,
  cover_url text,
  brand_logo_url text,
  opera_property_name text,
  num_apartments integer,
  financial_system financial_system,
  show_in_closing boolean,
  rh_only boolean,
  created_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT h.id, h.name, h.brand, h.active, h.is_active, h.cover_url, h.brand_logo_url,
         h.opera_property_name, h.num_apartments, h.financial_system, h.show_in_closing,
         h.rh_only, h.created_at
  FROM public.hotels h
  WHERE h.is_active
    AND public.has_any_role(auth.uid())
    AND NOT public.has_role(auth.uid(), 'marketing')
    AND NOT public.has_role(auth.uid(), 'comercial')
    AND public.can_view_hotel_data(auth.uid(), h.id)
  ORDER BY h.name;
$function$;

REVOKE ALL ON FUNCTION public.list_accessible_hotels() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_accessible_hotels() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_accessible_hotels() TO service_role;