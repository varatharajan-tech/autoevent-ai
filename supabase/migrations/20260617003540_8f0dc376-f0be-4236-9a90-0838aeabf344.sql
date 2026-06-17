
-- Storage policies for "generated" bucket (becoming private)
DROP POLICY IF EXISTS "generated_public_read" ON storage.objects;
DROP POLICY IF EXISTS "generated_owner_read" ON storage.objects;
DROP POLICY IF EXISTS "generated_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "generated_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "generated_owner_delete" ON storage.objects;

CREATE POLICY "generated_owner_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'generated' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "generated_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'generated' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "generated_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'generated' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'generated' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "generated_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'generated' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Realtime: restrict broadcast/presence messages to channels scoped by the user id
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "realtime_messages_owner_select" ON realtime.messages;
DROP POLICY IF EXISTS "realtime_messages_owner_insert" ON realtime.messages;

CREATE POLICY "realtime_messages_owner_select" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    -- Allow only when the channel topic is prefixed with the user's id, e.g. "<uid>:..."
    split_part(topic, ':', 1) = auth.uid()::text
  );

CREATE POLICY "realtime_messages_owner_insert" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    split_part(topic, ':', 1) = auth.uid()::text
  );
