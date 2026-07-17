-- Include 'fernando' in the broad-access helpers used by RLS and edge functions.
CREATE OR REPLACE FUNCTION public.has_global_data_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_master(_user_id)
      OR public.has_role(_user_id, 'controladoria')
      OR public.has_role(_user_id, 'patronos')
      OR public.has_role(_user_id, 'ri')
      OR public.has_role(_user_id, 'viewer')
      OR public.has_role(_user_id, 'fernando');
$$;

CREATE OR REPLACE FUNCTION public.is_hotel_allowed(_user_id uuid, _hotel_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_master(_user_id)
    OR public.has_role(_user_id, 'controladoria')
    OR public.has_role(_user_id, 'patronos')
    OR public.has_role(_user_id, 'fernando')
    OR EXISTS (
      SELECT 1 FROM public.user_hotels
      WHERE user_id = _user_id AND hotel_id = _hotel_id
    );
$$;