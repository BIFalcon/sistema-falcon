GRANT SELECT ON public.email_send_log TO authenticated;

CREATE POLICY "Masters can read email send log"
ON public.email_send_log
FOR SELECT
TO authenticated
USING (public.is_master(auth.uid()) OR public.has_role(auth.uid(), 'processos'::app_role));