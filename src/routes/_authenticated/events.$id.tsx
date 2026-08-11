import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Upload, Sparkles, Image as ImageIcon, Star, Download, Loader2, CheckCircle2, AlertCircle, Instagram, Linkedin, Twitter, Facebook, Pencil, Save, X, RefreshCw, Clock, TrendingUp, Heart, Share2, Eye, MessageCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DeleteEventDialog } from "@/components/DeleteEventDialog";

import JSZip from "jszip";
import { renderDesignedPost, formatForPlatform, type DesignFormat } from "@/lib/designTemplate";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { ReelStudio } from "@/components/ReelStudio";
import { extractStoragePath, getSignedUrls } from "@/lib/storage";


const PLATFORMS = [
  { id: "instagram", label: "Instagram", Icon: Instagram },
  { id: "linkedin", label: "LinkedIn", Icon: Linkedin },
  { id: "twitter", label: "Twitter / X", Icon: Twitter },
  { id: "facebook", label: "Facebook", Icon: Facebook },
] as const;
type PlatformId = typeof PLATFORMS[number]["id"];

export const Route = createFileRoute("/_authenticated/events/$id")({ component: EventDetail });

type Event = { id: string; name: string; description: string | null; status: string; brand_color: string; user_id: string; audience?: string | null; brand_voice?: string | null; brand_voice_notes?: string | null };
type Asset = { id: string; storage_path: string; public_url: string | null; quality_score: number | null; emotion: string | null; scene: string | null; ai_summary: string | null; is_top_pick: boolean; analyzed: boolean; filename: string | null; kind: string };
type Metrics = { likes: number; shares: number; reach: number; comments: number };
type Post = { id: string; platform: string; format: string; caption: string; hashtags: string[] | null; image_url: string | null; storage_path?: string | null; audience?: string | null; best_time?: string | null; predicted_engagement?: number | null; metrics?: Metrics | null; engagement_score?: number | null };
type Log = { id: string; agent: string; level: string; message: string; created_at: string };
type PendingUpload = { id: string; name: string; previewUrl: string; status: "queued" | "uploading" | "processing" | "done" | "error"; progress: number; error?: string };

const AUDIENCES = [
  { id: "general", label: "General" },
  { id: "students", label: "Students" },
  { id: "professionals", label: "Professionals" },
  { id: "startups", label: "Startups" },
  { id: "corporate", label: "Corporate" },
] as const;
type AudienceId = typeof AUDIENCES[number]["id"];

const BRAND_VOICES = [
  { id: "balanced", label: "Balanced", hint: "Clear, human, confident" },
  { id: "bold", label: "Bold", hint: "Punchy, high-conviction" },
  { id: "warm", label: "Warm", hint: "People-first, sincere" },
  { id: "playful", label: "Playful", hint: "Witty and light" },
  { id: "premium", label: "Premium", hint: "Restrained, elegant" },
  { id: "expert", label: "Expert", hint: "Analytical, credible" },
] as const;
type BrandVoiceId = typeof BRAND_VOICES[number]["id"];

const MAX_DIM = 1920;
const COMPRESS_THRESHOLD = 300 * 1024; // skip files already under 300KB
const VIDEO_WARN_BYTES = 100 * 1024 * 1024; // warn for videos > 100MB

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  if (file.size < COMPRESS_THRESHOLD) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob: Blob | null = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.8));
    bitmap.close?.();
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|webp|heic|heif)$/i, ".jpg"), { type: "image/jpeg" });
  } catch { return file; }
}

// XHR PUT to a Supabase signed upload URL so we get real upload.onprogress events.
function uploadWithProgress(signedUrl: string, file: File | Blob, contentType: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onabort = () => reject(new Error("Aborted"));
    xhr.send(file);
  });
}

