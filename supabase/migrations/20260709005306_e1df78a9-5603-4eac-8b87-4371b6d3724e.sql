-- Tighten comment-attachments storage policies: scope by closing/hotel ownership.
-- Object path convention (see CommentsThread): {closing_id}/{stage}/{filename}
-- The first folder segment is the closing_id.

DROP POLICY IF EXISTS "comment-attachments-authenticated-read" ON storage.objects;
DROP POLICY IF EXISTS "comment-attachments-authenticated-insert" ON storage.objects;
DROP POLICY IF EXISTS "comment-attachments-authenticated-update" ON storage.objects;
DROP POLICY IF EXISTS "comment-attachments-authenticated-delete" ON storage.objects;

CREATE POLICY "comment-attachments-scoped-read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'comment-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.closings c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND public.can_view_hotel_data(auth.uid(), c.hotel_id)
    )
  );

CREATE POLICY "comment-attachments-scoped-insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'comment-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.closings c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

CREATE POLICY "comment-attachments-scoped-update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'comment-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.closings c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  )
  WITH CHECK (
    bucket_id = 'comment-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.closings c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

CREATE POLICY "comment-attachments-scoped-delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'comment-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.closings c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND public.is_hotel_allowed(auth.uid(), c.hotel_id)
    )
  );

CREATE POLICY "comment-attachments-service-role-all" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'comment-attachments')
  WITH CHECK (bucket_id = 'comment-attachments');
