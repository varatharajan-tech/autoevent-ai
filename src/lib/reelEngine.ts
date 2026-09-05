// Cinematic reel engine — Canvas + MediaRecorder. No ffmpeg / wasm / APIs.
// Builds a multi-scene timeline: HOOK → (TRANSITION + CINEMATIC|ENERGY) × N → CLOSING.
// Layers cinematic bars, vignette, color grade, gradients, animated titles,
// brand badge, glow accents, progress bar and chromatic flash effects.
//
// Supports BOTH still photos (Ken Burns / drift / zoom-burst) and short video clips
// (drawn frame-by-frame, looped to fill the scene). Soundtrack is layered via
// AudioContext from generateMoodMusic().

import { generateMoodMusic, BPM_BY_MOOD, type Mood } from "./reelMusic";
import type { ReelEditPlan, NarrativePosition, TransitionType } from "./reelEditPlanner";

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
  /** When present, the reel is cut from this AI edit plan instead of the flat slide list. */
  editPlan?: ReelEditPlan | null;
  /** Event name shown on the closing card (defaults to headline). */
  eventName?: string;
};



export type ReelProgress = (msg: string, pct: number) => void;

const W = 1080;
const H = 1920;
const FPS = 30;

// ─── style presets (mapped from Mood) ──────────────────────────────────────
type EditStyle = {
  hookDuration: number;
  closingDuration: number;
  transitions: ("flash" | "fade" | "zoom")[];
  colorGradeHook: ColorGrade;
  colorGradeEven: ColorGrade;
  colorGradeOdd: ColorGrade;
  colorGradeClose: ColorGrade;
  transFlashMs: number;
  transFadeMs: number;
  transZoomMs: number;
};
type ColorGrade = "cinematic" | "warm" | "cold" | "luxury" | "viral";

const COLOR_GRADES: Record<ColorGrade, string> = {
  cinematic: "rgba(10, 5, 30, 0.18)",
  warm:      "rgba(40, 15, 0, 0.15)",
  cold:      "rgba(0, 10, 40, 0.18)",
  luxury:    "rgba(20, 10, 0, 0.20)",
  viral:     "rgba(5, 0, 20, 0.12)",
};

function styleForMood(m: Mood): EditStyle {
  switch (m) {
    case "energetic": return {
      hookDuration: 1.6, closingDuration: 2.2,
      transitions: ["flash", "zoom", "flash"],
      colorGradeHook: "viral", colorGradeEven: "warm",
      colorGradeOdd: "viral", colorGradeClose: "viral",
      transFlashMs: 160, transFadeMs: 220, transZoomMs: 900,
    };
    case "corporate": return {
      hookDuration: 2.6, closingDuration: 3.4,
      transitions: ["fade", "fade", "flash"],
      colorGradeHook: "cold", colorGradeEven: "cold",
      colorGradeOdd: "cinematic", colorGradeClose: "luxury",
      transFlashMs: 220, transFadeMs: 320, transZoomMs: 1100,
    };
    case "upbeat": return {
      hookDuration: 1.8, closingDuration: 2.4,
      transitions: ["flash", "flash", "zoom"],
      colorGradeHook: "warm", colorGradeEven: "warm",
      colorGradeOdd: "viral", colorGradeClose: "warm",
      transFlashMs: 150, transFadeMs: 220, transZoomMs: 900,
    };
    case "cinematic":
    default: return {
      hookDuration: 2.4, closingDuration: 3.0,
      transitions: ["flash", "fade", "zoom"],
      colorGradeHook: "cinematic", colorGradeEven: "cold",
      colorGradeOdd: "warm", colorGradeClose: "luxury",
      transFlashMs: 200, transFadeMs: 280, transZoomMs: 1000,
    };
  }
}

// ─── easings ──────────────────────────────────────────────────────────────
const easeInOutCubic = (t: number) => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
const easeOutExpo    = (t: number) => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
const easeInExpo     = (t: number) => t <= 0 ? 0 : Math.pow(2, 10 * t - 10);
const lerp           = (a: number, b: number, t: number) => a + (b - a) * t;

// ─── loaders ──────────────────────────────────────────────────────────────
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
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error(`Failed to load video: ${url}`));
  });
}

type LoadedSlide =
  | { kind: "image"; el: HTMLImageElement; srcW: number; srcH: number }
  | { kind: "video"; el: HTMLVideoElement; srcW: number; srcH: number };

// ─── drawing helpers ──────────────────────────────────────────────────────
function drawCover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource, srcW: number, srcH: number,
  scale = 1, offsetX = 0, offsetY = 0,
) {
  const imgRatio = srcW / srcH;
  const canvasRatio = W / H;
  let drawW: number, drawH: number;
  if (imgRatio > canvasRatio) { drawH = H * scale; drawW = drawH * imgRatio; }
  else                        { drawW = W * scale; drawH = drawW / imgRatio; }
  const x = (W - drawW) / 2 + offsetX;
  const y = (H - drawH) / 2 + offsetY;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(src, x, y, drawW, drawH);
}

