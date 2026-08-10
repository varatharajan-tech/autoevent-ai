DROP POLICY IF EXISTS "generated public read by path" ON storage.objects;
DROP POLICY IF EXISTS "generated own delete" ON storage.objects;
DROP POLICY IF EXISTS "generated own write" ON storage.objects;

DROP POLICY IF EXISTS "event-media own update" ON storage.objects;
CREATE POLICY "event-media own update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'event-media' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'event-media' AND (auth.uid())::text = (storage.foldername(name))[1]);