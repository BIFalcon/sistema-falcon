-- Restrict RLS policies on financial tables to authenticated role only
DROP POLICY IF EXISTS ap_card_receivable_managers ON public.ap_card_receivable;
CREATE POLICY ap_card_receivable_managers ON public.ap_card_receivable
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_master(auth.uid()) OR has_role(auth.uid(), 'controladoria'::app_role) OR has_role(auth.uid(), 'patronos'::app_role))
  WITH CHECK (is_master(auth.uid()) OR has_role(auth.uid(), 'controladoria'::app_role) OR has_role(auth.uid(), 'patronos'::app_role));

DROP POLICY IF EXISTS ap_notification_log_managers ON public.ap_notification_log;
CREATE POLICY ap_notification_log_managers ON public.ap_notification_log
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_master(auth.uid()) OR has_role(auth.uid(), 'controladoria'::app_role) OR has_role(auth.uid(), 'patronos'::app_role))
  WITH CHECK (is_master(auth.uid()) OR has_role(auth.uid(), 'controladoria'::app_role) OR has_role(auth.uid(), 'patronos'::app_role));

DROP POLICY IF EXISTS "Master e controladoria" ON public.conciliation_journal_lines;
CREATE POLICY "Master e controladoria" ON public.conciliation_journal_lines
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_master(auth.uid()) OR has_role(auth.uid(), 'controladoria'::app_role));

DROP POLICY IF EXISTS "Master e controladoria" ON public.conciliation_razao_lines;
CREATE POLICY "Master e controladoria" ON public.conciliation_razao_lines
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_master(auth.uid()) OR has_role(auth.uid(), 'controladoria'::app_role));

DROP POLICY IF EXISTS "Master e controladoria" ON public.conciliation_uploads;
CREATE POLICY "Master e controladoria" ON public.conciliation_uploads
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_master(auth.uid()) OR has_role(auth.uid(), 'controladoria'::app_role));