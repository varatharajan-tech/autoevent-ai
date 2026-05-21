import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Download, Film, Wand2, Image as ImageIcon, Music2 } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { generateReel, REEL_PLATFORMS, type ReelPlatform } from "@/lib/reelEngine";
import { MOODS, type Mood } from "@/lib/reelMusic";

type Asset = { id: string; public_url: string | null; ai_summary: string | null; is_top_pick: boolean; filename: string | null };
type Post = { platform: string; caption: string };

type Props = {
  assets: Asset[];
  posts: Post[];
  eventName: string;
  brandColor: string;
};

const PLATFORM_TO_POST_KEY: Record<ReelPlatform, string> = {
  instagram: "instagram",
  facebook: "facebook",
  twitter: "twitter",
  youtube: "instagram", // borrow IG copy for Shorts
};

function splitCaptions(text: string, n: number): string[] {
  if (!text) return Array(n).fill("");
  // Split on sentence boundaries first
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length >= n) return sentences.slice(0, n);
  // Fallback: split by chunks of ~50 chars
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    if ((cur + " " + w).length > 50 && cur) { out.push(cur); cur = w; }
    else cur = (cur ? cur + " " : "") + w;
  }
  if (cur) out.push(cur);
  while (out.length < n) out.push(out[out.length % Math.max(out.length, 1)] ?? "");
  return out.slice(0, n);
}

