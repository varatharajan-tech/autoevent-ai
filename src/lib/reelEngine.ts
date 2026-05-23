// Reel generation engine — runs entirely in the browser using the
// Canvas API + MediaRecorder API. No ffmpeg, no WebAssembly, no external
// APIs, no keys. Renders 9:16 1080x1920 Ken-Burns slides with burned-in
// headline + per-slide captions, mixed with procedurally-generated music.

import { generateMoodMusic, type Mood } from "./reelMusic";

export type ReelPlatform = "instagram" | "youtube" | "facebook" | "twitter";

export const REEL_PLATFORMS: { id: ReelPlatform; label: string; maxDur: number }[] = [
  { id: "instagram", label: "Instagram Reels", maxDur: 90 },
  { id: "youtube",   label: "YouTube Shorts",  maxDur: 60 },
  { id: "facebook",  label: "Facebook Reels",  maxDur: 90 },
  { id: "twitter",   label: "Twitter / X",     maxDur: 60 },
];

export type ReelInput = {
  imageUrls: string[];
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

function drawSlide(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  progress: number,
  caption: string,
  headline: string,
  showHeadline: boolean,
  brandColor: string,
) {
  // Ken Burns zoom + slight pan
  const scale = 1.0 + progress * 0.15;
  const panX = progress * 30;

  const imgRatio = img.width / img.height;
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
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

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

  // Headline (first ~2.5s only)
  if (showHeadline) {
    ctx.fillStyle = "#FFD60A";
    ctx.font = "bold 64px Inter, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(headline.toUpperCase(), 50, 110);
  }

  // Caption
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
      // Fade out near end
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
  const { imageUrls, captions, headline, mood, platform, secondsPerSlide, brandColor } = input;
  if (imageUrls.length === 0) throw new Error("No images selected");
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Your browser does not support MediaRecorder. Try Chrome, Edge or Firefox.");
  }

  const platMeta = REEL_PLATFORMS.find(p => p.id === platform)!;
  const slideDur = secondsPerSlide;
  const totalDur = Math.min(platMeta.maxDur, imageUrls.length * slideDur);
  const accent = brandColor && /^#[0-9a-fA-F]{3,8}$/.test(brandColor) ? brandColor : "#7B2FBE";

  onProgress("Loading images…", 5);
  const images: HTMLImageElement[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    try {
      images.push(await loadImage(imageUrls[i]));
    } catch (e) {
      console.warn("[reelEngine] skipping image", imageUrls[i], e);
    }
    onProgress(`Loading image ${i + 1}/${imageUrls.length}`, 5 + Math.round((i + 1) / imageUrls.length * 20));
  }
  if (images.length === 0) throw new Error("Could not load any images (CORS or network).");

  onProgress("Composing soundtrack…", 28);
  const musicBlob = await generateMoodMusic(mood, totalDur + 0.5);

  // Setup canvas + streams
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");

  // Prime first frame so captureStream has content
  drawSlide(ctx, images[0], 0, captions[0] ?? "", headline, true, accent);

  const videoStream = canvas.captureStream(FPS);
  const audio = await buildAudioTrack(musicBlob, totalDur);
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
  const slideFrames = Math.round(slideDur * FPS);
  const headlineFrames = Math.round(2.5 * FPS);
  const transitionFrames = 9; // ~0.3s crossfade-to-black
  const t0 = performance.now();

  let globalFrame = 0;
  const totalFrames = images.length * slideFrames;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const caption = captions[i] ?? captions[0] ?? "";
    for (let f = 0; f < slideFrames; f++) {
      const progress = f / slideFrames;
      drawSlide(ctx, img, progress, caption, headline, i === 0 && globalFrame < headlineFrames, accent);

      // Fade-to-black tail (except last slide)
      if (i < images.length - 1 && f >= slideFrames - transitionFrames) {
        const a = (f - (slideFrames - transitionFrames)) / transitionFrames;
        ctx.fillStyle = `rgba(0,0,0,${a})`;
        ctx.fillRect(0, 0, W, H);
      }

      // Pace to wall clock
      const targetMs = (globalFrame + 1) * frameMs;
      const elapsed = performance.now() - t0;
      const wait = targetMs - elapsed;
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      globalFrame++;
      if (globalFrame % FPS === 0) {
        const pct = 32 + Math.round((globalFrame / totalFrames) * 60);
        onProgress(`Rendering ${i + 1}/${images.length}…`, Math.min(92, pct));
      }
    }
  }

  // Hold last frame briefly so the final moment is visible
  await new Promise(r => setTimeout(r, 600));

  onProgress("Finalizing…", 95);
  recorder.stop();
  const blob = await stopped;
  audio.stop();

  onProgress("Done", 100);
  return { blob, durationSec: totalDur };
}
