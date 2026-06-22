CREATE OR REPLACE FUNCTION public.mark_envio_sent(_closing_id uuid, _sent boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (
    public.is_master(v_uid)
    OR public.has_role(v_uid, 'ri'::app_role)
  ) THEN
    RAISE EXCEPTION 'not authorized to update envio';
  END IF;
  UPDATE public.closings
     SET status_envio = CASE WHEN _sent THEN 'aprovado'::public.closing_status ELSE 'em_andamento'::public.closing_status END
   WHERE id = _closing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_envio_sent(uuid, boolean) TO authenticated;