GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_nota_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_opera_entries TO authenticated;
CREATE POLICY nf_nota_update_scoped ON public.nf_nota_entries FOR UPDATE TO authenticated
USING (can_view_hotel_data(auth.uid(), hotel_id) AND (is_master(auth.uid()) OR has_role(auth.uid(),'controladoria') OR has_role(auth.uid(),'patronos')))
WITH CHECK (can_view_hotel_data(auth.uid(), hotel_id) AND (is_master(auth.uid()) OR has_role(auth.uid(),'controladoria') OR has_role(auth.uid(),'patronos')));
CREATE POLICY nf_opera_update_scoped ON public.nf_opera_entries FOR UPDATE TO authenticated
USING (can_view_hotel_data(auth.uid(), hotel_id) AND (is_master(auth.uid()) OR has_role(auth.uid(),'controladoria') OR has_role(auth.uid(),'patronos')))
WITH CHECK (can_view_hotel_data(auth.uid(), hotel_id) AND (is_master(auth.uid()) OR has_role(auth.uid(),'controladoria') OR has_role(auth.uid(),'patronos')));