CREATE OR REPLACE FUNCTION public.can_read_dre_hotel(_user_id uuid, _hotel_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
 SELECT public.has_global_data_access(_user_id)
 OR public.has_role(_user_id, 'fernando'::public.app_role)
 OR public.has_role(_user_id, 'novos_negocios'::public.app_role)
 OR public.is_hotel_allowed(_user_id, _hotel_id);
$function$;

CREATE OR REPLACE FUNCTION public.list_accessible_hotels()
RETURNS TABLE(id text, name text, brand text, active boolean, is_active boolean, cover_url text, brand_logo_url text, opera_property_name text, num_apartments integer, financial_system public.financial_system, show_in_closing boolean, rh_only boolean, created_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
 SELECT h.id,h.name,h.brand,h.active,h.is_active,h.cover_url,h.brand_logo_url,h.opera_property_name,h.num_apartments,h.financial_system,h.show_in_closing,h.rh_only,h.created_at
 FROM public.hotels h WHERE h.is_active AND public.has_any_role(auth.uid())
 AND NOT public.has_role(auth.uid(),'marketing') AND NOT public.has_role(auth.uid(),'comercial')
 AND (public.can_view_hotel_data(auth.uid(),h.id) OR (public.has_role(auth.uid(),'novos_negocios') AND NOT h.rh_only))
 ORDER BY h.name;
$function$;

CREATE POLICY novos_negocios_closings_read ON public.closings FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'novos_negocios'));
CREATE POLICY novos_negocios_dre_versions_read ON public.dre_versions FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'novos_negocios'));
CREATE POLICY novos_negocios_dre_lines_read ON public.dre_parsed_lines FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'novos_negocios'));
CREATE POLICY novos_negocios_dre_cache_read ON public.consolidado_resultados_cache FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'novos_negocios'));
CREATE POLICY novos_negocios_dre_files_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='closings' AND public.has_role(auth.uid(),'novos_negocios') AND EXISTS(SELECT 1 FROM public.dre_versions v WHERE v.file_url=objects.name));
ALTER POLICY dre_download_log_insert_self ON public.dre_download_log WITH CHECK(user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.closings c WHERE c.id=dre_download_log.closing_id AND public.can_read_dre_hotel(auth.uid(),c.hotel_id)));

CREATE POLICY novos_negocios_closings_no_write ON public.closings AS RESTRICTIVE FOR ALL TO authenticated USING(NOT public.has_role(auth.uid(),'novos_negocios') OR current_setting('request.method',true)='GET') WITH CHECK(NOT public.has_role(auth.uid(),'novos_negocios'));
COMMENT ON FUNCTION public.can_read_dre_hotel(uuid,text) IS 'DRE-specific read scope, including Novos Negocios across hotels; do not extend general/global hotel access for this role.';