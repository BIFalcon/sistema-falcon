DROP POLICY novos_negocios_closings_no_write ON public.closings;
CREATE POLICY novos_negocios_closings_no_insert ON public.closings AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(NOT public.has_role(auth.uid(),'novos_negocios'));
CREATE POLICY novos_negocios_closings_no_update ON public.closings AS RESTRICTIVE FOR UPDATE TO authenticated USING(NOT public.has_role(auth.uid(),'novos_negocios')) WITH CHECK(NOT public.has_role(auth.uid(),'novos_negocios'));
CREATE POLICY novos_negocios_closings_no_delete ON public.closings AS RESTRICTIVE FOR DELETE TO authenticated USING(NOT public.has_role(auth.uid(),'novos_negocios'));
CREATE POLICY novos_negocios_dre_versions_no_insert ON public.dre_versions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(NOT public.has_role(auth.uid(),'novos_negocios'));
CREATE POLICY novos_negocios_dre_lines_no_insert ON public.dre_parsed_lines AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(NOT public.has_role(auth.uid(),'novos_negocios'));
CREATE POLICY novos_negocios_comments_no_insert ON public.comments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(NOT public.has_role(auth.uid(),'novos_negocios'));
CREATE POLICY novos_negocios_approvals_no_insert ON public.approvals AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(NOT public.has_role(auth.uid(),'novos_negocios'));