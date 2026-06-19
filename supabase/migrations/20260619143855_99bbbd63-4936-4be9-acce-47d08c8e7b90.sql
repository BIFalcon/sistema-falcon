
-- 1) Permite RI ler hotéis (necessário para listar hotéis em Fechamento)
DROP POLICY IF EXISTS hotels_select_any_role ON public.hotels;
CREATE POLICY hotels_select_any_role ON public.hotels
  FOR SELECT
  USING (
    has_any_role(auth.uid())
    AND NOT has_role(auth.uid(), 'marketing'::app_role)
    AND NOT has_role(auth.uid(), 'comercial'::app_role)
  );

-- 2) Permite RI ler versões e linhas de DRE (para baixar/visualizar)
DROP POLICY IF EXISTS dre_versions_select_scoped ON public.dre_versions;
CREATE POLICY dre_versions_select_scoped ON public.dre_versions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM closings c
      WHERE c.id = dre_versions.closing_id
        AND is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

DROP POLICY IF EXISTS dre_versions_select_global ON public.dre_versions;
CREATE POLICY dre_versions_select_global ON public.dre_versions
  FOR SELECT
  USING (has_global_data_access(auth.uid()));

DROP POLICY IF EXISTS dre_parsed_lines_select_scoped ON public.dre_parsed_lines;
CREATE POLICY dre_parsed_lines_select_scoped ON public.dre_parsed_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM closings c
      WHERE c.id = dre_parsed_lines.closing_id
        AND is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

DROP POLICY IF EXISTS dre_parsed_lines_select_global ON public.dre_parsed_lines;
CREATE POLICY dre_parsed_lines_select_global ON public.dre_parsed_lines
  FOR SELECT
  USING (has_global_data_access(auth.uid()));

-- 3) Atualiza funções RPC para permitir RI consultar linhas da DRE
CREATE OR REPLACE FUNCTION public.get_latest_dre_lines(_closing_id uuid)
 RETURNS TABLE(line_label text, line_value numeric, version_number integer, line_type text, line_level integer, line_category text, line_segment text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid()) THEN
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
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT d.closing_id AS cid, MAX(d.version_number) AS v
    FROM public.dre_parsed_lines d
    WHERE d.closing_id = ANY(_closing_ids)
    GROUP BY d.closing_id
  )
  SELECT d.closing_id, d.line_label, d.line_value,
         d.version_number, d.line_type, d.line_level,
         d.line_category, d.line_segment
  FROM public.dre_parsed_lines d
  JOIN latest l ON l.cid = d.closing_id AND l.v = d.version_number;
END;
$function$;
