# Vision-powered captions: the content agent actually looks at each photo

## Phase 1 + 2 findings (verified in code)

1. Caption generation lives in `supabase/functions/run-agents/index.ts` (single file, 483 lines). The relevant block is the "CONTENT AGENT" section (~lines 286-467) inside the main request handler — there is no separate named function.
2. Current caption prompt: an elite-copywriter system prompt with tone, audience guide, variation angle, craft rules, banned-cliché list, duplicate-avoidance block and learned past posts. The user message only carries text: event name, description, and the *text* fields saved earlier by the media agent (`ai_summary`, `scene`, `emotion`).
3. Does it send image data to the caption model? **NO.** Only the media/scoring agent sees pixels (`image_url` with a signed URL, `google/gemini-2.5-flash`); the caption step is text-only.
4. Models today: scoring = `google/gemini-2.5-flash` via the Lovable AI gateway; captions = Groq `llama-3.3-70b-versatile` (text-only, cannot see images) with a gateway text fallback.
5. Image access: `assets.storage_path` + `assets.storage_bucket` (default `event-media`), private bucket. The function holds a service-role client and already mints signed URLs (`createSignedUrl`, 7 days).
6. Images per event: all assets are scored (capped at 15, sampled evenly), the top 5 by quality become top picks, and captions currently use only the **top 3** picks, cycling them across platforms/variations.

Answer to Q2 (which access option): **Option B — signed URL** is best. The bucket is private but service role can sign, the model fetches the URL directly, and no image bytes are loaded into the worker (base64 of a 1920px photo routinely OOMs/slows the edge worker and inflates the request). Base64 stays as a secondary fallback only if a signed URL fetch fails.

## Model choice — important

There is no OpenAI API key in this project, so literal `gpt-4o` calls to `api.openai.com` would fail. The plan uses the built-in AI gateway's vision-capable model for the new vision step (no key to manage, no extra billing setup):

- Vision caption model: `google/gemini-3.7-flash` (image input, strong writing, fast).
- If you'd rather use an OpenAI model, `openai/gpt-5.4` on the same gateway also accepts images — one-line change. Bringing your own OpenAI key for exact `gpt-4o` is possible too; say so and I'll request the key securely.

Groq stays only as the text-only fallback path when vision fails.

## What changes

### Edge function (`run-agents/index.ts`)
- New `visionCaptionForPick(pick, platform, angle, ...)` step: signs the pick's storage path and sends `[{type:"text"}, {type:"image_url"}]` to the vision model, asking for JSON with `scene_description`, `key_moment`, `caption`, `hashtags`, `trending`, `predicted_engagement`.
- Prompt instructs: describe what is actually visible, anchor the caption in a concrete visible detail, no generic filler. All existing rules (platform tone, audience guide, variation angles, banned clichés, duplicate detection, retry-once) are preserved and stack on top.
- Per-photo vision pre-pass: each of the top picks is analysed once (`scene_description` + `key_moment` + visible details) and that analysis is reused across all platform/variation captions for that photo — one vision call per photo instead of one per post, which keeps us inside the 150s edge budget.
- Cap at 5 photos with vision (matching the existing top-picks cap), with a small delay between vision calls.
- Fallback chain kept intact: vision → existing text-only Groq caption (context mode) → templated fallback. Nothing can produce an empty post.
- Every step logged to `agent_logs`: "Analysing photo 1 of 5 with vision AI…", "Photo 1: <key moment>", plus a closing summary of vision vs context counts. Raw API errors stay in console logs only.
- Posts are saved with the new fields alongside the existing ones.

### Database migration
Add to `generated_posts`: `scene_description text`, `key_moment text`, `used_vision_ai boolean default false`, and an index on `used_vision_ai`.

Not adding `instagram_caption` / `linkedin_caption` / `twitter_caption` columns: this app already stores **one row per platform per variation** (`platform`, `caption`, `hashtags`), so per-platform columns would duplicate the existing model and break the current posts UI. Platform-specific captions keep working exactly as today.

### Frontend (`src/routes/_authenticated/events.$id.tsx`)
- Each post card gets a "Vision AI" / "Context mode" badge.
- A "What AI saw in this photo" block showing `scene_description`, and a quoted `key_moment` line under the image — styled with the app's existing design tokens, not hardcoded amber/purple utility colours.
- Insights tab gets a "Vision AI analysis" card: X of Y posts written from photo analysis, with a progress bar.

## Verification
Run the pipeline on a real event with photos and check, from live data: badges render, `scene_description` and `key_moment` are non-empty and describe the actual photo, captions reference something visible, platform tone/length differences hold, agent log shows per-photo vision steps, and a deliberately broken storage path falls back to context mode without crashing. Then a before/after caption comparison using real output from the same event (old caption text is still readable from the current posts before the rerun).
