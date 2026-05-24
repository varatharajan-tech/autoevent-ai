// Reel generation engine — runs entirely in the browser using the
// Canvas API + MediaRecorder API. Supports BOTH still photos (with Ken
// Burns motion) and short video clips (drawn frame-by-frame). No ffmpeg,
// no WebAssembly, no external APIs, no keys.

import { generateMoodMusic, type Mood } from "./reelMusic";

export type ReelPlatform = "instagram" | "youtube" | "facebook" | "twitter";

export const REEL_PLATFORMS: { id: ReelPlatform; label: string; maxDur: number }[] = [
  { id: "instagram", label: "Instagram Reels", maxDur: 90 },
  { id: "youtube",   label: "YouTube Shorts",  maxDur: 60 },
  { id: "facebook",  label: "Facebook Reels",  maxDur: 90 },
  { id: "twitter",   label: "Twitter / X",     maxDur: 60 },
];

export type ReelSlide = { url: string; kind: "image" | "video" };

export type ReelInput = {
  slides: ReelSlide[];
  captions: string[];
  headline: string;
  mood: Mood;
  platform: ReelPlatform;
  secondsPerSlide: number;
  brandColor?: string;
};

export type ReelProgress = (msg: string, pct: number) => void;

const W = 1080;
const H = 1920;
const FPS = 30;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error(`Failed to load video: ${url}`));
  });
}

type LoadedSlide =
  | { kind: "image"; el: HTMLImageElement; dur: number }
  | { kind: "video"; el: HTMLVideoElement; dur: number };

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 3): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, srcW: number, srcH: number, scale = 1, panX = 0) {
  const imgRatio = srcW / srcH;
  const canvasRatio = W / H;
  let drawW: number, drawH: number;
  if (imgRatio > canvasRatio) {
    drawH = H * scale;
    drawW = drawH * imgRatio;
  } else {
    drawW = W * scale;
    drawH = drawW / imgRatio;
  }
  const offsetX = (W - drawW) / 2 - panX;
  const offsetY = (H - drawH) / 2;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(src, offsetX, offsetY, drawW, drawH);
}

function drawOverlays(
  ctx: CanvasRenderingContext2D,
  caption: string,
  headline: string,
  showHeadline: boolean,
  brandColor: string,
) {
  // Bottom gradient for caption readability
  const grad = ctx.createLinearGradient(0, H * 0.5, 0, H);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.85)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, H * 0.5, W, H * 0.5);

  // Top gradient for headline readability
  const topGrad = ctx.createLinearGradient(0, 0, 0, 240);
  topGrad.addColorStop(0, "rgba(0,0,0,0.6)");
  topGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, W, 240);

  // Brand accent bars
  ctx.fillStyle = brandColor;
  ctx.fillRect(0, 0, W, 10);
  ctx.fillRect(0, H - 10, W, 10);

  if (showHeadline) {
    ctx.fillStyle = "#FFD60A";
    ctx.font = "bold 64px Inter, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(headline.toUpperCase(), 50, 110);
  }

  if (caption) {
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "42px Inter, Arial, sans-serif";
    ctx.textAlign = "left";
    const lines = wrapLines(ctx, caption, 980, 3);
    const lineHeight = 56;
    const startY = H - 140 - lines.length * lineHeight;
    lines.forEach((l, i) => ctx.fillText(l, 50, startY + i * lineHeight));
  }
}

function pickMime(): string {
  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "video/webm";
}

async function buildAudioTrack(
  musicBlob: Blob,
  durationSec: number,
): Promise<{ track: MediaStreamTrack; start: () => void; stop: () => void; ctx: AudioContext }> {
  const AC: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const dest = ctx.createMediaStreamDestination();
  const arr = await musicBlob.arrayBuffer();
  const buf = await ctx.decodeAudioData(arr.slice(0));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = 0.85;
  src.connect(gain).connect(dest);
  return {
    track: dest.stream.getAudioTracks()[0],
    start: () => {
      src.start();
      const fadeStart = Math.max(0, durationSec - 0.8);
      gain.gain.setValueAtTime(0.85, ctx.currentTime + fadeStart);
      gain.gain.linearRampToValueAtTime(0.0, ctx.currentTime + durationSec);
    },
    stop: () => {
      try { src.stop(); } catch { /* ignore */ }
      ctx.close().catch(() => undefined);
    },
    ctx,
  };
}

