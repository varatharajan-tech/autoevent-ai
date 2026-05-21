
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS audience text DEFAULT 'general';

ALTER TABLE public.generated_posts ADD COLUMN IF NOT EXISTS audience text;
ALTER TABLE public.generated_posts ADD COLUMN IF NOT EXISTS best_time text;
ALTER TABLE public.generated_posts ADD COLUMN IF NOT EXISTS predicted_engagement numeric;
ALTER TABLE public.generated_posts ADD COLUMN IF NOT EXISTS metrics jsonb NOT NULL DEFAULT '{"likes":0,"shares":0,"reach":0,"comments":0}'::jsonb;
ALTER TABLE public.generated_posts ADD COLUMN IF NOT EXISTS engagement_score numeric;