function EventDetail() {
  const { id } = Route.useParams();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [ev, setEv] = useState<Event | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const [drag, setDrag] = useState(false);
  const [selected, setSelected] = useState<PlatformId[]>(["instagram", "linkedin", "twitter", "facebook"]);
  const [audience, setAudience] = useState<AudienceId>("general");
  const [brandVoice, setBrandVoice] = useState<BrandVoiceId>("balanced");
  const [voiceNotes, setVoiceNotes] = useState("");
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const togglePlatform = (id: PlatformId) =>
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  // Auth guard handled by _authenticated layout

  const [notFound, setNotFound] = useState(false);

  const loadAll = useCallback(async () => {
    const [{ data: e, error: evErr }, { data: a }, { data: p }, { data: l }] = await Promise.all([
      supabase.from("events").select("*").eq("id", id).maybeSingle(),
      supabase.from("assets").select("*").eq("event_id", id).order("quality_score", { ascending: false, nullsFirst: false }),
      supabase.from("generated_posts").select("*").eq("event_id", id).order("created_at", { ascending: false }),
      supabase.from("agent_logs").select("*").eq("event_id", id).order("created_at", { ascending: true }),
    ]);
    if (evErr || !e) { setNotFound(true); return; }
    setNotFound(false);
    setEv(e as Event | null);
    if (e && (e as Event).audience) setAudience(((e as Event).audience as AudienceId) ?? "general");

    // Mint fresh signed URLs from the permanent storage paths on every load,
    // so nothing ever depends on a stored (expiring) URL.
    const rawAssets = (a ?? []) as Asset[];
    const rawPosts = (p ?? []) as Post[];
    const paths = Array.from(new Set([
      ...rawAssets.map(x => x.storage_path).filter(Boolean),
      ...rawPosts.map(x => x.storage_path || extractStoragePath(x.image_url, "event-media")).filter(Boolean),
    ]));
    const signed = await getSignedUrls("event-media", paths);

    setAssets(rawAssets.map(x => ({ ...x, public_url: signed[x.storage_path] ?? null })));
    setPosts(rawPosts.map(x => {
      const path = x.storage_path || extractStoragePath(x.image_url, "event-media");
      return { ...x, image_url: signed[path] ?? null };
    }));
    setLogs((l ?? []) as Log[]);
  }, [id]);


  useEffect(() => {
    if (!user) return;
    loadAll();
    const ch = supabase.channel(`ev-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_logs", filter: `event_id=eq.${id}` }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "assets", filter: `event_id=eq.${id}` }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "generated_posts", filter: `event_id=eq.${id}` }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "events", filter: `id=eq.${id}` }, loadAll)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // Stable user id only — the User object identity changes on every auth
    // event, which previously re-ran this effect and tripled the mount queries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, id, loadAll]);

  async function handleFiles(files: FileList | null) {
    if (!files || !user || !ev) return;
    const list = Array.from(files).filter(f => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (list.length === 0) return;

    // F8 — warn about large videos before queuing
    const bigVideos = list.filter(f => f.type.startsWith("video/") && f.size > VIDEO_WARN_BYTES);
    if (bigVideos.length > 0) {
      const names = bigVideos.map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(0)}MB)`).join(", ");
      const ok = window.confirm(`Large video file${bigVideos.length > 1 ? "s" : ""}: ${names}\n\nThis may take a while to upload. Continue?`);
      if (!ok) return;
    }

    // F4 — instant previews; F3 — initial state Queued, with progress
    const items: (PendingUpload & { file: File })[] = list.map(file => ({
      id: crypto.randomUUID(),
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      status: "queued",
      progress: 0,
      file,
    }));
    setPending(prev => [...items.map(({ file: _f, ...rest }) => rest), ...prev]);
    setUploading(true);

    type UploadResult = { path: string; isVideo: boolean; filename: string };
    const completed: UploadResult[] = [];

    const CONCURRENCY = 4;
    let cursor = 0;

    const worker = async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        try {
          const isVideo = item.file.type.startsWith("video/");

          // F3 — Processing state during compression
          setPending(prev => prev.map(p => p.id === item.id ? { ...p, status: "processing" } : p));
          const prepared = isVideo ? item.file : await compressImage(item.file);

          const path = `${user.id}/${ev.id}/${crypto.randomUUID()}-${prepared.name}`;

          // F3 — real per-file progress via XHR PUT to a signed upload URL
          setPending(prev => prev.map(p => p.id === item.id ? { ...p, status: "uploading", progress: 0 } : p));
          const { data: signedUp, error: signErr } = await supabase.storage
            .from("event-media").createSignedUploadUrl(path);
          if (signErr || !signedUp) throw signErr ?? new Error("Could not get upload URL");

          await uploadWithProgress(signedUp.signedUrl, prepared, prepared.type, (pct) => {
            setPending(prev => prev.map(p => p.id === item.id ? { ...p, progress: pct } : p));
          });

          completed.push({ path, isVideo, filename: item.file.name });


          setPending(prev => prev.map(p => p.id === item.id ? { ...p, status: "done", progress: 100 } : p));
          setTimeout(() => {
            setPending(prev => prev.filter(p => p.id !== item.id));
            URL.revokeObjectURL(item.previewUrl);
          }, 800);
        } catch (err: unknown) {
          console.error("[upload] failed", item.file.name, err);
          setPending(prev => prev.map(p => p.id === item.id ? { ...p, status: "error", error: "Upload failed" } : p));
          toast.error(`${item.file.name}: Upload failed. Please try again.`);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

    // F6 — single batched DB insert for every successful upload
    if (completed.length > 0) {
      const rows = completed.map(c => ({
        event_id: ev.id, user_id: user.id, storage_path: c.path,
        storage_bucket: "event-media", public_url: null,
        kind: c.isVideo ? "video" : "image", filename: c.filename,
      }));

      const { error: insErr } = await supabase.from("assets").insert(rows);
      if (insErr) {
        console.error("[upload] batch insert failed", insErr);
        toast.error("Some uploads couldn't be saved. Please try again.");
      } else {
        await supabase.from("events").update({ asset_count: assets.length + completed.length }).eq("id", ev.id);
        toast.success(`Uploaded ${completed.length} item${completed.length > 1 ? "s" : ""}`);
      }
    }
    setUploading(false);
    loadAll();
  }


  async function runAgents() {
    if (!ev) return;
    if (selected.length === 0) { toast.error("Select at least one platform"); return; }
    console.log("[AutoEvent] Run Agent clicked", { event_id: ev.id, platforms: selected });
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("run-agents", {
        body: { event_id: ev.id, platforms: selected, audience },
      });
      if (error) throw error;
      console.log("[AutoEvent] Agent output", data);
      toast.success(`Agents finished — ${data?.posts_created ?? 0} posts created`);
    } catch (err: unknown) {
      console.error("[run-agents] failed", err);
      toast.error("Something went wrong while running agents. Please try again.");
    } finally {
      setRunning(false);
      loadAll();
    }
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-paper">
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-6 py-24 text-center">
          <AlertCircle className="size-10 mx-auto text-muted-foreground" />
          <h1 className="font-display text-4xl mt-4">Event not found</h1>
          <p className="text-muted-foreground mt-2">
            This event doesn’t exist, or you don’t have access to it.
          </p>
          <Link to="/dashboard" className="inline-block mt-6">
            <Button><ArrowLeft className="size-4 mr-1" /> Back to events</Button>
          </Link>
        </main>
      </div>
    );
  }

  if (loading || !ev) {
    return (
      <div className="min-h-screen bg-paper">
        <SiteHeader />
        <main className="mx-auto max-w-6xl px-6 py-16 grid place-items-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  const topPicks = assets.filter(a => a.is_top_pick);

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Link to="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="size-4" /> Back to events
        </Link>

        <div className="flex items-start justify-between flex-wrap gap-4 mb-10">
          <div>
            <div className="flex items-center gap-3">
              <div className="size-3 rounded-full" style={{ background: ev.brand_color }} />
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{ev.status}</span>
            </div>
            <h1 className="font-display text-5xl mt-2">{ev.name}</h1>
            {ev.description && <p className="text-muted-foreground mt-2 max-w-2xl">{ev.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" multiple accept="image/*,video/*" hidden onChange={(e) => handleFiles(e.target.files)} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="size-4 animate-spin mr-1" /> : <Upload className="size-4 mr-1" />} Upload
            </Button>
            <Button onClick={runAgents} disabled={running || assets.length === 0}>
              {running ? <Loader2 className="size-4 animate-spin mr-1" /> : <Sparkles className="size-4 mr-1" />}
              Run agents
            </Button>
            <Button variant="outline" onClick={() => setConfirmDelete(true)}
              className="text-destructive hover:text-destructive hover:bg-destructive/10">
              <Trash2 className="size-4 mr-1" /> Delete event
            </Button>
          </div>
        </div>

        <DeleteEventDialog
          eventId={ev.id}
          eventName={ev.name}
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          onDeleted={() => nav({ to: "/dashboard" })}
        />


        <div className="mb-8 bg-card border border-border/60 rounded-xl p-5 shadow-soft">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Target platforms</p>
              <p className="text-sm text-muted-foreground mt-1">Select one or more — the agent generates a tailored post for each.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map(({ id, label, Icon }) => {
                const active = selected.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => togglePlatform(id)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${active ? "bg-ink text-paper border-ink" : "bg-paper text-foreground border-border hover:border-ink/40"}`}
                  >
                    <Icon className="size-4" /> {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mb-8 bg-card border border-border/60 rounded-xl p-5 shadow-soft">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Audience</p>
              <p className="text-sm text-muted-foreground mt-1">Tone, vocabulary and structure are tailored to this audience.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {AUDIENCES.map(({ id, label }) => {
                const active = audience === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setAudience(id)}
                    className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm transition-colors ${active ? "bg-ink text-paper border-ink" : "bg-paper text-foreground border-border hover:border-ink/40"}`}
                  >{label}</button>
                );
              })}
            </div>
          </div>
        </div>

        {pending.length > 0 && (
          <div className="mb-6 bg-card border border-border/60 rounded-xl p-4 shadow-soft">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Uploading {pending.filter(p => p.status === "uploading" || p.status === "processing" || p.status === "queued").length} of {pending.length}
              </p>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-8 gap-2">
              {pending.map(p => (
                <div key={p.id} className="relative aspect-square rounded-md overflow-hidden bg-muted border border-border/60">
                  <img src={p.previewUrl} alt={p.name} className="size-full object-cover" />
                  <div className="absolute inset-0 bg-ink/40 grid place-items-center">
                    {(p.status === "queued" || p.status === "processing") && <Loader2 className="size-5 text-paper animate-spin" />}
                    {p.status === "uploading" && (
                      <div className="text-paper text-xs font-mono font-bold drop-shadow">{p.progress}%</div>
                    )}
                    {p.status === "done" && <CheckCircle2 className="size-5 text-success" />}
                    {p.status === "error" && <AlertCircle className="size-5 text-destructive" />}
                  </div>
                  {p.status === "uploading" && (
                    <div className="absolute bottom-0 left-0 h-1 bg-primary transition-all" style={{ width: `${p.progress}%` }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {assets.length === 0 && pending.length === 0 ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-20 text-center cursor-pointer transition-colors ${drag ? "border-primary bg-primary/5" : "border-border bg-cream/50"}`}>
            <ImageIcon className="size-12 mx-auto text-muted-foreground" />
            <h3 className="font-display text-3xl mt-4">Drop event photos here</h3>
            <p className="text-muted-foreground mt-2">Or click to browse — JPG, PNG up to 20MB each.</p>
          </div>
        ) : (
          <Tabs defaultValue="picks" className="w-full">
            <TabsList className="bg-cream max-w-full overflow-x-auto justify-start">

              <TabsTrigger value="picks">Top picks ({topPicks.length})</TabsTrigger>
              <TabsTrigger value="all">All assets ({assets.length})</TabsTrigger>
              <TabsTrigger value="posts">Generated posts ({posts.length})</TabsTrigger>
              <TabsTrigger value="reel">Reel Studio</TabsTrigger>
              <TabsTrigger value="insights">Insights</TabsTrigger>
              <TabsTrigger value="activity">Agent activity</TabsTrigger>
            </TabsList>

            <TabsContent value="insights" className="mt-6">
              <InsightsDashboard posts={posts} />
            </TabsContent>

            <TabsContent value="picks" className="mt-6">
              {topPicks.length === 0 ? (
                <p className="text-muted-foreground text-sm py-12 text-center">Run the agents to surface top picks.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {topPicks.map(a => <AssetCard key={a.id} asset={a} />)}
                </div>
              )}
            </TabsContent>

            <TabsContent value="all" className="mt-6">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {assets.map(a => <AssetCard key={a.id} asset={a} />)}
              </div>
            </TabsContent>

            <TabsContent value="posts" className="mt-6">
              {posts.length === 0 ? (
                <p className="text-muted-foreground text-sm py-12 text-center">No posts yet — run the agents.</p>
              ) : (
                <PlatformPosts posts={posts} eventId={ev.id} eventName={ev.name} brandColor={ev.brand_color} />
              )}
            </TabsContent>

            <TabsContent value="reel" className="mt-6">
              <ReelStudio eventId={ev.id} userId={ev.user_id} assets={assets} posts={posts} eventName={ev.name} brandColor={ev.brand_color} />
            </TabsContent>

            <TabsContent value="activity" className="mt-6">
              <div className="bg-card border border-border/60 rounded-xl p-6 shadow-soft max-h-[500px] overflow-auto">
                {logs.length === 0 ? <p className="text-muted-foreground text-sm">No activity yet.</p> : (
                  <ul className="space-y-3 font-mono text-sm">
                    {logs.map(l => (
                      <li key={l.id} className="flex gap-3">
                        <span className="text-muted-foreground text-xs mt-0.5 w-20 shrink-0">{new Date(l.created_at).toLocaleTimeString()}</span>
                        <span className="shrink-0">
                          {l.level === "error" ? <AlertCircle className="size-4 text-destructive" /> :
                           l.level === "success" ? <CheckCircle2 className="size-4 text-success" /> :
                           <span className="size-4 inline-block rounded-full bg-primary/20 grid place-items-center"><span className="size-1.5 rounded-full bg-primary" /></span>}
                        </span>
                        <span className="text-xs uppercase tracking-wider text-muted-foreground w-24 shrink-0">{l.agent}</span>
                        <span className="text-foreground">{l.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}

function AssetCard({ asset }: { asset: Asset }) {
  return (
    <div className="relative aspect-square rounded-lg overflow-hidden bg-muted group border border-border/60">
      {asset.public_url && (asset.kind === "video" ? (
        <video src={asset.public_url} muted playsInline preload="metadata" controls className="size-full object-cover" />
      ) : (
        <img src={asset.public_url} alt={asset.filename ?? "asset"} className="size-full object-cover" loading="lazy" />
      ))}
      {asset.is_top_pick && (
        <div className="absolute top-2 left-2 bg-primary text-primary-foreground text-xs px-2 py-1 rounded-full flex items-center gap-1 font-medium">
          <Star className="size-3 fill-current" /> Pick
        </div>
      )}
      {asset.quality_score !== null && (
        <div className="absolute top-2 right-2 bg-ink/80 text-paper text-xs px-2 py-1 rounded-full font-mono">
          {Number(asset.quality_score).toFixed(1)}
        </div>
      )}
      {asset.ai_summary && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 to-transparent p-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <p className="text-paper text-xs line-clamp-3">{asset.ai_summary}</p>
        </div>
      )}
    </div>
  );
}

function PostCard({ post, eventId, eventName, brandColor }: { post: Post; eventId: string; eventName: string; brandColor: string }) {
  const ratioClass = post.format === "9:16" ? "aspect-[9/16]" : post.format === "16:9" ? "aspect-[16/9]" : "aspect-square";
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [caption, setCaption] = useState(post.caption);
  const [hashtags, setHashtags] = useState(
    (post.hashtags ?? []).map(h => `#${h.replace(/^#/, "")}`).join(" ")
  );
  const [view, setView] = useState<"original" | "designed">("designed");
  const [designedUrl, setDesignedUrl] = useState<string | null>(null);
  const [designing, setDesigning] = useState(false);

  useEffect(() => {
    if (!editing) {
      setCaption(post.caption);
      setHashtags((post.hashtags ?? []).map(h => `#${h.replace(/^#/, "")}`).join(" "));
    }
  }, [post.caption, post.hashtags, editing]);

  // Render designed preview whenever post content changes
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    if (!post.image_url) { setDesignedUrl(null); return; }
    setDesigning(true);
    renderDesignedPost({
      imageUrl: post.image_url,
      caption: post.caption,
      format: formatForPlatform(post.platform, post.format) as DesignFormat,
      brandColor,
      brandName: eventName,
      platform: post.platform,
    })
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setDesignedUrl(createdUrl);
      })
      .catch(() => { if (!cancelled) setDesignedUrl(null); })
      .finally(() => { if (!cancelled) setDesigning(false); });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [post.image_url, post.caption, post.platform, post.format, brandColor, eventName]);

  const parseTags = (s: string) =>
    s.split(/\s+/).map(t => t.replace(/^#+/, "").trim().toLowerCase()).filter(Boolean);

  async function save() {
    setSaving(true);
    const tags = parseTags(hashtags);
    const { error } = await supabase
      .from("generated_posts")
      .update({ caption, hashtags: tags })
      .eq("id", post.id);
    setSaving(false);
    if (error) { console.error("[post.save]", error); toast.error("Couldn't save changes. Please try again."); return; }
    toast.success(`${post.platform} post updated`);
    setEditing(false);
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      const { error } = await supabase.functions.invoke("run-agents", {
        body: { event_id: eventId, platforms: [post.platform], replace_only_selected: true },
      });
      if (error) throw error;
      toast.success(`${post.platform} regenerated`);
      setEditing(false);
    } catch (e) {
      console.error("[post.regenerate]", e);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setRegenerating(false);
    }
  }

  async function downloadDesigned() {
    if (!designedUrl) { toast.error("Designed image not ready"); return; }
    try {
      const res = await fetch(designedUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safe = eventName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
      a.href = url; a.download = `${safe}-${post.platform}-designed.png`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success("Designed post downloaded");
    } catch (e) {
      console.error("[download.designed]", e);
      toast.error("Download failed. Please try again.");
    }
  }

  const showDesigned = view === "designed" && designedUrl;
  const previewSrc = showDesigned ? designedUrl : post.image_url;

  return (
    <div className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-soft">
      <div className={`${ratioClass} bg-muted relative`}>
        {previewSrc && <img src={previewSrc} alt="" className="size-full object-cover" />}
        {designing && view === "designed" && !designedUrl && (
          <div className="absolute inset-0 grid place-items-center bg-ink/40">
            <Loader2 className="size-6 animate-spin text-paper" />
          </div>
        )}
        <span className="absolute top-2 left-2 text-xs bg-ink text-paper px-2 py-0.5 rounded-full uppercase tracking-wider">{post.platform}</span>
        <span className="absolute top-2 right-2 text-xs bg-paper/90 text-ink px-2 py-0.5 rounded-full font-mono">{post.format}</span>
        <div className="absolute bottom-2 left-2 inline-flex rounded-full bg-paper/90 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setView("designed")}
            className={`px-2.5 py-1 rounded-full transition-colors ${view === "designed" ? "bg-ink text-paper" : "text-ink"}`}
          >Designed</button>
          <button
            type="button"
            onClick={() => setView("original")}
            className={`px-2.5 py-1 rounded-full transition-colors ${view === "original" ? "bg-ink text-paper" : "text-ink"}`}
          >Original</button>
        </div>
      </div>
      <div className="p-4">
        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={5}
              placeholder="Caption…"
              className="text-sm"
            />
            <Input
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              placeholder="#hashtags space separated"
              className="text-xs font-mono"
            />
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin mr-1" /> : <Save className="size-4 mr-1" />} Save
              </Button>
              <Button size="sm" variant="outline" onClick={regenerate} disabled={regenerating}>
                {regenerating ? <Loader2 className="size-4 animate-spin mr-1" /> : <RefreshCw className="size-4 mr-1" />} Regenerate
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving || regenerating}>
                <X className="size-4 mr-1" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{post.caption}</p>
            {post.hashtags && post.hashtags.length > 0 && (
              <p className="mt-2 text-xs text-primary">{post.hashtags.map(h => `#${h.replace(/^#/, "")}`).join(" ")}</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {post.best_time && (
                <div className="flex items-center gap-1.5 text-muted-foreground"><Clock className="size-3.5" /> <span>{post.best_time}</span></div>
              )}
              {typeof post.predicted_engagement === "number" && (
                <div className="flex items-center gap-1.5 text-muted-foreground"><TrendingUp className="size-3.5" /> <span>Predicted {Math.round(post.predicted_engagement)}/100</span></div>
              )}
              {post.audience && (
                <div className="col-span-2 text-muted-foreground capitalize">Audience: {post.audience}</div>
              )}
            </div>
            <MetricsEditor post={post} />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="size-4 mr-1" /> Edit
              </Button>
              <Button size="sm" variant="outline" onClick={() => {
                navigator.clipboard.writeText(`${post.caption}\n\n${(post.hashtags ?? []).map(h => `#${h.replace(/^#/, "")}`).join(" ")}`);
                toast.success("Caption copied");
              }}>Copy</Button>
              <Button size="sm" variant="outline" onClick={downloadDesigned} disabled={!designedUrl}>
                <Download className="size-4 mr-1" /> Designed
              </Button>
              <Button size="sm" onClick={() => downloadPostZip(post, eventName, designedUrl)}>
                <Download className="size-4 mr-1" /> ZIP
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

async function downloadPostZip(post: Post, eventName: string, designedUrl?: string | null) {
  try {
    const zip = new JSZip();
    const safeEvent = eventName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
    const folder = zip.folder(`${safeEvent}-${post.platform}`)!;
    folder.file("caption.txt", post.caption ?? "");
    if (post.hashtags && post.hashtags.length) {
      folder.file("hashtags.txt", post.hashtags.map(h => `#${h.replace(/^#/, "")}`).join(" "));
    }
    folder.file("metadata.json", JSON.stringify({
      platform: post.platform, format: post.format,
      caption: post.caption, hashtags: post.hashtags ?? [],
      image_url: post.image_url, generated_at: new Date().toISOString(),
    }, null, 2));
    if (post.image_url) {
      const res = await fetch(post.image_url);
      if (res.ok) {
        const blob = await res.blob();
        const ext = (blob.type.split("/")[1] || "jpg").split("+")[0];
        folder.file(`original.${ext}`, blob);
      }
    }
    if (designedUrl) {
      try {
        const res = await fetch(designedUrl);
        if (res.ok) folder.file("designed.png", await res.blob());
      } catch { /* skip */ }
    }
    const out = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(out);
    const a = document.createElement("a");
    a.href = url; a.download = `${safeEvent}-${post.platform}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${post.platform} ZIP`);
  } catch (e) {
    console.error("[zip.post]", e);
    toast.error("Download failed. Please try again.");
  }
}

