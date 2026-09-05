# Drawback 3 — Turn the Reel Studio into an intelligently edited reel

## Phase 1 findings (verified in the code)

1. There is no `CinematicReelEngine.js` / `ReelEngine.js` / `mediaAgent.ts`. The whole renderer is one file: `src/lib/reelEngine.ts` (690 lines), exporting `generateReel(input, onProgress)`. Music lives in `src/lib/reelMusic.ts`. The UI is `src/components/ReelStudio.tsx`.
2. It is a function-based engine, not a class. Everything the brief calls `this.drawImageCover`, `this.drawColorGrade`, `this.drawVignetteOverlay`, `this.drawCinematicBars`, `this.drawBrandBadge`, `this.drawGlowAccent`, `this.easeInExpo`, `this.lerp` already exists as module-level functions (`drawCover`, `drawColorGrade`, `drawVignette`, `drawCinematicBars`, `drawBrandBadge`, glow accent, `easeInExpo`, `easeOutExpo`, `easeInOutCubic`, `lerp`) taking `ctx` as the first argument.
3. Where images come from: `ReelStudio` receives the already-loaded `assets` array as a prop from `src/routes/_authenticated/events.$id.tsx`, which does `select("*")` on `assets` — so `ai_score`, `emotional_energy`, `storytelling_value`, `people_engagement`, `composition_quality`, `brand_moment`, `ai_scene_label`, `scoring_method`, `is_top_pick` are all already reaching the component. They are simply not used: `ReelStudio` only reads `id`, `public_url`, `is_top_pick`, `filename`, `kind`.
4. `key_moment` is NOT on `assets` — it is on `generated_posts` (written by the Drawback 1 vision pass) and joins back through `generated_posts.source_asset_id`. The `posts` prop currently passed into `ReelStudio` carries only `platform` and `caption`, so the key-moment text is not available there yet.
5. Current duration logic: one slider, `secondsPerSlide` (default 3), applied to every scene — `const sceneSecs = Math.max(1.5, secondsPerSlide)`. Same for every photo.
6. Current transition logic: a fixed 3-entry array per mood (e.g. cinematic = flash, fade, zoom) cycled by index — `style.transitions[i % style.transitions.length]`. Nothing to do with what is in the photo.
7. Current ordering: upload/selection order. `loaded[0]` is the hook, the last item is the close, the middle is untouched. Scores are ignored.
8. It does already render as a timeline of segments (hook / scene / flash / fade / zoom / closing) at 1080×1920, 30 fps, with beat snapping and a music track — so the narrative-arc upgrade slots into an existing structure rather than replacing the renderer wholesale.

## What will be built

### 1. New edit planner — `src/lib/reelEditPlanner.ts`
Exactly the brief's types (`AssetWithVisionData`, `NarrativePosition`, `TransitionType`, `ScenePlan`, `ReelEditPlan`) and the three functions: `calculateShotDuration`, `selectTransition`, `buildNarrativeArc` (hook = highest emotional energy, close = brand photo else lowest storytelling, climax = highest storytelling, up to 2 build shots, order hook → build → build → climax → close).

Safety rules that go in the planner itself: never crashes with 0, 1 or 2 photos (with 2 it yields hook + close); if no photo has an `ai_score` or a `scoring_method`, it falls back to upload order with a flat 3s per shot and a plain fade, and marks the plan `editStyle: "fallback"`.

### 2. Renderer upgrade — `src/lib/reelEngine.ts`
Add the six transitions (flash, zoom burst, cinematic fade, smooth slide, clean cut, dramatic fade) as new timeline segment kinds plus a dispatcher, the animated `key_moment` pill subtitle (slides up, purple accent bar, auto-truncates), and the four scene renderers (hook: fast 1.35→1.0 zoom reveal with the brand slamming in at 40%; climax: slow zoom-in, luxury grade, pulse glow, subtitle; build: alternating Ken Burns directions with subtitle; close: slow zoom-out, gold brand name centred, event name below, purple glow building).

Two deliberate adaptations, because the engine is functional and frame-driven rather than a class with `await sleep(1000/FPS)`:
- The scene renderers become segment renderers inside the existing frame loop (`ctx` passed in, frame index driven by the recorder clock). Visually identical, but it keeps the existing beat-snapping and the audio track in sync — a `sleep`-driven loop would drift against the music.
- `generateReel` gains a new plan-driven path: `generateReel(input)` where `input` may now carry `editPlan`. The current slide/caption path is kept intact as the fallback for events with no vision data, so nothing that works today breaks.

Video clips stay supported: a clip in a scene slot renders as it does now, just with the planned duration and transition.

### 3. ReelStudio UI — `src/components/ReelStudio.tsx`
- Builds `AssetWithVisionData` from the assets it already has, joins `key_moment` from the posts by `source_asset_id`, and **mints fresh signed URLs at generate time** (never reuses the page's older ones), per the brief's rule 3.
- New "Planned story structure" panel showing every shot with its position chip (hook / build / climax / close), scene label, duration and transition — visible before rendering starts.
- After the render, a "How AI edited this reel" summary: hook scene, climax scene, total duration, shot count.
- Styling uses the app's existing tokens (card/border/muted/primary) rather than the brief's raw grey/purple Tailwind classes, so it matches the rest of the page.
- The manual picker and the seconds-per-slide slider stay, as a manual mode for anyone who wants to override the AI plan.

### 4. Data plumbing
`events.$id.tsx` passes `source_asset_id` and `key_moment` through in the `posts` prop it already gives `ReelStudio`. No database changes are needed — every column required already exists.

## Not touched
Caption generation (Drawback 1) and the scoring agent (Drawback 2) in `supabase/functions/run-agents/index.ts` are left exactly as they are.

## Testing
After the build passes, run the reel on the real event in the preview and check all 10 items: the plan panel appearing before the render, hook = highest energy photo, climax = highest storytelling photo, varied durations, varied transitions, subtitles on build/climax but not hook, the hook's feel, the closing card, captions and scores still intact, and the download playing back. Real numbers only in the final report — no test marked PASS without watching it.
