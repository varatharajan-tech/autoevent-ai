ALTER TABLE public.generated_posts
  ADD COLUMN IF NOT EXISTS scene_description text,
  ADD COLUMN IF NOT EXISTS key_moment text,
  ADD COLUMN IF NOT EXISTS used_vision_ai boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_generated_posts_vision ON public.generated_posts(used_vision_ai);