export async function generateReel(
  input: ReelInput,
  onProgress: ReelProgress,
): Promise<{ blob: Blob; durationSec: number }> {
  const { slides, captions, headline, mood, platform, secondsPerSlide, brandColor } = input;
  if (!slides || slides.length === 0) throw new Error("No media selected");
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Your browser does not support MediaRecorder. Try Chrome, Edge or Firefox.");
  }

  const platMeta = REEL_PLATFORMS.find(p => p.id === platform)!;
  const accent = brandColor && /^#[0-9a-fA-F]{3,8}$/.test(brandColor) ? brandColor : "#7B2FBE";

  onProgress("Loading media…", 5);
  const loaded: LoadedSlide[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    try {
      if (s.kind === "video") {
        const v = await loadVideo(s.url);
        const dur = Math.min(secondsPerSlide, Number.isFinite(v.duration) && v.duration > 0 ? v.duration : secondsPerSlide);
        loaded.push({ kind: "video", el: v, dur });
      } else {
        const img = await loadImage(s.url);
        loaded.push({ kind: "image", el: img, dur: secondsPerSlide });
      }
    } catch (e) {
      console.warn("[reelEngine] skipping slide", s, e);
    }
    onProgress(`Loading ${i + 1}/${slides.length}`, 5 + Math.round((i + 1) / slides.length * 20));
  }
  if (loaded.length === 0) throw new Error("Could not load any media (CORS or network).");

  // Total duration respecting per-slide caps + platform max
  let plannedDur = loaded.reduce((s, m) => s + m.dur, 0);
  if (plannedDur > platMeta.maxDur) {
    // Scale down each slide proportionally to fit platform cap
    const scale = platMeta.maxDur / plannedDur;
    loaded.forEach(m => { m.dur = m.dur * scale; });
    plannedDur = platMeta.maxDur;
  }

  onProgress("Composing soundtrack…", 28);
  const musicBlob = await generateMoodMusic(mood, plannedDur + 0.5);

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");

  // Prime first frame
  const first = loaded[0];
  if (first.kind === "image") {
    drawCover(ctx, first.el, first.el.width, first.el.height, 1, 0);
  } else {
    drawCover(ctx, first.el, first.el.videoWidth || W, first.el.videoHeight || H);
  }
  drawOverlays(ctx, captions[0] ?? "", headline, true, accent);

  const videoStream = canvas.captureStream(FPS);
  const audio = await buildAudioTrack(musicBlob, plannedDur);
  const stream = new MediaStream([...videoStream.getVideoTracks(), audio.track]);

  const mimeType = pickMime();
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = (ev) => reject(new Error(`Recorder error: ${(ev as ErrorEvent).message ?? "unknown"}`));
  });

  onProgress("Rendering reel…", 32);
  recorder.start(250);
  audio.start();

  const frameMs = 1000 / FPS;
  const headlineSec = 2.5;
  const transitionFrames = 9;
  const t0 = performance.now();

  let globalFrame = 0;
  const totalFrames = Math.round(plannedDur * FPS);

  for (let i = 0; i < loaded.length; i++) {
    const m = loaded[i];
    const caption = captions[i] ?? captions[0] ?? "";
    const slideFrames = Math.max(1, Math.round(m.dur * FPS));

    if (m.kind === "video") {
      try { m.el.currentTime = 0; await m.el.play(); } catch { /* ignore */ }
    }

    for (let f = 0; f < slideFrames; f++) {
      const progress = f / slideFrames;

      if (m.kind === "image") {
        const scale = 1.0 + progress * 0.15;
        const panX = progress * 30;
        drawCover(ctx, m.el, m.el.width, m.el.height, scale, panX);
      } else {
        // Loop video if it ends before the slide
        if (m.el.ended || (m.el.duration && m.el.currentTime >= m.el.duration - 0.05)) {
          try { m.el.currentTime = 0; await m.el.play(); } catch { /* ignore */ }
        }
        drawCover(ctx, m.el, m.el.videoWidth || W, m.el.videoHeight || H);
      }

      drawOverlays(
        ctx, caption, headline,
        i === 0 && (globalFrame / FPS) < headlineSec,
        accent,
      );

      if (i < loaded.length - 1 && f >= slideFrames - transitionFrames) {
        const a = (f - (slideFrames - transitionFrames)) / transitionFrames;
        ctx.fillStyle = `rgba(0,0,0,${a})`;
        ctx.fillRect(0, 0, W, H);
      }

      const targetMs = (globalFrame + 1) * frameMs;
      const elapsed = performance.now() - t0;
      const wait = targetMs - elapsed;
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      globalFrame++;
      if (globalFrame % FPS === 0) {
        const pct = 32 + Math.round((globalFrame / totalFrames) * 60);
        onProgress(`Rendering ${i + 1}/${loaded.length}…`, Math.min(92, pct));
      }
    }

    if (m.kind === "video") {
      try { m.el.pause(); } catch { /* ignore */ }
    }
  }

  await new Promise(r => setTimeout(r, 600));

  onProgress("Finalizing…", 95);
  recorder.stop();
  const blob = await stopped;
  audio.stop();

  onProgress("Done", 100);
  return { blob, durationSec: plannedDur };
}
