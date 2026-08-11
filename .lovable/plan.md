# Switch caption writing to Groq + stronger post content

## What changes

The AI pipeline has two AI steps: **photo scoring** (needs to see the image) and **caption writing** (text only). Groq's text models can't see images, so:

- **Photo scoring** — unchanged, keeps using the current image-capable model.
- **Caption / hashtag / trend writing** — moves to Groq using your API key.
- **Post quality** — the copywriting prompt gets rewritten around stronger hooks and storytelling.

## Content quality upgrade

The caption prompt is rewritten so each post must:

- Open with a scroll-stopping hook (no "Excited to share…", no "What a day"), matched to the platform.
- Tell a micro-story with one concrete, specific detail drawn from the photo analysis (scene, emotion, moment) instead of generic event filler.
- Land on a clear, platform-appropriate close or call to action.
- Ban a list of clichés and hollow phrases outright, and forbid corporate filler.
- Keep the existing per-platform tone, length, audience targeting, variation angles, and duplicate detection — those already work; the new rules stack on top.

A lightweight quality check rejects and regenerates a caption once when it starts with a banned cliché opener, reusing the retry loop already in the pipeline.

## Technical notes

- I'll request your `GROQ_API_KEY` through the secure secret form (never pasted into code).
- `supabase/functions/run-agents/index.ts`: add a second AI caller that posts to `https://api.groq.com/openai/v1/chat/completions` with the Groq key. The Groq API is OpenAI-compatible, so the existing message/JSON-parse shape carries over.
- Caption call switches to a Groq model (`llama-3.3-70b-versatile`, strongest Groq text model for this); photo-scoring call keeps `google/gemini-2.5-flash` through the existing Lovable AI gateway.
- Retry/timeout/fallback behaviour, the 150s edge budget guard, and the "don't retry 429" rule are preserved for the Groq path.
- If Groq fails or the key is missing, the caption step falls back to the existing gateway model rather than producing an empty post.
- Redeploy the edge function and run a real generation on an existing event to confirm captions come back from Groq and read well.

## Not changing

Photo scoring model, database schema, UI, reel studio, upload flow, and security policies.
