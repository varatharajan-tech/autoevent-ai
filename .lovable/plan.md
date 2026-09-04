# Drawback 2 — Intelligent photo selection with Vision AI scoring

## Phase 1 findings (verified)

1. Selection lives in one file: `supabase/functions/run-agents/index.ts` ("MEDIA AGENT" block, lines ~211–275). There is no separate media/selection agent file.
2. Current scoring already calls a vision model (`google/gemini-2.5-flash`) with a signed image URL and asks for `{quality, has_faces, emotion, scene, summary}`. So: **an AI vision call already exists — YES** — but it collapses everything into one 0–10 `quality` number. There is no Laplacian/Haar/brightness code in the repo; the weakness is the single flat score, not OpenCV.
3. Top picks = the 5 highest `quality_score` rows for the event; `is_top_pick` is cleared then set on those 5.
4. Scores are stored on the `assets` table: `quality_score`, `has_faces`, `emotion`, `scene`, `ai_summary`, `analyzed`, `is_top_pick`. No `ai_score` or per-dimension columns.
5. 5 top picks are marked; the caption agent only uses the top 3.
6. Only 15 photos are analyzed max (even-sampled) to protect worker memory — worth keeping in mind for a 105-photo event.

## What will change

### 1. Database
Add to `assets`: `ai_score` (numeric), `emotional_energy`, `event_relevance`, `people_engagement`, `composition_quality`, `storytelling_value` (ints), `brand_moment` (bool), `ai_scene_label`, `ai_reject_reason` (text), `scoring_method` (text, default `technical`). `is_top_pick` already exists. Plus indexes on `(event_id, ai_score desc)` and `(event_id, is_top_pick)`.

### 2. Scoring engine (edge function)
Replace the single-number prompt with the 6-dimension curator prompt (energy, relevance, people engagement, composition, brand moment, storytelling + scene label + reject flag/reason), given the event name, type and brand as context. Composite score = 0.25 energy + 0.25 storytelling + 0.20 people + 0.15 relevance + 0.15 composition, rounded to one decimal.

Deviation from the brief, deliberate: the image is passed as an existing signed URL through the project's shared AI gateway call (`callAI`), not base64 + a direct Gemini API key. There is no `GEMINI_API_KEY` in this project, and downloading full image bytes into the worker is what the current code already avoids for memory reasons. Same model family, same result, no new secret.

Technical fallback is kept exactly as required: if vision fails for a photo, it falls back to the existing quality score (+0.5 if faces detected) and records `scoring_method = 'technical_fallback'`. The pipeline never stops.

### 3. Selection
Score every analyzed photo, drop rejected ones, sort by `ai_score`, then pick up to 5 with scene-label diversity (max 2 per identical label), backfilling if diversity leaves fewer than 3. Mark those as `is_top_pick`. The existing scoring concurrency (batches of 3) is kept instead of a fixed 800 ms serial delay — it is already rate-safe and much faster for large events; if rate limits appear, it drops to serial with the 800 ms gap.

### 4. Pipeline wiring
The caption agent (Drawback 1 vision captions) keeps receiving exactly these top picks — that connection is unchanged. Agent logs gain per-photo progress ("Scoring photo 4 of 15…"), rejection notes, and a final summary with scored / selected / rejected / vision-scored counts.

### 5. Photo tiles (Top picks + All assets)
Each tile gets a colour-coded score badge (green 8+, yellow 6–7, grey 4–5, red below 4), the AI scene label along the bottom, and a red border with a "Low quality" mark on rejected photos. Clicking a photo opens a breakdown panel: composite score bar plus the five dimension bars, a "brand visible" badge, and how it was scored (Vision AI or technical). Styling uses the app's existing design tokens rather than the raw grey/purple classes in the brief, so it matches the rest of the page.

### 6. Insights
New "Media Intelligence Report" block: photos scored by Vision AI, best moments selected, low-quality filtered, high-energy moments, average photo quality bar, and a brand-visibility note.

## Testing
After deploying, run the agents on a real event and verify the 10 checks: badges on all photos, real scene labels, breakdown panel, top picks genuinely outscoring the rest, rejects excluded, label diversity, agent-log progress, insights report, captions still matching the selected photos, and timing for a 10-photo run. Real numbers reported, no fabricated results.
