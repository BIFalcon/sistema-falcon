-- Fecha o bypass do portão de aprovação para o papel 'ri' nas DREs.
-- Políticas RLS são combinadas com OR; as políticas amplas (scoped/global)
-- davam ao 'ri' acesso a DREs não aprovadas, anulando a política
-- dre_versions_select_ri_approved. Espelha o padrão já usado nas cartas.

DROP POLICY IF EXISTS dre_versions_select_scoped ON public.dre_versions;
CREATE POLICY dre_versions_select_scoped
ON public.dre_versions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id = dre_versions.closing_id
      AND public.can_view_hotel_data(auth.uid(), c.hotel_id)
      AND (
        public.is_master(auth.uid())
        OR NOT public.has_role(auth.uid(), 'ri'::app_role)
        OR c.status_dre = 'aprovado'::closing_status
      )
  )
);

DROP POLICY IF EXISTS dre_versions_select_global ON public.dre_versions;
CREATE POLICY dre_versions_select_global
ON public.dre_versions
FOR SELECT
TO authenticated
USING (
  public.has_global_data_access(auth.uid())
  AND (
    public.is_master(auth.uid())
    OR NOT public.has_role(auth.uid(), 'ri'::app_role)
  )
);

DROP POLICY IF EXISTS dre_parsed_lines_select_scoped ON public.dre_parsed_lines;
CREATE POLICY dre_parsed_lines_select_scoped
ON public.dre_parsed_lines
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id = dre_parsed_lines.closing_id
      AND public.can_view_hotel_data(auth.uid(), c.hotel_id)
      AND (
        public.is_master(auth.uid())
        OR NOT public.has_role(auth.uid(), 'ri'::app_role)
        OR c.status_dre = 'aprovado'::closing_status
      )
  )
);

DROP POLICY IF EXISTS dre_parsed_lines_select_global ON public.dre_parsed_lines;
CREATE POLICY dre_parsed_lines_select_global
ON public.dre_parsed_lines
FOR SELECT
TO authenticated
USING (
  public.has_global_data_access(auth.uid())
  AND (
    public.is_master(auth.uid())
    OR NOT public.has_role(auth.uid(), 'ri'::app_role)
  )
);

-- Paridade com dre_versions: 'ri' vê linhas extraídas de DREs aprovadas.
DROP POLICY IF EXISTS dre_parsed_lines_select_ri_approved ON public.dre_parsed_lines;
CREATE POLICY dre_parsed_lines_select_ri_approved
ON public.dre_parsed_lines
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'ri'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.closings c
    WHERE c.id = dre_parsed_lines.closing_id
      AND c.status_dre = 'aprovado'::closing_status
  )
);