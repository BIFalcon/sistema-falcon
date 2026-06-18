
DROP POLICY IF EXISTS invoices_insert_scoped ON storage.objects;
CREATE POLICY invoices_insert_scoped ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'invoices' AND (
      is_ar_manager(auth.uid())
      OR (
        (has_role(auth.uid(),'gg'::app_role) OR has_role(auth.uid(),'adm'::app_role))
        AND is_hotel_allowed(auth.uid(), split_part(name,'/',1))
      )
    )
  );

DROP POLICY IF EXISTS invoices_update_scoped ON storage.objects;
CREATE POLICY invoices_update_scoped ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'invoices' AND (
      is_ar_manager(auth.uid())
      OR (
        (has_role(auth.uid(),'gg'::app_role) OR has_role(auth.uid(),'adm'::app_role))
        AND is_hotel_allowed(auth.uid(), split_part(name,'/',1))
      )
    )
  )
  WITH CHECK (
    bucket_id = 'invoices' AND (
      is_ar_manager(auth.uid())
      OR (
        (has_role(auth.uid(),'gg'::app_role) OR has_role(auth.uid(),'adm'::app_role))
        AND is_hotel_allowed(auth.uid(), split_part(name,'/',1))
      )
    )
  );
