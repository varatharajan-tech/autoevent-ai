// AutoEvent AI — orchestrator edge function
// Runs Media → Content → Design agents over the event's assets.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// CORS allow-list: only our own app origins
const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/([a-z0-9-]+\.)*lovable\.app$/,
  /^https:\/\/([a-z0-9-]+\.)*lovableproject\.com$/,
];
function corsFor(origin: string | null) {
  const allow = origin && ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin)) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

type Asset = {
  id: string; event_id: string; user_id: string; storage_path: string;
  public_url: string | null; filename: string | null;
};

async function postChat(url: string, key: string, body: Record<string, unknown>, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const text = await r.text();
      const err = new Error(`AI ${r.status}: ${text.slice(0, 200)}`);
      (err as any).status = r.status;
      throw err;
    }
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function callAIOnce(body: Record<string, unknown>, timeoutMs: number) {
  return await postChat(AI_URL, LOVABLE_API_KEY, body, timeoutMs);
}


function isRetryable(err: unknown): boolean {
  const e = err as { name?: string; status?: number; message?: string };
  if (!e) return false;
  if (e.name === "AbortError") return true; // timeout
  // NOTE: 429 is intentionally NOT retried — under free-tier rate caps the limit
  // persists for many seconds and stacking retries blows the 150s edge timeout.
  // We fall back to a templated caption instead.
  if (e.status && (e.status === 408 || e.status === 425 || e.status >= 500)) return true;
  const m = (e.message ?? "").toLowerCase();
  if (/rate.?limit|429/.test(m)) return false;
  return /timeout|timed out|resource|exhaust|overload|temporarily|unavailable|econnreset|network/.test(m);
}

type LogFn = (agent: string, message: string, level?: string) => Promise<void>;

async function callAI(
  body: Record<string, unknown>,
  timeoutMs = 45000,
  retries = 3,
  ctx?: { log?: LogFn; agent?: string; step?: string },
) {
  let delay = 800;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await callAIOnce(body, timeoutMs);
      if (attempt > 0 && ctx?.log) {
        await ctx.log(ctx.agent ?? "ai", `${ctx.step ?? "call"} succeeded after ${attempt + 1} attempt(s)`, "success");
      }
      return result;
    } catch (e) {
      lastErr = e;
      if (attempt === retries || !isRetryable(e)) {
        if (ctx?.log) await ctx.log(ctx.agent ?? "ai", `${ctx.step ?? "call"} failed: ${(e as Error).message}`, "error");
        throw e;
      }
      const jitter = Math.floor(Math.random() * 250);
      const wait = delay + jitter;
      console.warn(`[callAI] attempt ${attempt + 1} failed: ${(e as Error).message}. retrying in ${wait}ms`);
      if (ctx?.log) await ctx.log(ctx.agent ?? "ai", `${ctx.step ?? "call"} retry ${attempt + 1}/${retries} in ${Math.round(wait / 100) / 10}s — ${(e as Error).message.slice(0, 80)}`, "warn");
      await new Promise((r) => setTimeout(r, wait));
      delay *= 2;
    }
  }
  throw lastErr;
}

// Text-only calls (captions/hashtags) go to Groq. Falls back to the Lovable
// gateway model if the Groq key is missing or Groq fails.
async function callText(
  messages: unknown[],
  timeoutMs = 30000,
  retries = 2,
  ctx?: { log?: LogFn; agent?: string; step?: string },
) {
  if (GROQ_API_KEY) {
    let delay = 700;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await postChat(GROQ_URL, GROQ_API_KEY, {
          model: GROQ_MODEL,
          messages,
          temperature: 0.9,
          response_format: { type: "json_object" },
        }, timeoutMs);
      } catch (e) {
        if (attempt === retries || !isRetryable(e)) {
          if (ctx?.log) await ctx.log(ctx.agent ?? "content", `${ctx.step ?? "call"} Groq failed (${(e as Error).message.slice(0, 80)}) — using fallback model`, "warn");
          break;
        }
        await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * 250)));
        delay *= 2;
      }
    }
  }
  return await callAI({ model: "google/gemini-2.5-flash", messages }, timeoutMs, 2, ctx);
}


