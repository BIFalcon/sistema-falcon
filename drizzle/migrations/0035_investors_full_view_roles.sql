CREATE OR REPLACE FUNCTION public.inv_can_view_full(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.inv_can_edit(_uid)
      OR EXISTS (SELECT 1 FROM public.user_permissions WHERE user_id = _uid AND permission_key = 'view_investor_bank_details');
$$;