CREATE OR REPLACE FUNCTION public.closing_stage_can_act(_uid uuid, _stage text, _status public.closing_status)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  is_fer boolean := public.has_role(_uid,'fernando') OR lower(coalesce((SELECT email FROM auth.users WHERE id=_uid),'')) = 'fernando.fonseca@falconhoteis.com.br';
  ctrl boolean := public.has_role(_uid,'controladoria') OR public.has_role(_uid,'patronos');
BEGIN
  IF is_fer THEN RETURN _status = 'aguardando_fernando'; END IF;
  IF public.is_master(_uid) THEN RETURN true; END IF;
  IF _stage = 'dre' THEN
    RETURN CASE _status
      WHEN 'aguardando_comentarios' THEN ctrl OR public.has_role(_uid,'gg') OR public.has_role(_uid,'gop')
      WHEN 'aguardando_controladoria' THEN ctrl
      WHEN 'aguardando_gop' THEN public.has_role(_uid,'gop')
      ELSE false END;
  END IF;
  RETURN CASE _status
    WHEN 'aguardando_gg' THEN public.has_role(_uid,'gg')
    WHEN 'aguardando_gop' THEN public.has_role(_uid,'gop')
    ELSE false END;
END $$;

CREATE OR REPLACE FUNCTION public.guard_closing_stage_turn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.status_dre IS DISTINCT FROM OLD.status_dre
     AND OLD.status_dre IN ('aguardando_comentarios','aguardando_controladoria','aguardando_gop','aguardando_fernando')
     AND NOT public.closing_stage_can_act(auth.uid(),'dre',OLD.status_dre) THEN
    RAISE EXCEPTION 'Esta etapa ainda não está com você';
  END IF;
  IF NEW.status_carta IS DISTINCT FROM OLD.status_carta
     AND OLD.status_carta IN ('aguardando_gg','aguardando_gop','aguardando_fernando')
     AND NOT public.closing_stage_can_act(auth.uid(),'carta',OLD.status_carta) THEN
    RAISE EXCEPTION 'Esta etapa ainda não está com você';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_guard_closing_stage_turn BEFORE UPDATE ON public.closings
FOR EACH ROW EXECUTE FUNCTION public.guard_closing_stage_turn();

CREATE TABLE public.dre_view_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_id uuid NOT NULL REFERENCES public.closings(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  user_id uuid NOT NULL,
  first_viewed_at timestamptz NOT NULL DEFAULT now(),
  last_viewed_at timestamptz NOT NULL DEFAULT now(),
  view_count integer NOT NULL DEFAULT 1,
  UNIQUE (closing_id, version_number, user_id)
);
GRANT SELECT ON public.dre_view_log TO authenticated;
GRANT ALL ON public.dre_view_log TO service_role;
ALTER TABLE public.dre_view_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY dre_view_log_select_privileged ON public.dre_view_log FOR SELECT TO authenticated
USING (public.is_master(auth.uid()) OR public.has_role(auth.uid(),'fernando') OR public.has_role(auth.uid(),'controladoria') OR public.has_role(auth.uid(),'patronos') OR public.has_role(auth.uid(),'viewer'));

CREATE OR REPLACE FUNCTION public.log_dre_view(p_closing uuid, p_version integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE h text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT hotel_id INTO h FROM public.closings WHERE id = p_closing;
  IF h IS NULL OR NOT (public.can_read_dre_hotel(auth.uid(),h) OR public.can_view_hotel_data(auth.uid(),h)) THEN
    RAISE EXCEPTION 'Sem acesso a esta DRE';
  END IF;
  INSERT INTO public.dre_view_log(closing_id,version_number,user_id) VALUES (p_closing,p_version,auth.uid())
  ON CONFLICT (closing_id,version_number,user_id) DO UPDATE
    SET view_count = dre_view_log.view_count + CASE WHEN dre_view_log.last_viewed_at < now() - interval '30 minutes' THEN 1 ELSE 0 END,
        last_viewed_at = CASE WHEN dre_view_log.last_viewed_at < now() - interval '30 minutes' THEN now() ELSE dre_view_log.last_viewed_at END;
END $$;
REVOKE ALL ON FUNCTION public.log_dre_view(uuid,integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.log_dre_view(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.closing_stage_can_act(uuid,text,public.closing_status) TO authenticated;