
DROP POLICY IF EXISTS profiles_select_any_role ON public.profiles;
CREATE POLICY profiles_select_any_role ON public.profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR is_master(auth.uid())
    OR has_role(auth.uid(), 'processos'::app_role)
    OR has_role(auth.uid(), 'fernando'::app_role)
    OR has_role(auth.uid(), 'controladoria'::app_role)
    OR has_role(auth.uid(), 'patronos'::app_role)
    OR has_role(auth.uid(), 'rh'::app_role)
  );
