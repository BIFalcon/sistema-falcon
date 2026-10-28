CREATE OR REPLACE FUNCTION public.can_read_dre_hotel(_user_id uuid, _hotel_id text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
 SELECT public.has_global_data_access(_user_id)
 OR public.has_role(_user_id, 'fernando'::public.app_role)
 OR public.has_role(_user_id, 'novos_negocios'::public.app_role)
 OR public.has_role(_user_id, 'gop'::public.app_role)
 OR public.is_hotel_allowed(_user_id, _hotel_id);
$function$;

CREATE OR REPLACE FUNCTION public.list_dre_indicator_hotels()
 RETURNS TABLE(id text, name text, brand text, active boolean, is_active boolean, cover_url text, brand_logo_url text, opera_property_name text, num_apartments integer, financial_system financial_system, show_in_closing boolean, rh_only boolean, created_at timestamp with time zone)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
 SELECT h.id,h.name,h.brand,h.active,h.is_active,h.cover_url,h.brand_logo_url,h.opera_property_name,h.num_apartments,h.financial_system,h.show_in_closing,h.rh_only,h.created_at
 FROM public.hotels h
 WHERE h.is_active AND NOT h.rh_only AND public.can_read_dre_hotel(auth.uid(), h.id)
 ORDER BY h.name;
$function$;
REVOKE ALL ON FUNCTION public.list_dre_indicator_hotels() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_dre_indicator_hotels() TO authenticated, service_role;