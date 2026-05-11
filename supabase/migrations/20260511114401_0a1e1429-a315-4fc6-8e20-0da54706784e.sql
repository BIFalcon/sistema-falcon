CREATE OR REPLACE FUNCTION public.is_hotel_allowed(_user_id uuid, _hotel_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_master(_user_id)
    OR public.has_role(_user_id, 'controladoria')
    OR public.has_role(_user_id, 'financeiro')
    OR public.has_role(_user_id, 'ri')
    OR public.has_role(_user_id, 'rh')
    OR public.has_role(_user_id, 'operacoes')
    OR public.has_role(_user_id, 'viewer')
    OR EXISTS (
      SELECT 1 FROM public.user_hotels
      WHERE user_id = _user_id AND hotel_id = _hotel_id
    );
$$;