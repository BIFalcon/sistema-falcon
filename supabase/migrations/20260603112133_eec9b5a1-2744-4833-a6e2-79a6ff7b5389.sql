-- Fix 1: Restrict is_hotel_allowed broad bypass — remove rh and operacoes from global bypass.
CREATE OR REPLACE FUNCTION public.is_hotel_allowed(_user_id uuid, _hotel_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.is_master(_user_id)
    OR public.has_role(_user_id, 'controladoria')
    OR public.has_role(_user_id, 'financeiro')
    OR public.has_role(_user_id, 'ri')
    OR public.has_role(_user_id, 'viewer')
    OR EXISTS (
      SELECT 1 FROM public.user_hotels
      WHERE user_id = _user_id AND hotel_id = _hotel_id
    );
$function$;

-- Fix 2: Restrict rh-photos write policies to RH content editors.
DROP POLICY IF EXISTS "rh-photos-auth-upload" ON storage.objects;
DROP POLICY IF EXISTS "rh-photos-auth-update" ON storage.objects;

CREATE POLICY "rh-photos-editors-upload"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'rh-photos' AND public.can_edit_rh_content(auth.uid()));

CREATE POLICY "rh-photos-editors-update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'rh-photos' AND public.can_edit_rh_content(auth.uid()))
WITH CHECK (bucket_id = 'rh-photos' AND public.can_edit_rh_content(auth.uid()));

CREATE POLICY "rh-photos-editors-delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'rh-photos' AND public.can_edit_rh_content(auth.uid()));