function drawScaledAround(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource, srcW: number, srcH: number,
  scale: number, panX: number, panY: number,
) {
  ctx.save();
  ctx.translate(W/2 + panX, H/2 + panY);
  ctx.scale(scale, scale);
  ctx.translate(-W/2, -H/2);
  drawCover(ctx, src, srcW, srcH, 1, 0, 0);
  ctx.restore();
}

function drawCinematicBars(ctx: CanvasRenderingContext2D, opacity = 1) {
  const h = 120;
  ctx.fillStyle = `rgba(0,0,0,${opacity})`;
  ctx.fillRect(0, 0, W, h);
  ctx.fillRect(0, H - h, W, h);
}
function drawVignette(ctx: CanvasRenderingContext2D, intensity = 0.55) {
  const g = ctx.createRadialGradient(W/2, H/2, 200, W/2, H/2, 1100);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${intensity})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function drawColorGrade(ctx: CanvasRenderingContext2D, grade: ColorGrade) {
  ctx.fillStyle = COLOR_GRADES[grade]; ctx.fillRect(0, 0, W, H);
}
function drawBottomGradient(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 1200, 0, H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.5, "rgba(0,0,0,0.5)");
  g.addColorStop(1, "rgba(0,0,0,0.92)");
  ctx.fillStyle = g; ctx.fillRect(0, 1200, W, H - 1200);
}
function drawTopGradient(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, 350);
  g.addColorStop(0, "rgba(0,0,0,0.75)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 350);
}
function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, alpha: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, max = 3): string[] {
  const words = text.split(/\s+/); const lines: string[] = []; let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; }
    else line = t;
    if (lines.length >= max) break;
  }
  if (line && lines.length < max) lines.push(line);
  return lines.slice(0, max);
}

function drawAnimatedTitle(
  ctx: CanvasRenderingContext2D, text: string, progress: number,
  y: number, color: string, size: number,
) {
  if (!text) return;
  const slide = easeOutExpo(Math.min(progress * 3, 1));
  const fade  = Math.min(progress * 4, 1);
  const posY  = y + (1 - slide) * 60;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px Inter, "Arial Black", Arial, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 20; ctx.shadowOffsetY = 4;
  const lines = wrapLines(ctx, text, 900, 3);
  const lineH = size * 1.3;
  const startY = posY - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => ctx.fillText(l, W/2, startY + i * lineH));
  ctx.restore();
}

// Split a caption into sentence-level phrases for beat-paced display.
function splitPhrases(text: string): string[] {
  if (!text) return [];
  const sentences = text.replace(/\s+/g, " ").trim()
    .split(/(?<=[.!?…])\s+/)
    .flatMap(s => s.length > 70 ? s.split(/,\s+/) : [s])
    .map(s => s.trim()).filter(Boolean);
  return sentences.length ? sentences : [text.trim()];
}

// Beat-paced caption: cycles through phrases on beat boundaries, with a
// reserved tail (in frames) at the end so the last phrase fully fades out
// BEFORE the next transition starts. Never cuts mid-fade.
function drawPacedCaption(
  ctx: CanvasRenderingContext2D,
  phrases: string[],
  frame: number,
  totalFrames: number,
  beatFrames: number,
  tailFrames: number,
  y: number, color: string, size: number,
) {
  if (!phrases.length) return;
  const usable = Math.max(beatFrames, totalFrames - tailFrames);
  // Allocate at least 2 beats per phrase, distributed to fill `usable`.
  const minPhraseFrames = beatFrames * 2;
  const maxPhrases = Math.max(1, Math.min(phrases.length, Math.floor(usable / minPhraseFrames)));
  const phraseFrames = Math.floor(usable / maxPhrases);
  // If we're in the tail buffer, fade out the last phrase smoothly.
  if (frame >= usable) {
    const tailT = Math.min(1, (frame - usable) / Math.max(1, tailFrames));
    const fade = 1 - easeInOutCubic(tailT);
    if (fade <= 0.02) return;
    drawAnimatedTitleAlpha(ctx, phrases[maxPhrases - 1], 1, y, color, size, fade);
    return;
  }
  const idx = Math.min(maxPhrases - 1, Math.floor(frame / phraseFrames));
  const localFrame = frame - idx * phraseFrames;
  const localT = phraseFrames <= 1 ? 1 : localFrame / phraseFrames;
  // In-phrase envelope: fade-in 0–25%, hold, fade-out 80–100%.
  let envelope = 1;
  if (localT < 0.25) envelope = easeOutExpo(localT / 0.25);
  else if (localT > 0.80) envelope = 1 - easeInOutCubic((localT - 0.80) / 0.20);
  // `progress` arg of drawAnimatedTitle drives the slide-up; reuse early portion.
  const slideProgress = Math.min(1, localT * 4);
  drawAnimatedTitleAlpha(ctx, phrases[idx], slideProgress, y, color, size, envelope);
}

function drawAnimatedTitleAlpha(
  ctx: CanvasRenderingContext2D, text: string, progress: number,
  y: number, color: string, size: number, alpha: number,
) {
  if (!text || alpha <= 0) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  drawAnimatedTitle(ctx, text, progress, y, color, size);
  ctx.globalAlpha = prev;
}



