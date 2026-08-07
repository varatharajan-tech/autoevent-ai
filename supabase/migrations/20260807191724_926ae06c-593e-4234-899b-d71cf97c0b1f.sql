ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_event_id_fkey;
ALTER TABLE public.assets ADD CONSTRAINT assets_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.generated_posts DROP CONSTRAINT IF EXISTS generated_posts_event_id_fkey;
ALTER TABLE public.generated_posts ADD CONSTRAINT generated_posts_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.generated_posts DROP CONSTRAINT IF EXISTS generated_posts_source_asset_id_fkey;
ALTER TABLE public.generated_posts ADD CONSTRAINT generated_posts_source_asset_id_fkey FOREIGN KEY (source_asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;

ALTER TABLE public.agent_logs DROP CONSTRAINT IF EXISTS agent_logs_event_id_fkey;
ALTER TABLE public.agent_logs ADD CONSTRAINT agent_logs_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.generated_reels DROP CONSTRAINT IF EXISTS generated_reels_event_id_fkey;
ALTER TABLE public.generated_reels ADD CONSTRAINT generated_reels_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;