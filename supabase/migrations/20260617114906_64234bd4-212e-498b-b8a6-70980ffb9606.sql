-- Bloqueia uso dos RPCs SECURITY DEFINER de DRE por papéis que não podem
-- ler dre_parsed_lines via RLS (ex.: 'ri', 'marketing', 'comercial', sem
-- papel atribuído). Mantém o comportamento atual para os demais.

CREATE OR REPLACE FUNCTION public.get_latest_dre_lines(_closing_id uuid)
 RETURNS TABLE(line_label text, line_value numeric, version_number integer, line_type text, line_level integer, line_category text, line_segment text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_any_role(auth.uid())
     OR public.has_role(auth.uid(), 'ri'::public.app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH v AS (
    SELECT MAX(version_number) AS top FROM public.dre_parsed_lines WHERE closing_id = _closing_id
  )
  SELECT d.line_label, d.line_value, d.version_number,
         d.line_type, d.line_level, d.line_category, d.line_segment
  FROM public.dre_parsed_lines d, v
  WHERE d.closing_id = _closing_id AND d.version_number = v.top;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_latest_dre_lines_by_closings(_closing_ids uuid[])
 RETURNS TABLE(closing_id uuid, line_label text, line_value numeric, version_number integer, line_type text, line_level integer, line_category text, line_segment text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_any_role(auth.uid())
     OR public.has_role(auth.uid(), 'ri'::public.app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT closing_id AS cid, MAX(version_number) AS v
    FROM public.dre_parsed_lines
    WHERE closing_id = ANY(_closing_ids)
    GROUP BY closing_id
  )
  SELECT d.closing_id, d.line_label, d.line_value,
         d.version_number, d.line_type, d.line_level,
         d.line_category, d.line_segment
  FROM public.dre_parsed_lines d
  JOIN latest l ON l.cid = d.closing_id AND l.v = d.version_number;
END;
$function$;