function drawBrandBadge(ctx: CanvasRenderingContext2D, brand: string, progress: number, accent: string) {
  const fade = Math.min(progress * 5, 1);
  ctx.save(); ctx.globalAlpha = fade;
  const padX = 22; const dotR = 6;
  ctx.font = "bold 22px Inter, Arial, sans-serif";
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  const text = brand.toUpperCase();
  const textW = ctx.measureText(text).width;
  const w = Math.min(720, textW + padX * 2 + dotR * 2 + 16);
  const x = 50, y = 140, h = 52, r = 26;
  ctx.fillStyle = accent + "D9";
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#06D6A0";
  ctx.beginPath(); ctx.arc(x + 26, y + h/2, dotR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(text, x + 44, y + h/2);
  ctx.restore();
}

function drawProgressBar(ctx: CanvasRenderingContext2D, current: number, total: number, progress: number, accent: string) {
  const fade = Math.min(progress * 5, 1);
  ctx.save(); ctx.globalAlpha = fade * 0.75;
  ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.fillRect(50, 1860, 980, 3);
  const fillW = 980 * Math.min(1, Math.max(0, (current - 1 + progress) / total));
  const g = ctx.createLinearGradient(50, 0, 1030, 0);
  g.addColorStop(0, accent); g.addColorStop(1, "#06D6A0");
  ctx.fillStyle = g; ctx.fillRect(50, 1860, fillW, 3);
  ctx.restore();
}

function drawChromaticFlash(ctx: CanvasRenderingContext2D, intensity: number) {
  if (intensity <= 0) return;
  const off = intensity * 8;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "rgba(255,0,0,0.18)"; ctx.fillRect(-off, 0, W, H);
  ctx.fillStyle = "rgba(0,0,255,0.18)"; ctx.fillRect(off, 0, W, H);
  ctx.restore();
}

// ─── recorder / audio plumbing ─────────────────────────────────────────────
function pickMime(): string {
  const c = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const m of c) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "video/webm";
}

async function buildAudioTrack(musicBlob: Blob, durationSec: number) {
  const AC: typeof AudioContext = window.AudioContext
    || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const dest = ctx.createMediaStreamDestination();
  const arr = await musicBlob.arrayBuffer();
  const buf = await ctx.decodeAudioData(arr.slice(0));
  const src = ctx.createBufferSource(); src.buffer = buf;
  const gain = ctx.createGain(); gain.gain.value = 0.85;
  src.connect(gain).connect(dest);
  return {
    track: dest.stream.getAudioTracks()[0],
    start: () => {
      src.start();
      const fadeStart = Math.max(0, durationSec - 0.8);
      gain.gain.setValueAtTime(0.85, ctx.currentTime + fadeStart);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + durationSec);
    },
    stop: () => { try { src.stop(); } catch { /* */ } ctx.close().catch(() => undefined); },
  };
}

// ─── timeline segments ─────────────────────────────────────────────────────
type Segment =
  | { kind: "hook";  slide: LoadedSlide; frames: number; caption: string;
      phrases: string[]; beatFrames: number; tailFrames: number }
  | { kind: "scene"; slide: LoadedSlide; frames: number; caption: string;
      phrases: string[]; beatFrames: number; tailFrames: number;
      mode: "cinematic" | "energy"; sceneIdx: number; totalScenes: number;
      grade: ColorGrade }
  | { kind: "flash"; frames: number }
  | { kind: "fade-out"; frames: number }
  | { kind: "fade-in"; frames: number }
  | { kind: "zoom-burst"; slide: LoadedSlide; frames: number }
  | { kind: "closing"; slide: LoadedSlide; frames: number;
      eventName: string; brandColor: string }
  // ─── AI-planned segments (Drawback 3) ───────────────────────────────────
  | { kind: "plan-scene"; slide: LoadedSlide; frames: number;
      position: NarrativePosition; subtitle: string | null; showSubtitle: boolean;
      sceneIdx: number; totalScenes: number; eventName: string }
  | { kind: "clean-cut"; frames: number }
  | { kind: "dramatic-fade"; frames: number }
  | { kind: "smooth-slide"; slide: LoadedSlide; frames: number };

function ensureVideoPlaying(s: LoadedSlide) {
  if (s.kind !== "video") return;
  if (s.el.paused || s.el.ended) {
    try { s.el.currentTime = 0; void s.el.play(); } catch { /* */ }
  } else if (s.el.duration && s.el.currentTime >= s.el.duration - 0.05) {
    try { s.el.currentTime = 0; void s.el.play(); } catch { /* */ }
  }
}

// ─── AI edit-plan renderers (Drawback 3) ───────────────────────────────────

