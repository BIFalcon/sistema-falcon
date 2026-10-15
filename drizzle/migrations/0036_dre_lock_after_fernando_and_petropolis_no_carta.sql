CREATE OR REPLACE FUNCTION public.advance_carta_on_dre_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF ((NEW.status_dre = 'aguardando_fernando' AND OLD.status_dre IS DISTINCT FROM 'aguardando_fernando')
    OR (NEW.status_dre = 'aprovado' AND OLD.status_dre IS DISTINCT FROM 'aprovado')) THEN
    IF NEW.hotel_id IN ('ibis-budget-recife','ibis-budget-petropolis') THEN
      IF NEW.status_carta IN ('nao_iniciado','aguardando_gg') THEN NEW.status_carta := 'nao_aplicavel'; END IF;
    ELSIF NEW.status_carta = 'nao_iniciado' THEN
      NEW.status_carta := 'aguardando_gg';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.block_dre_upload_when_approved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record;
BEGIN
  SELECT status_dre, is_historical INTO c FROM public.closings WHERE id = NEW.closing_id;
  IF c.status_dre = 'aprovado' AND NOT COALESCE(c.is_historical, false) THEN
    RAISE EXCEPTION 'DRE deste mês já foi aprovada pelo Fernando. Para enviar nova versão, o Fernando ou um Master precisa devolvê-la.';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.block_dre_upload_when_approved() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_block_dre_upload_when_approved ON public.dre_versions;
CREATE TRIGGER trg_block_dre_upload_when_approved BEFORE INSERT ON public.dre_versions
FOR EACH ROW EXECUTE FUNCTION public.block_dre_upload_when_approved();

CREATE OR REPLACE FUNCTION public.guard_dre_unapprove()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF OLD.status_dre = 'aprovado' AND NEW.status_dre IS DISTINCT FROM 'aprovado'
     AND auth.uid() IS NOT NULL
     AND NOT (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'fernando')) THEN
    RAISE EXCEPTION 'Somente Fernando ou Master podem devolver uma DRE já aprovada.';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.guard_dre_unapprove() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_dre_unapprove ON public.closings;
CREATE TRIGGER trg_guard_dre_unapprove BEFORE UPDATE OF status_dre ON public.closings
FOR EACH ROW EXECUTE FUNCTION public.guard_dre_unapprove();

UPDATE public.closings SET status_carta = 'nao_aplicavel'
WHERE hotel_id = 'ibis-budget-petropolis' AND status_carta NOT IN ('aprovado','nao_aplicavel');