function parseJsonLoose(text: string): Record<string, unknown> {
  const cleaned = (text ?? "").replace(/```json|```/g, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try { return JSON.parse(m[0]); } catch { return {}; }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const corsHeaders = corsFor(origin);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    console.log("[run-agents] received request");
    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      console.warn("[run-agents] unauthorized");
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const reqBody = await req.json();
    const { event_id } = reqBody;
    const ALL_PLATFORMS = ["instagram", "linkedin", "twitter", "facebook"] as const;
    type Plat = typeof ALL_PLATFORMS[number];
    const requested: Plat[] = Array.isArray(reqBody.platforms) && reqBody.platforms.length
      ? (reqBody.platforms as string[]).filter((p): p is Plat => (ALL_PLATFORMS as readonly string[]).includes(p))
      : [...ALL_PLATFORMS];
    const AUDIENCES = ["general", "students", "professionals", "startups", "corporate"] as const;
    type Audience = typeof AUDIENCES[number];
    const audience: Audience = (AUDIENCES as readonly string[]).includes(reqBody.audience)
      ? (reqBody.audience as Audience) : "general";
    console.log(`[run-agents] event_id=${event_id} user=${user.id} platforms=${requested.join(",")} audience=${audience}`);

    const log = async (agent: string, message: string, level = "info") => {
      console.log(`[${agent}/${level}] ${message}`);
      await admin.from("agent_logs").insert({ event_id, user_id: user.id, agent, level, message });
    };

    const { data: ev } = await admin.from("events").select("*").eq("id", event_id).eq("user_id", user.id).single();
    if (!ev) return new Response(JSON.stringify({ error: "event not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    await admin.from("events").update({ status: "analyzing" }).eq("id", event_id);
    await log("orchestrator", `Starting agentic pipeline for "${ev.name}"`);
    await log("orchestrator", `Platforms requested: ${requested.join(", ")}`);

    const { data: assetsRaw } = await admin.from("assets").select("*").eq("event_id", event_id);
    const allAssets = (assetsRaw ?? []) as Asset[];
    // Cap to avoid OOM in worker — sample evenly across the set
    const MAX_ANALYZE = 15;
    let assets = allAssets;
    if (allAssets.length > MAX_ANALYZE) {
      const step = allAssets.length / MAX_ANALYZE;
      assets = Array.from({ length: MAX_ANALYZE }, (_, i) => allAssets[Math.floor(i * step)]);
    }
    await log("orchestrator", `Loaded ${allAssets.length} asset(s); analyzing ${assets.length}`);

    if (assets.length === 0) {
      await log("orchestrator", "No assets to process — upload photos first", "warn");
      await admin.from("events").update({ status: "draft" }).eq("id", event_id);
      return new Response(JSON.stringify({ posts_created: 0, top_picks: 0, message: "No assets" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ===== MEDIA AGENT — download bytes, send as base64 data URL =====
    const skipScoring = reqBody.replace_only_selected && assets.every(a => (a as any).analyzed);
    if (skipScoring) {
      await log("media", "Reusing existing analysis (per-platform regenerate)", "info");
    } else {
      await log("media", `Analyzing ${assets.length} photo${assets.length > 1 ? "s" : ""}`);

      async function scoreOne(a: Asset) {
        try {
          // Use a fresh signed URL — avoids loading full image bytes into worker memory
          const { data: signed, error: sErr } = await admin.storage.from("event-media").createSignedUrl(a.storage_path, 60 * 60 * 24 * 7);
          if (sErr || !signed?.signedUrl) throw new Error(`signed url failed: ${sErr?.message ?? "none"}`);
          const publicUrl = signed.signedUrl;

          await log("media", `Scoring ${a.filename ?? "photo"} with Gemini…`);
          const resp = await callAI({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "You score event photos for social media. Return ONLY JSON: {\"quality\":0-10,\"has_faces\":bool,\"emotion\":\"joy|focus|crowd|calm|action\",\"scene\":\"short label\",\"summary\":\"one vivid sentence\"}. No markdown." },
              { role: "user", content: [
                { type: "text", text: `Event: ${ev.name}. ${ev.description ?? ""}\nScore this photo for social.` },
                { type: "image_url", image_url: { url: publicUrl } },
              ]},
            ],
          }, 40000, 3, { log, agent: "media", step: `score ${a.filename ?? a.id.slice(0, 6)}` });

          const text = resp.choices?.[0]?.message?.content ?? "{}";
          const parsed = parseJsonLoose(text) as { quality?: number; has_faces?: boolean; emotion?: string; scene?: string; summary?: string };

          await admin.from("assets").update({
            quality_score: typeof parsed.quality === "number" ? parsed.quality : 5,
            has_faces: !!parsed.has_faces,
            emotion: parsed.emotion ?? null,
            scene: parsed.scene ?? null,
            ai_summary: parsed.summary ?? `Moment from ${ev.name}`,
            analyzed: true,
            public_url: null,
          }).eq("id", a.id);
          await log("media", `Scored ${a.filename}: ${parsed.quality ?? "?"}/10`);
        } catch (e) {
          await admin.from("assets").update({
            quality_score: 5,
            ai_summary: `Moment from ${ev.name}`,
            analyzed: true,
            public_url: null,
          }).eq("id", a.id);

          await log("media", `Fallback scored ${a.filename}: ${(e as Error).message}`, "warn");
        }
      }

      // Parallel batches of 3
      const batchSize = 3;
      for (let i = 0; i < assets.length; i += batchSize) {
        await Promise.all(assets.slice(i, i + batchSize).map(scoreOne));
      }
    }

    const { data: scored } = await admin.from("assets").select("*")
      .eq("event_id", event_id).order("quality_score", { ascending: false, nullsFirst: false }).limit(5);
    const topPicks = (scored ?? []) as (Asset & { quality_score: number; ai_summary: string; emotion: string; scene: string })[];
    const topIds = topPicks.map(t => t.id);
    await admin.from("assets").update({ is_top_pick: false }).eq("event_id", event_id);
    if (topIds.length) await admin.from("assets").update({ is_top_pick: true }).in("id", topIds);
    await log("media", `Selected ${topIds.length} top picks`, "success");

    // Clear previous posts for this event so reruns produce a clean set.
    // When `replace_only_selected` is true (per-platform regenerate), only delete the requested platforms.
    if (reqBody.replace_only_selected) {
      await admin.from("generated_posts").delete().eq("event_id", event_id).in("platform", requested);
      await log("orchestrator", `Regenerating only: ${requested.join(", ")}`);
    } else {
      await admin.from("generated_posts").delete().eq("event_id", event_id);
    }

    // ===== CONTENT AGENT — caption + hashtags + intelligence per pick =====
    await admin.from("events").update({ status: "generating", audience }).eq("id", event_id);
    await log("content", `Generating captions, trends & timing (audience: ${audience})`);

    const PLATFORM_META: Record<Plat, { format: string; tone: string; bestTime: string }> = {
      instagram: { format: "1:1", tone: "short, engaging, warm; lots of emojis; 8-12 lowercase hashtags", bestTime: "Weekdays 6–9 PM (local)" },
      linkedin:  { format: "16:9", tone: "professional, story-based, insightful; 2-4 sentences; 3-5 hashtags", bestTime: "Tue–Thu 8–10 AM (local)" },
      twitter:   { format: "16:9", tone: "very short, punchy, viral; under 240 chars; 2-3 hashtags; minimal emojis", bestTime: "Weekdays 12–3 PM (local)" },
      facebook:  { format: "1:1", tone: "friendly, medium-length, conversational; 3-5 sentences; 4-6 hashtags", bestTime: "Wed–Fri 1–4 PM (local)" },
    };

    const AUDIENCE_GUIDE: Record<Audience, string> = {
      general: "Broad audience. Balanced, accessible tone.",
      students: "Students/Gen-Z. Fun, energetic, playful. Use slang sparingly. Emojis welcome.",
      professionals: "Working professionals. Formal, informative, value-driven. Avoid slang.",
      startups: "Founders & operators. Bold, fast, growth-minded. Concrete insights, no fluff.",
      corporate: "Corporate / enterprise. Polished, measured, outcome-focused. Zero slang, minimal emojis.",
    };

    // Self-improvement: learn from past top-performing posts for this user
    const { data: pastTop } = await admin
      .from("generated_posts")
      .select("platform,caption,hashtags,engagement_score")
      .eq("user_id", user.id)
      .not("engagement_score", "is", null)
      .order("engagement_score", { ascending: false })
      .limit(20);
    const learnedByPlatform: Record<string, string[]> = {};
    for (const p of (pastTop ?? [])) {
      const k = p.platform as string;
      (learnedByPlatform[k] ||= []).push(`(${Number(p.engagement_score ?? 0).toFixed(0)}) ${String(p.caption ?? "").slice(0, 160)}`);
    }
    const learnedCount = Object.values(learnedByPlatform).reduce((a, b) => a + b.length, 0);
    if (learnedCount > 0) await log("content", `Learning from ${learnedCount} top past posts`, "info");

    const fallbackPost = (platform: Plat, pick: typeof topPicks[number]) => {
      const base = pick.ai_summary || `A great moment from ${ev.name}`;
      const slug = ev.name.toLowerCase().replace(/\s+/g, "");
      if (platform === "linkedin") return { caption: `${base}\n\nProud to share highlights from ${ev.name}.`, hashtags: ["events", "leadership", "community", slug], trending: ["leadership", "innovation"], predicted_engagement: 55 };
      if (platform === "twitter") return { caption: `${base} — live from ${ev.name} 🔥`, hashtags: ["events", slug], trending: ["trending"], predicted_engagement: 50 };
      if (platform === "facebook") return { caption: `${base}\n\nWhat a day at ${ev.name}! Thanks to everyone who joined us.`, hashtags: ["events", "community", slug], trending: ["community"], predicted_engagement: 50 };
      return { caption: `${base} ✨\n\n${ev.name} — captured.`, hashtags: ["events", "behindthescenes", slug, "stepone", "moments"], trending: ["reels", "trending"], predicted_engagement: 60 };
    };

    // Use top 1-3 picks, cycle across selected platforms
    const usePicks = topPicks.slice(0, Math.min(3, topPicks.length));
    if (usePicks.length === 0) {
      await log("content", "No picks available — skipping content agent", "warn");
    }

    // Variation angles to ensure each post per platform feels distinct
    const VARIATION_ANGLES = [
      {
        name: "cinematic-emotion",
        opener: "Open with a vivid sensory image or feeling (sound, light, motion). Do NOT start with the event name, a question, or a statistic.",
        structure: "Cinematic narrative: scene → emotion → takeaway. 1st person plural ('we'). No bullet lists.",
      },
      {
        name: "bold-insight",
        opener: "Open with a bold one-line statement or contrarian insight. Do NOT start with 'We', a question, or an emoji.",
        structure: "Insight → concrete proof from the photo → short call-to-action. Declarative sentences.",
      },
      {
        name: "question-hook",
        opener: "Open with a direct question to the reader. Do NOT start with 'We', a noun phrase, or a statement.",
        structure: "Question → quick context → invite a reply. Conversational, 2nd person ('you').",
      },
    ];
    const VARIATIONS_PER_PLATFORM = 3;

    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    const firstWords = (s: string, n = 6) => normalize(s).split(" ").slice(0, n).join(" ");
    const isDuplicate = (caption: string, prior: string[]) => {
      const head = firstWords(caption, 6);
      const norm = normalize(caption);
      return prior.some((p) => {
        const pHead = firstWords(p, 6);
        const pNorm = normalize(p);
        if (head && head === pHead) return true;
        // Jaccard token similarity
        const a = new Set(norm.split(" ").filter(Boolean));
        const b = new Set(pNorm.split(" ").filter(Boolean));
        const inter = [...a].filter((x) => b.has(x)).length;
        const uni = new Set([...a, ...b]).size || 1;
        return inter / uni > 0.7;
      });
    };

    const CLICHE_OPENERS = [
      "excited to share", "excited to announce", "thrilled to", "so thrilled",
      "what a day", "what an amazing", "it was an honour", "it was an honor",
      "we are proud", "were proud to", "proud to share", "delighted to",
      "grateful for", "amazing time at", "check out", "last week we",
      "happy to share", "pleased to announce", "unforgettable experience",
    ];
    const hasClicheOpener = (caption: string) => {
      const head = normalize(caption).slice(0, 60);
      return CLICHE_OPENERS.some((c) => head.startsWith(c) || head.includes(c));
    };


let postsCreated = 0;
    await Promise.all(requested.map(async (platform) => {
      const meta = PLATFORM_META[platform];
      const variants = Math.min(VARIATIONS_PER_PLATFORM, Math.max(usePicks.length, 1) === 1 ? 3 : VARIATIONS_PER_PLATFORM);
      const priorCaptions: string[] = [];
      const learned = (learnedByPlatform[platform] ?? []).slice(0, 5);
      const learnedBlock = learned.length
        ? `\n\nLEARN FROM HIGH-PERFORMING PAST POSTS on ${platform} (engagement score in parens). Mirror what works (length, hook style, structure), but do NOT copy verbatim:\n${learned.map((c) => `- ${c}`).join("\n")}`
        : "";
      for (let v = 0; v < variants; v++) {
        const pick = usePicks[v % Math.max(usePicks.length, 1)];
        if (!pick) break;
        const angle = VARIATION_ANGLES[v % VARIATION_ANGLES.length];
        let capJson: { caption: string; hashtags: string[]; trending: string[]; predicted_engagement: number } = fallbackPost(platform, pick);
        let accepted = false;

        for (let attempt = 0; attempt < 2 && !accepted; attempt++) {
          const avoidBlock = priorCaptions.length
            ? `\n\nAVOID DUPLICATION. Previous variations for this platform (do NOT mimic their opening line, sentence structure, or phrasing):\n${priorCaptions.map((c, i) => `(${i + 1}) "${c.slice(0, 220)}"`).join("\n")}\nYour caption MUST start with a clearly different opening word/phrase and use a different structure.`
            : "";
          const retryNote = attempt > 0 ? "\n\nYour previous draft was rejected (too similar to another variation, or it opened with a banned cliché). Rewrite from scratch with a fundamentally different hook and structure." : "";
          const craftRules = `\n\nCRAFT RULES — non-negotiable:\n1. HOOK: the first line must stop the scroll on its own. Make it specific, surprising or emotional. Max ~10 words. It must work even if the reader never taps "more".\n2. STORY: the middle must be a micro-story anchored in ONE concrete, sensory detail taken from the photo analysis below (the scene, the emotion, the moment) — not a generic summary of the event. Show, don't announce.\n3. CLOSE: end with a clear, natural close that fits ${platform} — an invitation, a question, a takeaway line, or a soft CTA. Never end mid-thought.\n4. BANNED OPENERS AND PHRASES (never use, in any form): "Excited to share", "Thrilled to announce", "What a day", "It was an honour", "Last week we", "We are proud to", "Delighted to", "Grateful for", "Amazing time at", "Check out", "Without further ado", "In today's fast-paced world", "game-changer", "unforgettable experience", "truly special".\n5. NO CORPORATE FILLER: no "synergy", "leverage", "ecosystem", "journey", "at the end of the day". Write like a human who was actually there.\n6. Concrete beats abstract. Specific numbers, objects, sounds and reactions beat adjectives.`;
          try {
            await log("content", `Writing ${platform} variation ${v + 1}/${variants} (${angle.name})${attempt ? ` — retry ${attempt}` : ""}…`);
            const cap = await callText([
              { role: "system", content: `You are an elite social copywriter + trend analyst for ${platform}. You write hooks people stop scrolling for.\nTone: ${meta.tone}.\nAudience: ${audience} — ${AUDIENCE_GUIDE[audience]}\nVariation: ${angle.name}.\nOpener rule: ${angle.opener}\nStructure rule: ${angle.structure}\nThis post MUST be clearly distinct from any other variation in opening line, sentence structure, rhythm, and word choice.${craftRules}${avoidBlock}${retryNote}${learnedBlock}\nReturn ONLY JSON: {"caption":"...","hashtags":["..."],"trending":["..."],"predicted_engagement":0-100}.\n- "hashtags": platform-appropriate count (lowercase, no # prefix), tailored to caption + audience. Mix broad reach tags with 2-3 niche ones. No filler tags.\n- "trending": 3-5 currently-trending tags relevant to event topic + ${platform} (lowercase, no #).\n- "predicted_engagement": integer 0-100, your honest estimate of how this post will perform vs typical ${platform} content for ${audience} audience.` },
              { role: "user", content: `Event: ${ev.name}. ${ev.description ?? ""}\nPhoto: ${pick.ai_summary ?? pick.scene ?? "event moment"}. Scene: ${pick.scene ?? "n/a"}. Emotion: ${pick.emotion ?? "n/a"}.\nWrite variation #${v + 1} (${angle.name}) for ${platform}, audience: ${audience}. Lead with the strongest hook you can write for this exact moment.` },
            ], 30000, 2, { log, agent: "content", step: `caption ${platform} v${v + 1}${attempt ? `r${attempt}` : ""}` });

            const parsed = parseJsonLoose(cap.choices?.[0]?.message?.content ?? "") as { caption?: string; hashtags?: string[]; trending?: string[]; predicted_engagement?: number };
            if (parsed.caption) {
              const tags = Array.isArray(parsed.hashtags) ? parsed.hashtags : capJson.hashtags;
              const trending = Array.isArray(parsed.trending) ? parsed.trending : capJson.trending;
              // Merge trending tags into hashtags (deduped)
              const merged = Array.from(new Set([...tags, ...trending].map((h) => String(h).replace(/^#/, "").toLowerCase()).filter(Boolean)));
              const candidate = {
                caption: parsed.caption,
                hashtags: merged,
                trending,
                predicted_engagement: typeof parsed.predicted_engagement === "number" ? Math.max(0, Math.min(100, parsed.predicted_engagement)) : capJson.predicted_engagement,
              };
              if (isDuplicate(candidate.caption, priorCaptions)) {
                await log("content", `Duplicate detected for ${platform} v${v + 1} — regenerating`, "warn");
                capJson = candidate;
                continue;
              }
              if (attempt === 0 && hasClicheOpener(candidate.caption)) {
                await log("content", `Weak/cliché hook for ${platform} v${v + 1} — regenerating`, "warn");
                capJson = candidate;
                continue;
              }

              capJson = candidate;
              accepted = true;
              await log("content", `Caption ${v + 1} accepted for ${platform} (${angle.name}) — predicted ${capJson.predicted_engagement}/100`, "success");
            }
          } catch (e) {
            await log("content", `Caption fallback for ${platform} v${v + 1}: ${(e as Error).message}`, "warn");
            break;
          }
        }
        priorCaptions.push(capJson.caption);

        await log("design", `Composing ${platform} card v${v + 1} (${meta.format})…`);
        const { error: insErr } = await admin.from("generated_posts").insert({
          event_id, user_id: user.id, source_asset_id: pick.id,
          platform, format: meta.format,
          caption: capJson.caption, hashtags: capJson.hashtags,
          image_url: null, storage_path: pick.storage_path, storage_bucket: "event-media",
          audience,
          best_time: meta.bestTime,
          predicted_engagement: capJson.predicted_engagement,
        });
        if (insErr) {
          await log("design", `Insert failed: ${insErr.message}`, "error");
        } else {
          postsCreated++;
          await log("design", `Created ${platform} post v${v + 1} — best time: ${meta.bestTime}`, "success");
        }
      }
    }));

    await admin.from("events").update({
      status: "ready", post_count: postsCreated, top_pick_count: topIds.length, asset_count: assets.length,
    }).eq("id", event_id);
    await log("orchestrator", `Pipeline complete — ${postsCreated} posts ready`, "success");

    return new Response(JSON.stringify({ posts_created: postsCreated, top_picks: topIds.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[run-agents] fatal", e);
    return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
