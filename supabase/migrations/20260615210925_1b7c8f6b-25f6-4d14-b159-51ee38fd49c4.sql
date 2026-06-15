CREATE OR REPLACE FUNCTION public.advance_carta_on_dre_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (
       (NEW.status_dre = 'aguardando_fernando' AND OLD.status_dre IS DISTINCT FROM 'aguardando_fernando')
    OR (NEW.status_dre = 'aprovado'            AND OLD.status_dre IS DISTINCT FROM 'aprovado')
  ) THEN
    IF NEW.hotel_id = 'ibis-budget-recife' THEN
      IF NEW.status_carta = 'nao_iniciado' THEN
        NEW.status_carta := 'nao_aplicavel';
      END IF;
    ELSE
      IF NEW.status_carta = 'nao_iniciado' THEN
        NEW.status_carta := 'aguardando_gg';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

UPDATE public.closings
SET status_carta = CASE
  WHEN hotel_id = 'ibis-budget-recife' THEN 'nao_aplicavel'::closing_status
  ELSE 'aguardando_gg'::closing_status
END
WHERE status_carta = 'nao_iniciado'
  AND status_dre IN ('aguardando_fernando','aprovado');