export function ReelStudio({ assets, posts, eventName, brandColor }: Props) {
  const eligible = useMemo(() => assets.filter(a => a.public_url), [assets]);
  const initialSelected = useMemo(() => {
    const picks = eligible.filter(a => a.is_top_pick).map(a => a.id);
    return picks.length ? picks.slice(0, 8) : eligible.slice(0, Math.min(6, eligible.length)).map(a => a.id);
  }, [eligible]);

  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [platform, setPlatform] = useState<ReelPlatform>("instagram");
  const [mood, setMood] = useState<Mood>("cinematic");
  const [perSlide, setPerSlide] = useState(3);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [reelUrl, setReelUrl] = useState<string | null>(null);
  const [reelDur, setReelDur] = useState(0);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  // Re-seed selection when assets change and nothing is selected
  useEffect(() => {
    if (selected.length === 0 && initialSelected.length) setSelected(initialSelected);
  }, [initialSelected, selected.length]);

  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const platMeta = REEL_PLATFORMS.find(p => p.id === platform)!;
  const totalDur = Math.min(platMeta.maxDur, selected.length * perSlide);

  const captionSource = useMemo(() => {
    const key = PLATFORM_TO_POST_KEY[platform];
    const p = posts.find(p => p.platform === key);
    return p?.caption ?? "";
  }, [posts, platform]);

  async function onGenerate() {
    if (selected.length < 2) { toast.error("Select at least 2 photos"); return; }
    if (selected.length > 12) { toast.error("Use up to 12 photos for a snappy reel"); return; }
    setBusy(true); setProgress(0); setProgressMsg("Starting…");
    try {
      const orderedAssets = selected
        .map(id => eligible.find(a => a.id === id))
        .filter((a): a is Asset => !!a && !!a.public_url);
      const captions = splitCaptions(captionSource, orderedAssets.length);
      const { blob, durationSec } = await generateReel(
        {
          imageUrls: orderedAssets.map(a => a.public_url!),
          captions,
          headline: eventName,
          mood,
          platform,
          secondsPerSlide: perSlide,
          brandColor,
        },
        (msg, pct) => { setProgressMsg(msg); setProgress(pct); }
      );
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setReelUrl(url);
      setReelDur(durationSec);
      toast.success(`Reel ready — ${durationSec.toFixed(0)}s`);
    } catch (e) {
      console.error("[ReelStudio] generate failed", e);
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      toast.error(`Reel failed: ${msg || "unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  async function onDownload() {
    if (!reelUrl) return;
    const a = document.createElement("a");
    a.href = reelUrl;
    a.download = `${eventName.replace(/\s+/g, "-").toLowerCase()}-${platform}-reel.mp4`;
    a.click();
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border/60 rounded-xl p-6 shadow-soft">
        <div className="flex items-center gap-2 mb-1">
          <Film className="size-5 text-primary" />
          <h3 className="font-display text-2xl">Reel Studio</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Generate a 9:16 cinematic reel from your event photos. Renders in your browser — no upload, no cost.
        </p>

        {/* Controls */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">Platform</label>
            <div className="flex flex-wrap gap-1.5">
              {REEL_PLATFORMS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatform(p.id)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${platform === p.id ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/50"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block flex items-center gap-1">
              <Music2 className="size-3" /> Mood
            </label>
            <div className="flex flex-wrap gap-1.5">
              {MOODS.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMood(m.id)}
                  title={m.description}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${mood === m.id ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/50"}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">Seconds / slide</label>
            <input
              type="range" min={2} max={5} step={0.5}
              value={perSlide}
              onChange={e => setPerSlide(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="text-sm font-mono text-foreground mt-1">{perSlide.toFixed(1)}s</div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">Total length</label>
            <div className="text-2xl font-display">{totalDur.toFixed(0)}s</div>
            <div className="text-xs text-muted-foreground">{selected.length} slide{selected.length === 1 ? "" : "s"} · max {platMeta.maxDur}s</div>
          </div>
        </div>

        {/* Asset picker */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <ImageIcon className="size-3" /> Choose slides ({selected.length}/{eligible.length})
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSelected(eligible.slice(0, 8).map(a => a.id))} className="text-xs text-primary hover:underline">First 8</button>
              <button type="button" onClick={() => setSelected(eligible.filter(a => a.is_top_pick).map(a => a.id))} className="text-xs text-primary hover:underline">Top picks</button>
              <button type="button" onClick={() => setSelected([])} className="text-xs text-muted-foreground hover:underline">Clear</button>
            </div>
          </div>
          {eligible.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Upload photos first.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 max-h-72 overflow-auto p-1">
              {eligible.map(a => {
                const idx = selected.indexOf(a.id);
                const picked = idx !== -1;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggle(a.id)}
                    className={`relative aspect-square rounded-md overflow-hidden border-2 transition ${picked ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-border"}`}
                  >
                    {a.public_url && <img src={a.public_url} alt="" className="size-full object-cover" loading="lazy" />}
                    {picked && (
                      <span className="absolute top-1 left-1 size-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold grid place-items-center">
                        {idx + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Caption preview */}
        {captionSource && (
          <details className="mb-6 text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Preview subtitles (from {platform === "youtube" ? "Instagram" : platform} caption)
            </summary>
            <div className="mt-2 p-3 bg-muted rounded text-xs whitespace-pre-wrap">{captionSource}</div>
          </details>
        )}

        {/* Action */}
        <div className="flex flex-wrap gap-3 items-center">
          <Button onClick={onGenerate} disabled={busy || selected.length < 2} size="lg">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            {busy ? "Generating…" : "Generate Reel"}
          </Button>
          {reelUrl && !busy && (
            <Button onClick={onDownload} variant="outline" size="lg">
              <Download className="size-4" /> Download MP4
            </Button>
          )}
        </div>

        {busy && (
          <div className="mt-4 space-y-2">
            <Progress value={progress} />
            <p className="text-xs text-muted-foreground font-mono">{progressMsg} · {progress}%</p>
          </div>
        )}
      </div>

      {reelUrl && (
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-soft">
          <h4 className="font-display text-lg mb-3">Preview</h4>
          <div className="max-w-xs mx-auto">
            <video src={reelUrl} controls playsInline className="w-full aspect-[9/16] rounded-lg bg-black" />
            <p className="text-xs text-muted-foreground text-center mt-2 font-mono">
              {reelDur.toFixed(0)}s · 1080×1920 · H.264 + AAC
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
