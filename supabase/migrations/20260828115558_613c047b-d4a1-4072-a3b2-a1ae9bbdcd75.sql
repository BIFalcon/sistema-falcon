CREATE POLICY "conc docs read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'conciliacao-docs' AND (public.can_access_conciliacao(auth.uid()) OR public.can_justify_conciliacao(auth.uid(), split_part(name, '/', 1))));

CREATE POLICY "conc docs insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'conciliacao-docs' AND (public.can_access_conciliacao(auth.uid()) OR public.can_justify_conciliacao(auth.uid(), split_part(name, '/', 1))));

CREATE POLICY "conc docs update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'conciliacao-docs' AND (public.can_access_conciliacao(auth.uid()) OR public.can_justify_conciliacao(auth.uid(), split_part(name, '/', 1))))
WITH CHECK (bucket_id = 'conciliacao-docs' AND (public.can_access_conciliacao(auth.uid()) OR public.can_justify_conciliacao(auth.uid(), split_part(name, '/', 1))));

CREATE POLICY "conc docs delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'conciliacao-docs' AND public.can_access_conciliacao(auth.uid()));