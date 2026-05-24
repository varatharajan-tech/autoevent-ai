
CREATE TABLE public.generated_reels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  user_id uuid NOT NULL,
  storage_path text NOT NULL,
  public_url text,
  platform text NOT NULL,
  mood text NOT NULL,
  duration_sec numeric NOT NULL DEFAULT 0,
  mime_type text NOT NULL DEFAULT 'video/webm',
  file_size integer NOT NULL DEFAULT 0,
  slide_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.generated_reels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own reels all" ON public.generated_reels
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_generated_reels_event ON public.generated_reels(event_id, created_at DESC);