/** Key-moment pill subtitle: slides up, holds, fades out. */
function drawAnimatedSubtitle(
  ctx: CanvasRenderingContext2D, text: string | null, progress: number, accent: string,
) {
  if (!text || !text.trim()) return;
  let alpha = 1;
  if (progress < 0.2)       alpha = easeOutExpo(progress / 0.2);
  else if (progress > 0.85) alpha = 1 - easeInExpo((progress - 0.85) / 0.15);
  if (alpha <= 0.02) return;
  const slideY = progress < 0.2 ? (1 - easeOutExpo(progress / 0.2)) * 40 : 0;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.font = "bold 34px Inter, Arial, sans-serif";

  let display = text.trim();
  const maxTextW = W - 200;
  while (ctx.measureText(display).width > maxTextW && display.length > 10) {
    display = display.slice(0, -4) + "…";
  }
  const pillW = Math.min(ctx.measureText(display).width + 56, W - 80);
  const pillH = 58;
  const pillX = (W - pillW) / 2;
  const pillY = 1700 + slideY;
  const r = pillH / 2;

  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.beginPath();
  ctx.moveTo(pillX + r, pillY);
  ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + pillH, r);
  ctx.arcTo(pillX + pillW, pillY + pillH, pillX, pillY + pillH, r);
  ctx.arcTo(pillX, pillY + pillH, pillX, pillY, r);
  ctx.arcTo(pillX, pillY, pillX + pillW, pillY, r);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = accent;
  ctx.fillRect(pillX + 10, pillY + 10, 4, pillH - 20);

  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 8;
  ctx.fillText(display, W / 2, pillY + pillH / 2);
  ctx.restore();
}

const BUILD_PANS = [
  { fx: -20, tx: 20,  fy: -10, ty: 10,  fs: 1.05, ts: 1.18 },
  { fx: 20,  tx: -20, fy: 10,  ty: -10, fs: 1.18, ts: 1.05 },
  { fx: 0,   tx: 0,   fy: -25, ty: 0,   fs: 1.08, ts: 1.20 },
];

function renderPlanScene(
  ctx: CanvasRenderingContext2D,
  seg: Extract<Segment, { kind: "plan-scene" }>,
  t: number, headline: string, accent: string,
) {
  if (seg.slide.kind === "video") ensureVideoPlaying(seg.slide);
  const s = seg.slide;

  if (seg.position === "hook") {
    // Fast zoom reveal — scroll-stopping.
    const scale = 1.35 - easeOutExpo(t) * 0.35;
    drawScaledAround(ctx, s.el, s.srcW, s.srcH, scale, 0, 0);
    drawColorGrade(ctx, "cinematic");
    drawVignette(ctx, 0.65);
    drawTopGradient(ctx); drawBottomGradient(ctx);
    drawCinematicBars(ctx, Math.min(t * 4, 1));
    if (t < 0.08) { ctx.fillStyle = `rgba(0,0,0,${1 - t / 0.08})`; ctx.fillRect(0, 0, W, H); }
    if (t > 0.4) drawBrandBadge(ctx, headline, (t - 0.4) / 0.6, accent);
    return;
  }

  if (seg.position === "climax") {
    const scale = 1.0 + t * 0.08;
    drawScaledAround(ctx, s.el, s.srcW, s.srcH, scale, 0, 0);
    drawColorGrade(ctx, "luxury");
    drawVignette(ctx, 0.55);
    drawTopGradient(ctx); drawBottomGradient(ctx);
    drawCinematicBars(ctx, 1);
    drawBrandBadge(ctx, headline, 1, accent);
    drawGlow(ctx, W / 2, 1800, 400, "123,47,190", 0.15 + Math.sin(t * Math.PI) * 0.1);
    if (seg.showSubtitle) drawAnimatedSubtitle(ctx, seg.subtitle, t, accent);
    return;
  }

  if (seg.position === "close") {
    const scale = 1.12 - t * 0.08;
    drawScaledAround(ctx, s.el, s.srcW, s.srcH, scale, 0, 0);
    drawColorGrade(ctx, "luxury");
    drawVignette(ctx, 0.70);
    drawTopGradient(ctx); drawBottomGradient(ctx);
    drawCinematicBars(ctx, 1);
    if (t > 0.3) {
      const bt = Math.min((t - 0.3) / 0.4, 1);
      const slideUp = (1 - easeOutExpo(bt)) * 50;
      ctx.save();
      ctx.globalAlpha = bt;
      ctx.fillStyle = "#FFD60A";
      ctx.font = 'bold 64px Inter, "Arial Black", Arial, sans-serif';
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 20;
      ctx.fillText(headline.toUpperCase(), W / 2, H / 2 - 40 + slideUp);
      ctx.restore();
    }
    if (t > 0.5) {
      const et = Math.min((t - 0.5) / 0.35, 1);
      ctx.save();
      ctx.globalAlpha = et * 0.85;
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "32px Inter, Arial, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(seg.eventName, W / 2, H / 2 + 30);
      ctx.restore();
    }
    drawGlow(ctx, W / 2, 1750, 500, "123,47,190", 0.25 * Math.min(t * 2, 1));
    return;
  }

  // BUILD
  const d = BUILD_PANS[seg.sceneIdx % BUILD_PANS.length];
  const k = easeInOutCubic(t);
  drawScaledAround(ctx, s.el, s.srcW, s.srcH,
    lerp(d.fs, d.ts, k), lerp(d.fx, d.tx, k), lerp(d.fy, d.ty, k));
  drawColorGrade(ctx, "cinematic");
  drawVignette(ctx, 0.50);
  drawTopGradient(ctx); drawBottomGradient(ctx);
  drawCinematicBars(ctx, 1);
  drawBrandBadge(ctx, headline, 1, accent);
  drawProgressBar(ctx, seg.sceneIdx + 1, seg.totalScenes, t, accent);
  if (seg.showSubtitle) drawAnimatedSubtitle(ctx, seg.subtitle, t, accent);
}