function PlatformPosts({ posts, eventId, eventName, brandColor }: { posts: Post[]; eventId: string; eventName: string; brandColor: string }) {
  const [zipping, setZipping] = useState(false);
  const present = PLATFORMS.filter(p => posts.some(po => po.platform === p.id));
  const list = present.length ? present : PLATFORMS;
  const initial = list[0].id;

  async function downloadAll() {
    setZipping(true);
    try {
      const zip = new JSZip();
      const safeEvent = eventName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
      const counters: Record<string, number> = {};
      for (const post of posts) {
        counters[post.platform] = (counters[post.platform] ?? 0) + 1;
        const n = counters[post.platform];
        const folder = zip.folder(`${post.platform}/post-${n}`)!;
        folder.file("caption.txt", post.caption ?? "");
        if (post.hashtags?.length) {
          folder.file("hashtags.txt", post.hashtags.map(h => `#${h.replace(/^#/, "")}`).join(" "));
        }
        folder.file("metadata.json", JSON.stringify({
          platform: post.platform, format: post.format,
          caption: post.caption, hashtags: post.hashtags ?? [],
          image_url: post.image_url,
        }, null, 2));
        if (post.image_url) {
          try {
            const res = await fetch(post.image_url);
            if (res.ok) {
              const blob = await res.blob();
              const ext = (blob.type.split("/")[1] || "jpg").split("+")[0];
              folder.file(`original.${ext}`, blob);
            }
          } catch { /* skip image */ }
          try {
            const designed = await renderDesignedPost({
              imageUrl: post.image_url,
              caption: post.caption,
              format: formatForPlatform(post.platform, post.format),
              brandColor,
              brandName: eventName,
              platform: post.platform,
            });
            folder.file("designed.png", designed);
          } catch { /* skip design */ }
        }
      }
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url; a.download = `${safeEvent}-all-posts.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${posts.length} posts`);
    } catch (e) {
      console.error("[zip.all]", e);
      toast.error("Download failed. Please try again.");
    } finally {
      setZipping(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={downloadAll} disabled={zipping || posts.length === 0}>
          {zipping ? <Loader2 className="size-4 animate-spin mr-1" /> : <Download className="size-4 mr-1" />}
          Download all posts (ZIP)
        </Button>
      </div>
      <Tabs defaultValue={initial} className="w-full">
        <TabsList className="bg-cream max-w-full overflow-x-auto justify-start">
          {list.map(({ id, label, Icon }) => {
            const count = posts.filter(p => p.platform === id).length;
            return (
              <TabsTrigger key={id} value={id} className="gap-1.5">
                <Icon className="size-4" /> {label} {count > 0 && <span className="text-xs opacity-60">({count})</span>}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {list.map(({ id }) => {
          const platformPosts = posts.filter(p => p.platform === id);
          return (
            <TabsContent key={id} value={id} className="mt-6">
              {platformPosts.length === 0 ? (
                <p className="text-muted-foreground text-sm py-12 text-center">No {id} post yet.</p>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {platformPosts.map(p => <PostCard key={p.id} post={p} eventId={eventId} eventName={eventName} brandColor={brandColor} />)}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

function computeScore(m: Metrics): number {
  const reach = Math.max(1, m.reach || 0);
  const interactions = (m.likes || 0) + 2 * (m.comments || 0) + 3 * (m.shares || 0);
  // Engagement rate scaled to 0-100 (cap at ~25% which is exceptional)
  return Math.min(100, Math.round((interactions / reach) * 400));
}

function MetricsEditor({ post }: { post: Post }) {
  const initial: Metrics = post.metrics ?? { likes: 0, shares: 0, reach: 0, comments: 0 };
  const [open, setOpen] = useState(false);
  const [m, setM] = useState<Metrics>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setM(post.metrics ?? { likes: 0, shares: 0, reach: 0, comments: 0 }); }, [post.metrics]);

  const score = post.engagement_score ?? computeScore(m);

  async function save() {
    setSaving(true);
    const next = computeScore(m);
    const { error } = await supabase
      .from("generated_posts")
      .update({ metrics: m, engagement_score: next })
      .eq("id", post.id);
    setSaving(false);
    if (error) { console.error("[metrics.save]", error); toast.error("Couldn't save metrics. Please try again."); return; }
    toast.success("Metrics saved — AI will learn from this");
    setOpen(false);
  }

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span className="inline-flex items-center gap-1"><Heart className="size-3.5" /> {m.likes}</span>
          <span className="inline-flex items-center gap-1"><MessageCircle className="size-3.5" /> {m.comments}</span>
          <span className="inline-flex items-center gap-1"><Share2 className="size-3.5" /> {m.shares}</span>
          <span className="inline-flex items-center gap-1"><Eye className="size-3.5" /> {m.reach}</span>
          <span className="inline-flex items-center gap-1 font-medium text-foreground">Score {Math.round(score)}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen(o => !o)}>
          {open ? "Close" : "Track"}
        </Button>
      </div>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["likes","comments","shares","reach"] as const).map((k) => (
            <label key={k} className="text-xs space-y-1">
              <span className="text-muted-foreground capitalize">{k}</span>
              <Input
                type="number" min={0}
                value={m[k]}
                onChange={(e) => setM(prev => ({ ...prev, [k]: Math.max(0, Number(e.target.value) || 0) }))}
              />
            </label>
          ))}
          <div className="col-span-2 flex justify-end">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin mr-1" /> : <Save className="size-4 mr-1" />} Save metrics
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function InsightsDashboard({ posts }: { posts: Post[] }) {
  if (posts.length === 0) return <p className="text-muted-foreground text-sm py-12 text-center">Run agents to see insights.</p>;
  const total = posts.reduce((acc, p) => {
    const m = p.metrics ?? { likes: 0, shares: 0, reach: 0, comments: 0 };
    acc.likes += m.likes; acc.comments += m.comments; acc.shares += m.shares; acc.reach += m.reach;
    return acc;
  }, { likes: 0, comments: 0, shares: 0, reach: 0 });
  const avgPredicted = posts.reduce((s, p) => s + (p.predicted_engagement ?? 0), 0) / posts.length;
  const scored = posts.filter(p => p.engagement_score != null);
  const avgScore = scored.length ? scored.reduce((s, p) => s + (p.engagement_score ?? 0), 0) / scored.length : 0;

  const byPlatform: Record<string, { platform: string; predicted: number; actual: number; n: number }> = {};
  for (const p of posts) {
    const k = p.platform;
    byPlatform[k] ||= { platform: k, predicted: 0, actual: 0, n: 0 };
    byPlatform[k].predicted += p.predicted_engagement ?? 0;
    byPlatform[k].actual += p.engagement_score ?? 0;
    byPlatform[k].n += 1;
  }
  const chartData = Object.values(byPlatform).map(d => ({
    platform: d.platform,
    predicted: Math.round(d.predicted / d.n),
    actual: Math.round(d.actual / d.n),
  }));

  const topPerformers = [...posts]
    .filter(p => p.engagement_score != null)
    .sort((a, b) => (b.engagement_score ?? 0) - (a.engagement_score ?? 0))
    .slice(0, 3);

  const stats = [
    { label: "Likes", value: total.likes, Icon: Heart },
    { label: "Comments", value: total.comments, Icon: MessageCircle },
    { label: "Shares", value: total.shares, Icon: Share2 },
    { label: "Reach", value: total.reach, Icon: Eye },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map(({ label, value, Icon }) => (
          <div key={label} className="bg-card border border-border/60 rounded-xl p-4 shadow-soft">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><Icon className="size-3.5" />{label}</div>
            <div className="font-display text-3xl mt-1">{value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card border border-border/60 rounded-xl p-4 shadow-soft">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Predicted vs Actual (per platform)</p>
          <div className="h-64 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="platform" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="predicted" fill="hsl(var(--muted-foreground))" radius={[4,4,0,0]} />
                <Bar dataKey="actual" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card border border-border/60 rounded-xl p-4 shadow-soft">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Performance summary</p>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <div className="text-xs text-muted-foreground">Avg predicted</div>
              <div className="font-display text-2xl">{Math.round(avgPredicted)}/100</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Avg actual score</div>
              <div className="font-display text-2xl">{Math.round(avgScore)}/100</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">Track real metrics on each post to feed the AI self-improvement loop. Top posts inform the next generation.</p>
        </div>
      </div>

      {topPerformers.length > 0 && (
        <div className="bg-card border border-border/60 rounded-xl p-4 shadow-soft">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Top performers (AI is learning from these)</p>
          <ul className="space-y-2">
            {topPerformers.map(p => (
              <li key={p.id} className="flex items-start gap-3 text-sm">
                <span className="text-xs uppercase tracking-wider w-20 shrink-0 text-muted-foreground">{p.platform}</span>
                <span className="font-medium w-12 shrink-0">{Math.round(p.engagement_score ?? 0)}</span>
                <span className="line-clamp-2 text-foreground/90">{p.caption}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
