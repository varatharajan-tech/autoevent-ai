ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS storage_bucket TEXT NOT NULL DEFAULT 'event-media';
ALTER TABLE public.generated_posts ADD COLUMN IF NOT EXISTS storage_bucket TEXT NOT NULL DEFAULT 'event-media';

UPDATE public.generated_posts
SET storage_path = regexp_replace(image_url, '^.*/event-media/(.+?)(\?.*)?$', '\1')
WHERE image_url LIKE '%/event-media/%'
  AND (storage_path IS NULL OR storage_path = '');