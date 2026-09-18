CREATE OR REPLACE FUNCTION public.start_carta_on_letter_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _closing_id uuid;
BEGIN
  _closing_id := NEW.closing_id;
  IF _closing_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.closings c
     SET status_carta = 'aguardando_gg'
   WHERE c.id = _closing_id
     AND c.status_carta = 'nao_iniciado'
     AND c.hotel_id <> 'ibis-budget-recife';

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.start_carta_on_letter_activity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_carta_on_letter_activity() TO service_role;

DROP TRIGGER IF EXISTS trg_start_carta_on_letter_version ON public.letter_versions;
CREATE TRIGGER trg_start_carta_on_letter_version
AFTER INSERT ON public.letter_versions
FOR EACH ROW EXECUTE FUNCTION public.start_carta_on_letter_activity();
