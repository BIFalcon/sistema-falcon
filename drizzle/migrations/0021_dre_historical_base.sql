ALTER TABLE public.closings ADD COLUMN IF NOT EXISTS is_historical boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.closings.is_historical IS 'Fechamento criado pela importacao unica da base historica; nao entra no fluxo de aprovacao nem dispara avisos.';

CREATE TABLE public.dre_entity_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  entity text NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL,
  line_label text NOT NULL,
  panel_group text,
  line_value numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.dre_entity_history TO authenticated;
GRANT ALL ON public.dre_entity_history TO service_role;
ALTER TABLE public.dre_entity_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dre_entity_history_read" ON public.dre_entity_history FOR SELECT TO authenticated
  USING (public.can_read_dre_hotel(auth.uid(), hotel_id));
CREATE INDEX dre_entity_history_hotel_idx ON public.dre_entity_history(hotel_id, year, month);

CREATE OR REPLACE FUNCTION public.notify_on_dre_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_closing public.closings%ROWTYPE;
  v_hotel public.hotels%ROWTYPE;
  v_recipients jsonb;
  v_link text;
  v_period text;
  v_is_first boolean;
  v_event public.notification_event;
  v_subject text;
  v_body text;
  v_fin_recipients jsonb;
  v_gg jsonb;
  v_gop jsonb;
BEGIN
  SELECT * INTO v_closing FROM public.closings WHERE id = NEW.closing_id;
  IF COALESCE(v_closing.is_historical,false) THEN RETURN NEW; END IF;
  SELECT * INTO v_hotel FROM public.hotels WHERE id = v_closing.hotel_id;
  v_period := public.month_pt(v_closing.month) || '/' || v_closing.year;
  v_link := '/fechamento/dre?closing=' || v_closing.id::text;
  v_is_first := (NEW.version_number = 1);
  v_event := CASE WHEN v_is_first THEN 'dre_first_preview' ELSE 'dre_new_preview' END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'gg')), '[]'::jsonb)
    INTO v_gg FROM public.users_with_role_for_hotel('gg', v_closing.hotel_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'gop')), '[]'::jsonb)
    INTO v_gop FROM public.users_with_role_for_hotel('gop', v_closing.hotel_id);
  v_recipients := v_gg || v_gop;

  v_subject := CASE WHEN v_is_first
    THEN '[' || v_hotel.name || '] 1ª prévia da DRE de ' || v_period || ' disponível'
    ELSE '[' || v_hotel.name || '] Nova prévia (v' || NEW.version_number || ') da DRE de ' || v_period
  END;
  v_body := 'A Controladoria postou a ' || (CASE WHEN v_is_first THEN '1ª prévia' ELSE 'versão v' || NEW.version_number END) ||
    ' da DRE de **' || v_hotel.name || '** referente a **' || v_period || '**.' || E'\n\n' ||
    'Você pode comentar, aprovar ou devolver. SLA: **48 horas**.' || E'\n\n' ||
    '[Abrir DRE no sistema](' || v_link || ')';

  PERFORM public.enqueue_workflow_notification(v_event, v_closing.id, v_closing.hotel_id, v_recipients, v_subject, v_body, v_link,
    jsonb_build_object('version', NEW.version_number, 'sla_hours', 48));

  IF v_is_first THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'role', 'patronos')), '[]'::jsonb)
      INTO v_fin_recipients FROM public.users_with_role_global('patronos');
    PERFORM public.enqueue_workflow_notification('dre_first_preview', v_closing.id, v_closing.hotel_id, v_fin_recipients,
      '[' || v_hotel.name || '] Estimativa de distribuição — ' || v_period,
      'A 1ª prévia da DRE de **' || v_hotel.name || '** (' || v_period || ') foi postada. ' ||
      'Acesse o sistema para visualizar a **previsão estimada de distribuição**.' || E'\n\n' ||
      '[Visualizar estimativa](' || v_link || ')',
      v_link, jsonb_build_object('version', NEW.version_number, 'audience', 'patronos'));
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_dre_history(_hotel_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_uid uuid := auth.uid(); v_lines jsonb; v_ent jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.can_read_dre_hotel(v_uid, _hotel_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  WITH latest AS (
    SELECT DISTINCT ON (c.year) c.year, v.closing_id, v.version_number
    FROM public.dre_versions v JOIN public.closings c ON c.id = v.closing_id
    WHERE c.hotel_id = _hotel_id
    ORDER BY c.year, v.created_at DESC
  ), l AS (
    SELECT la.year, (m[1])::int AS month, m[2] AS label, d.line_value AS value
    FROM latest la
    JOIN public.dre_parsed_lines d ON d.closing_id = la.closing_id AND d.version_number = la.version_number
    CROSS JOIN LATERAL regexp_match(d.line_label, '^\[cline_(\d+)\]\s(.+)$') m
    WHERE d.line_label LIKE '[cline_%' AND d.line_value IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_array(year, month, label, value)), '[]'::jsonb) INTO v_lines FROM l;
  SELECT COALESCE(jsonb_agg(jsonb_build_array(entity, year, month, line_label, panel_group, line_value)), '[]'::jsonb)
    INTO v_ent FROM public.dre_entity_history WHERE hotel_id = _hotel_id;
  RETURN jsonb_build_object('lines', v_lines, 'entities', v_ent);
END $f$;
REVOKE ALL ON FUNCTION public.get_dre_history(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dre_history(text) TO authenticated;