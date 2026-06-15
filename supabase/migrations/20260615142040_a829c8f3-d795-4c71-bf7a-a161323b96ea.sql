
-- Marketing audience function: everyone except adm (and unrelated roles)
CREATE OR REPLACE FUNCTION public.is_marketing_audience(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_master(_user_id)
      OR public.has_role(_user_id, 'marketing'::app_role)
      OR public.has_role(_user_id, 'gg'::app_role)
      OR public.has_role(_user_id, 'gop'::app_role)
      OR public.has_role(_user_id, 'controladoria'::app_role)
      OR public.has_role(_user_id, 'patronos'::app_role)
      OR public.has_role(_user_id, 'fernando'::app_role)
      OR public.has_role(_user_id, 'viewer'::app_role)
      OR public.has_role(_user_id, 'ri'::app_role)
      OR public.has_role(_user_id, 'operacoes'::app_role)
      OR public.has_role(_user_id, 'rh'::app_role);
$$;

CREATE OR REPLACE FUNCTION public.can_edit_marketing(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_master(_user_id) OR public.has_role(_user_id, 'marketing'::app_role);
$$;

-- Restrict calendar read to marketing audience (exclude adm)
DROP POLICY IF EXISTS rh_calendar_dates_select ON public.rh_calendar_dates;
CREATE POLICY rh_calendar_dates_select ON public.rh_calendar_dates FOR SELECT TO authenticated
USING (public.is_marketing_audience(auth.uid()));

DROP POLICY IF EXISTS rh_calendar_posts_select ON public.rh_calendar_posts;
CREATE POLICY rh_calendar_posts_select ON public.rh_calendar_posts FOR SELECT TO authenticated
USING (public.is_marketing_audience(auth.uid()));

-- Brand standards table
CREATE TABLE public.marketing_brand_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_brand_assets TO authenticated;
GRANT ALL ON public.marketing_brand_assets TO service_role;

ALTER TABLE public.marketing_brand_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY mba_select ON public.marketing_brand_assets FOR SELECT TO authenticated
USING (public.is_marketing_audience(auth.uid()));

CREATE POLICY mba_insert ON public.marketing_brand_assets FOR INSERT TO authenticated
WITH CHECK (public.can_edit_marketing(auth.uid()) AND created_by = auth.uid());

CREATE POLICY mba_update ON public.marketing_brand_assets FOR UPDATE TO authenticated
USING (public.can_edit_marketing(auth.uid()))
WITH CHECK (public.can_edit_marketing(auth.uid()));

CREATE POLICY mba_delete ON public.marketing_brand_assets FOR DELETE TO authenticated
USING (public.can_edit_marketing(auth.uid()));

CREATE TRIGGER marketing_brand_assets_touch BEFORE UPDATE ON public.marketing_brand_assets
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Storage policies on marketing-assets bucket
CREATE POLICY ma_storage_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'marketing-assets' AND public.is_marketing_audience(auth.uid()));

CREATE POLICY ma_storage_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'marketing-assets' AND public.can_edit_marketing(auth.uid()));

CREATE POLICY ma_storage_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'marketing-assets' AND public.can_edit_marketing(auth.uid()))
WITH CHECK (bucket_id = 'marketing-assets' AND public.can_edit_marketing(auth.uid()));

CREATE POLICY ma_storage_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'marketing-assets' AND public.can_edit_marketing(auth.uid()));