function renderSegmentFrame(
  ctx: CanvasRenderingContext2D, seg: Segment, f: number,
  headline: string, accent: string, style: EditStyle,
) {
  const t = seg.frames <= 1 ? 1 : f / seg.frames;

  switch (seg.kind) {
    case "hook": {
      const ease = easeOutExpo(t);
      const scale = 1.4 - ease * 0.4;
      if (seg.slide.kind === "video") ensureVideoPlaying(seg.slide);
      drawScaledAround(ctx, seg.slide.el, seg.slide.srcW, seg.slide.srcH, scale, 0, 0);
      drawColorGrade(ctx, style.colorGradeHook);
      drawVignette(ctx, 0.5);
      drawTopGradient(ctx); drawBottomGradient(ctx);
      drawCinematicBars(ctx, Math.min(t * 3, 1));
      drawBrandBadge(ctx, headline, t, accent);
      drawGlow(ctx, W/2, 1800, 400, "123,47,190", 0.3 * t);
      drawPacedCaption(ctx, seg.phrases, f, seg.frames, seg.beatFrames, seg.tailFrames, 1680, "#FFFFFF", 46);
      return;
    }
    case "scene": {
      if (seg.slide.kind === "video") ensureVideoPlaying(seg.slide);
      if (seg.mode === "cinematic") {
        const dirs = [
          { fx:-20,tx:20, fy:-10,ty:10, fs:1.05,ts:1.22 },
          { fx:20,tx:-20, fy:10,ty:-10, fs:1.22,ts:1.05 },
          { fx:0, tx:0,  fy:-30,ty:5,  fs:1.10,ts:1.28 },
        ];
        const d = dirs[seg.sceneIdx % dirs.length];
        const k = easeInOutCubic(t);
        drawScaledAround(ctx, seg.slide.el, seg.slide.srcW, seg.slide.srcH,
          lerp(d.fs, d.ts, k), lerp(d.fx, d.tx, k), lerp(d.fy, d.ty, k));
      } else {
        const drift = lerp(-35, 35, t);
        const pulse = 1 + Math.sin(t * Math.PI) * 0.04;
        drawScaledAround(ctx, seg.slide.el, seg.slide.srcW, seg.slide.srcH, pulse, drift, 0);
      }
      drawColorGrade(ctx, seg.grade);
      drawVignette(ctx, 0.5);
      drawTopGradient(ctx); drawBottomGradient(ctx);
      drawCinematicBars(ctx, 1);
      drawBrandBadge(ctx, headline, 1, accent);
      drawPacedCaption(ctx, seg.phrases, f, seg.frames, seg.beatFrames, seg.tailFrames, 1700, "#FFFFFF", 44);
      drawProgressBar(ctx, seg.sceneIdx + 1, seg.totalScenes, t, accent);
      return;
    }
    case "flash": {
      // White-out flash: in then out
      const a = t < 0.5 ? easeInExpo(t * 2) : 1 - easeOutExpo((t - 0.5) * 2);
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0, Math.min(1, a * 0.95))})`;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    case "fade-out": {
      ctx.fillStyle = `rgba(0,0,0,${easeInOutCubic(t)})`;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    case "fade-in": {
      // Caller is expected to draw a background first if needed; here we render full black fade.
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(0,0,0,${1 - easeInOutCubic(t)})`;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    case "zoom-burst": {
      if (seg.slide.kind === "video") ensureVideoPlaying(seg.slide);
      let scale: number;
      if (t < 0.3) scale = 1 + easeInExpo(t / 0.3) * 0.4;
      else         scale = 1.4 - easeOutExpo((t - 0.3) / 0.7) * 0.3;
      drawScaledAround(ctx, seg.slide.el, seg.slide.srcW, seg.slide.srcH, scale, 0, 0);
      drawChromaticFlash(ctx, t < 0.2 ? (1 - t / 0.2) : 0);
      drawColorGrade(ctx, "cinematic");
      drawVignette(ctx, 0.6);
      drawCinematicBars(ctx, 1);
      return;
    }
    case "closing": {
      if (seg.slide.kind === "video") ensureVideoPlaying(seg.slide);
      const scale = 1.18 - t * 0.13;
      drawScaledAround(ctx, seg.slide.el, seg.slide.srcW, seg.slide.srcH, scale, 0, 0);
      drawColorGrade(ctx, style.colorGradeClose);
      drawVignette(ctx, 0.7);
      drawTopGradient(ctx); drawBottomGradient(ctx);
      drawCinematicBars(ctx, 1);
      drawGlow(ctx, W/2, 1800, 500, "123,47,190", 0.4 * Math.min(t * 3, 1));
      drawAnimatedTitle(ctx, seg.eventName.toUpperCase(), Math.min(t * 2, 1), 900, "#FFD60A", 58);
      if (t > 0.45) {
        const a = Math.min((t - 0.45) * 4, 1);
        ctx.save(); ctx.globalAlpha = a * 0.65;
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "24px Inter, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Cinematic reel", W/2, 980);
        ctx.restore();
      }
      drawBrandBadge(ctx, headline, 1, accent);
      // tail fade-out in last 15% of the closing scene
      if (t > 0.85) {
        const a = (t - 0.85) / 0.15;
        ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, W, H);
      }
      return;
    }
    case "plan-scene": {
      renderPlanScene(ctx, seg, t, headline, accent);
      return;
    }
    case "clean-cut": {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      return;
    }
    case "dramatic-fade": {
      const a = easeInOutCubic(t);
      ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(123,47,190,${a * 0.15})`; ctx.fillRect(0, 0, W, H);
      return;
    }
    case "smooth-slide": {
      if (seg.slide.kind === "video") ensureVideoPlaying(seg.slide);
      const k = easeInOutCubic(t);
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W - k * W, 0);
      drawCover(ctx, seg.slide.el, seg.slide.srcW, seg.slide.srcH, 1, 0, 0);
      ctx.restore();
      drawColorGrade(ctx, "cinematic");
      drawVignette(ctx, 0.5);
      drawCinematicBars(ctx, 1);
      return;
    }
  }
}

// ─── AI-planned reel (Drawback 3) ──────────────────────────────────────────
async function generatePlannedReel(
  input: ReelInput,
  plan: ReelEditPlan,
  onProgress: ReelProgress,
): Promise<{ blob: Blob; durationSec: number }> {
  const { headline, mood, platform, brandColor } = input;
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Your browser does not support MediaRecorder. Try Chrome, Edge or Firefox.");
  }
  const platMeta = REEL_PLATFORMS.find(p => p.id === platform)!;
  const accent = brandColor && /^#[0-9a-fA-F]{3,8}$/.test(brandColor) ? brandColor : "#7B2FBE";
  const style = styleForMood(mood);
  const eventName = input.eventName || headline;

  // Load the media for each planned scene (fresh signed URLs come from the caller).
  onProgress("Loading media…", 4);
  const loadedScenes: { scene: ReelEditPlan["scenes"][number]; slide: LoadedSlide }[] = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    const sc = plan.scenes[i];
    try {
      if (sc.asset.kind === "video") {
        const v = await loadVideo(sc.asset.signedUrl);
        loadedScenes.push({ scene: sc, slide: { kind: "video", el: v, srcW: v.videoWidth || W, srcH: v.videoHeight || H } });
      } else {
        const img = await loadImage(sc.asset.signedUrl);
        loadedScenes.push({ scene: sc, slide: { kind: "image", el: img, srcW: img.width, srcH: img.height } });
      }
    } catch (e) { console.warn("[reelEngine] skipping planned scene", sc.asset.id, e); }
    onProgress(`Loading ${i + 1}/${plan.scenes.length}`, 4 + Math.round(((i + 1) / plan.scenes.length) * 18));
  }
  if (loadedScenes.length === 0) throw new Error("Could not load any media (CORS or network).");

  const TRANS_FRAMES: Record<TransitionType, number> = {
    flash: Math.round(0.2 * FPS),
    zoom_burst: Math.round(0.3 * FPS),
    cinematic_fade: Math.round(0.4 * FPS),
    smooth_slide: Math.round(0.35 * FPS),
    clean_cut: Math.round(0.1 * FPS),
    dramatic_fade: Math.round(0.7 * FPS),
  };

  const timeline: Segment[] = [];
  loadedScenes.forEach((entry, i) => {
    const { scene, slide } = entry;
    timeline.push({
      kind: "plan-scene", slide,
      frames: Math.max(1, Math.round(scene.duration * FPS)),
      position: scene.position,
      subtitle: scene.subtitleText,
      showSubtitle: scene.showSubtitle,
      sceneIdx: i,
      totalScenes: loadedScenes.length,
      eventName,
    });
    const next = loadedScenes[i + 1];
    if (!next) return;
    const frames = TRANS_FRAMES[scene.transition] ?? TRANS_FRAMES.cinematic_fade;
    switch (scene.transition) {
      case "flash":       timeline.push({ kind: "flash", frames }); break;
      case "zoom_burst":  timeline.push({ kind: "zoom-burst", slide: next.slide, frames }); break;
      case "smooth_slide":timeline.push({ kind: "smooth-slide", slide: next.slide, frames }); break;
      case "clean_cut":   timeline.push({ kind: "clean-cut", frames }); break;
      case "dramatic_fade": timeline.push({ kind: "dramatic-fade", frames }); break;
      case "cinematic_fade":
      default:
        timeline.push({ kind: "fade-out", frames: Math.round(frames / 2) });
        timeline.push({ kind: "fade-in",  frames: Math.round(frames / 2) });
    }
  });
  // Closing fade to black
  timeline.push({ kind: "dramatic-fade", frames: Math.round(0.8 * FPS) });

  let totalFrames = timeline.reduce((s, seg) => s + seg.frames, 0);
  const maxFrames = Math.floor(platMeta.maxDur * FPS);
  if (totalFrames > maxFrames) {
    const k = maxFrames / totalFrames;
    timeline.forEach(seg => { seg.frames = Math.max(1, Math.round(seg.frames * k)); });
    totalFrames = timeline.reduce((s, seg) => s + seg.frames, 0);
  }
  const plannedDur = totalFrames / FPS;

  onProgress("Composing soundtrack…", 24);
  const musicBlob = await generateMoodMusic(mood, plannedDur + 0.5);

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");
  renderSegmentFrame(ctx, timeline[0], 0, headline, accent, style);

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

  onProgress("Rendering AI-edited reel…", 28);
  recorder.start(250);
  audio.start();
  loadedScenes.forEach(({ slide }) => {
    if (slide.kind === "video") { try { void slide.el.play(); } catch { /* */ } }
  });

  const STATUS: Record<NarrativePosition, string> = {
    hook: "Rendering opening hook…",
    build: "Rendering build scene…",
    climax: "Rendering key moment…",
    close: "Rendering closing sequence…",
  };

  const frameMs = 1000 / FPS;
  const t0 = performance.now();
  let globalFrame = 0;
  for (let segIdx = 0; segIdx < timeline.length; segIdx++) {
    const seg = timeline[segIdx];
    if (seg.kind === "plan-scene") onProgress(STATUS[seg.position], Math.min(93, 28 + Math.round((globalFrame / totalFrames) * 65)));
    for (let f = 0; f < seg.frames; f++) {
      renderSegmentFrame(ctx, seg, f, headline, accent, style);
      const targetMs = (globalFrame + 1) * frameMs;
      const wait = targetMs - (performance.now() - t0);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      globalFrame++;
      if (globalFrame % FPS === 0) {
        onProgress(`Rendering ${Math.round((globalFrame / totalFrames) * 100)}%…`,
          Math.min(93, 28 + Math.round((globalFrame / totalFrames) * 65)));
      }
    }
  }

  await new Promise(r => setTimeout(r, 500));
  onProgress("Finalizing…", 96);
  recorder.stop();
  const blob = await stopped;
  audio.stop();
  loadedScenes.forEach(({ slide }) => { if (slide.kind === "video") { try { slide.el.pause(); } catch { /* */ } } });
  onProgress("Done", 100);
  return { blob, durationSec: plannedDur };
}

// ─── main ──────────────────────────────────────────────────────────────────
export async function generateReel(
  input: ReelInput,
  onProgress: ReelProgress,
): Promise<{ blob: Blob; durationSec: number }> {
  if (input.editPlan && input.editPlan.scenes.length > 0) {
    return generatePlannedReel(input, input.editPlan, onProgress);
  }
  const { slides, captions, headline, mood, platform, secondsPerSlide, brandColor } = input;
  if (!slides || slides.length === 0) throw new Error("No media selected");

  if (typeof MediaRecorder === "undefined") {
    throw new Error("Your browser does not support MediaRecorder. Try Chrome, Edge or Firefox.");
  }

  const platMeta = REEL_PLATFORMS.find(p => p.id === platform)!;
  const accent = brandColor && /^#[0-9a-fA-F]{3,8}$/.test(brandColor) ? brandColor : "#7B2FBE";
  const style = styleForMood(mood);

  // Load all media
  onProgress("Loading media…", 4);
  const loaded: LoadedSlide[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    try {
      if (s.kind === "video") {
        const v = await loadVideo(s.url);
        loaded.push({ kind: "video", el: v, srcW: v.videoWidth || W, srcH: v.videoHeight || H });
      } else {
        const img = await loadImage(s.url);
        loaded.push({ kind: "image", el: img, srcW: img.width, srcH: img.height });
      }
    } catch (e) { console.warn("[reelEngine] skipping slide", s, e); }
    onProgress(`Loading ${i + 1}/${slides.length}`, 4 + Math.round((i + 1) / slides.length * 18));
  }
  if (loaded.length === 0) throw new Error("Could not load any media (CORS or network).");

  // Build timeline (beat-aware)
  const bpm = BPM_BY_MOOD[mood] ?? 90;
  const beatFrames = Math.max(1, Math.round((60 / bpm) * FPS));
  
  const snapBeats = (sec: number, minBeats = 2) => {
    const want = Math.max(1, Math.round(sec * FPS));
    const beats = Math.max(minBeats, Math.ceil(want / beatFrames));
    return beats * beatFrames;
  };
  const halfBeat = Math.max(1, Math.round(beatFrames / 2));
  const snapHalf = (sec: number) => {
    const want = Math.max(1, Math.round(sec * FPS));
    return Math.max(halfBeat, Math.round(want / halfBeat) * halfBeat);
  };
  const transFlash = snapHalf(style.transFlashMs / 1000);
  const transFadeOut = snapHalf((style.transFadeMs / 1000) * 0.55);
  const transFadeIn  = snapHalf((style.transFadeMs / 1000) * 0.55);
  const transZoom   = snapBeats(style.transZoomMs / 1000, 2);

  // Reserve a 1-beat tail at the end of every captioned segment so the last
  // sentence fully fades out BEFORE the next transition starts.
  const tailFrames = beatFrames;

  const timeline: Segment[] = [];
  // HOOK
  const hookSlide = loaded[0];
  const hookFrames = snapBeats(Math.min(style.hookDuration, Math.max(1.2, secondsPerSlide)), 2);
  const hookCaption = captions[0] ?? "";
  timeline.push({
    kind: "hook", slide: hookSlide, frames: hookFrames, caption: hookCaption,
    phrases: splitPhrases(hookCaption), beatFrames, tailFrames,
  });

  // MIDDLE scenes (slides 1..N-2 if >=3 slides, else fall through; closing handles last)
  const middleSlides = loaded.length >= 3 ? loaded.slice(1, -1) : loaded.slice(1);
  const closingSlide = loaded.length >= 2 ? loaded[loaded.length - 1] : loaded[0];

  const totalScenes = middleSlides.length;
  middleSlides.forEach((slide, i) => {
    // transition into this scene
    const tType = style.transitions[i % style.transitions.length];
    if (tType === "flash") {
      timeline.push({ kind: "flash", frames: transFlash });
    } else if (tType === "zoom") {
      timeline.push({ kind: "zoom-burst", slide, frames: transZoom });
    } else {
      timeline.push({ kind: "fade-out", frames: transFadeOut });
      timeline.push({ kind: "fade-in",  frames: transFadeIn  });
    }
    const isEven = i % 2 === 0;
    const sceneSecs = Math.max(1.5, secondsPerSlide);
    const sceneCaption = captions[i + 1] ?? captions[0] ?? "";
    const phrases = splitPhrases(sceneCaption);
    // Make sure scene length fits at least (phrases × 2 beats) + tail.
    const minBeats = Math.max(2, phrases.length * 2 + 1);
    const sceneFrames = Math.max(snapBeats(sceneSecs, 2), minBeats * beatFrames);
    timeline.push({
      kind: "scene", slide,
      frames: sceneFrames,
      caption: sceneCaption,
      phrases, beatFrames, tailFrames,
      mode: isEven ? "cinematic" : "energy",
      sceneIdx: i, totalScenes,
      grade: isEven ? style.colorGradeEven : style.colorGradeOdd,
    });
  });

  // Final flash before closing
  if (loaded.length >= 2) {
    timeline.push({ kind: "flash", frames: transFlash });
    timeline.push({
      kind: "closing", slide: closingSlide,
      frames: snapBeats(style.closingDuration, 4),
      eventName: headline, brandColor: accent,
    });
  }

  // Honor platform max duration
  let totalFrames = timeline.reduce((s, seg) => s + seg.frames, 0);
  const maxFrames = Math.floor(platMeta.maxDur * FPS);
  if (totalFrames > maxFrames) {
    const k = maxFrames / totalFrames;
    timeline.forEach(seg => { seg.frames = Math.max(1, Math.round(seg.frames * k)); });
    totalFrames = timeline.reduce((s, seg) => s + seg.frames, 0);
  }
  const plannedDur = totalFrames / FPS;

  // Audio
  onProgress("Composing soundtrack…", 24);
  const musicBlob = await generateMoodMusic(mood, plannedDur + 0.5);

  // Canvas + recorder
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");

  // Prime first frame so the stream starts on something visual
  renderSegmentFrame(ctx, timeline[0], 0, headline, accent, style);

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

  onProgress("Rendering cinematic reel…", 28);
  recorder.start(250);
  audio.start();

  // Kick off any videos that will be needed
  loaded.forEach(s => { if (s.kind === "video") { try { s.el.play().catch(() => undefined); } catch { /* */ } } });

  const frameMs = 1000 / FPS;
  const t0 = performance.now();
  let globalFrame = 0;

  for (let segIdx = 0; segIdx < timeline.length; segIdx++) {
    const seg = timeline[segIdx];
    for (let f2 = 0; f2 < seg.frames; f2++) {
      renderSegmentFrame(ctx, seg, f2, headline, accent, style);

      const targetMs = (globalFrame + 1) * frameMs;
      const elapsed = performance.now() - t0;
      const wait = targetMs - elapsed;
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      globalFrame++;
      if (globalFrame % FPS === 0) {
        const pct = 28 + Math.round((globalFrame / totalFrames) * 65);
        onProgress(`Rendering ${segIdx + 1}/${timeline.length}…`, Math.min(93, pct));
      }
    }
  }

  // Tail so the recorder captures the last frames
  await new Promise(r => setTimeout(r, 500));

  onProgress("Finalizing…", 96);
  recorder.stop();
  const blob = await stopped;
  audio.stop();

  // Pause any video elements
  loaded.forEach(s => { if (s.kind === "video") { try { s.el.pause(); } catch { /* */ } } });

  onProgress("Done", 100);
  return { blob, durationSec: plannedDur };
}
