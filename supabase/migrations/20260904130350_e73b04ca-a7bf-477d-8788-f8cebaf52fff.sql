ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS ai_score NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS emotional_energy INTEGER,
  ADD COLUMN IF NOT EXISTS event_relevance INTEGER,
  ADD COLUMN IF NOT EXISTS people_engagement INTEGER,
  ADD COLUMN IF NOT EXISTS composition_quality INTEGER,
  ADD COLUMN IF NOT EXISTS brand_moment BOOLEAN,
  ADD COLUMN IF NOT EXISTS storytelling_value INTEGER,
  ADD COLUMN IF NOT EXISTS ai_scene_label TEXT,
  ADD COLUMN IF NOT EXISTS ai_reject_reason TEXT,
  ADD COLUMN IF NOT EXISTS scoring_method TEXT DEFAULT 'technical';

CREATE INDEX IF NOT EXISTS idx_assets_ai_score ON public.assets(event_id, ai_score DESC);
CREATE INDEX IF NOT EXISTS idx_assets_top_pick ON public.assets(event_id, is_top_pick);