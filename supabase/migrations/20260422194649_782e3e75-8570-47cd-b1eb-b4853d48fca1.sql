-- 1) Campos de asset nos hotéis
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS brand_logo_url text;

-- Permitir UPDATE em hotels apenas para processos (além do master que já tem ALL)
DROP POLICY IF EXISTS hotels_update_processos ON public.hotels;
CREATE POLICY "hotels_update_processos"
ON public.hotels FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'processos'))
WITH CHECK (public.has_role(auth.uid(), 'processos'));

-- 2) Tabela system_settings (chave/valor)
CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  value text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_settings_select_any_role ON public.system_settings;
CREATE POLICY "system_settings_select_any_role"
ON public.system_settings FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid()));

DROP POLICY IF EXISTS system_settings_processos_modify ON public.system_settings;
CREATE POLICY "system_settings_processos_modify"
ON public.system_settings FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'processos') OR public.is_master(auth.uid()))
WITH CHECK (public.has_role(auth.uid(), 'processos') OR public.is_master(auth.uid()));

-- 3) Storage policies dos buckets públicos (hotel-assets, system-assets)
-- SELECT já é público pois os buckets são public; precisamos garantir INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS hotel_assets_processos_insert ON storage.objects;
CREATE POLICY "hotel_assets_processos_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'hotel-assets' AND public.has_role(auth.uid(), 'processos'));

DROP POLICY IF EXISTS hotel_assets_processos_update ON storage.objects;
CREATE POLICY "hotel_assets_processos_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'hotel-assets' AND public.has_role(auth.uid(), 'processos'))
WITH CHECK (bucket_id = 'hotel-assets' AND public.has_role(auth.uid(), 'processos'));

DROP POLICY IF EXISTS hotel_assets_processos_delete ON storage.objects;
CREATE POLICY "hotel_assets_processos_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'hotel-assets' AND public.has_role(auth.uid(), 'processos'));

DROP POLICY IF EXISTS system_assets_processos_insert ON storage.objects;
CREATE POLICY "system_assets_processos_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'system-assets' AND public.has_role(auth.uid(), 'processos'));

DROP POLICY IF EXISTS system_assets_processos_update ON storage.objects;
CREATE POLICY "system_assets_processos_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'system-assets' AND public.has_role(auth.uid(), 'processos'))
WITH CHECK (bucket_id = 'system-assets' AND public.has_role(auth.uid(), 'processos'));

DROP POLICY IF EXISTS system_assets_processos_delete ON storage.objects;
CREATE POLICY "system_assets_processos_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'system-assets' AND public.has_role(auth.uid(), 'processos'));