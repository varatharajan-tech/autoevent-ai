ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS brand_voice text NOT NULL DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS brand_voice_notes text;

ALTER TABLE public.generated_posts
  ADD COLUMN IF NOT EXISTS brand_voice text;