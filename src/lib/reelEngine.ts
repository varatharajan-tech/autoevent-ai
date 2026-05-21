// Reel generation engine — runs entirely in the browser using ffmpeg.wasm.
// Pipeline: images → 1080x1920 cover → Ken Burns zoompan → concat → music mix → burned subtitles → MP4.

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
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
  captions: string[];      // one short caption per slide (≤ ~60 chars works best)
  headline: string;        // event name / title
  mood: Mood;
  platform: ReelPlatform;
  secondsPerSlide: number; // 2.5–4 recommended
  brandColor?: string;     // hex, used as accent bar
};

export type ReelProgress = (msg: string, pct: number) => void;

const CORE_VERSION = "0.12.6";
const CORE_BASES = [
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
];
const FONT_URL = "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/inter/Inter%5Bslnt%2Cwght%5D.ttf";

let ffmpegSingleton: FFmpeg | null = null;

async function loadFromBase(ff: FFmpeg, base: string) {
  const [coreURL, wasmURL] = await Promise.all([
    toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
    toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
  ]);
  await ff.load({ coreURL, wasmURL });
}

async function getFFmpeg(onLog?: (l: string) => void): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;
  const ff = new FFmpeg();
  if (onLog) ff.on("log", ({ message }) => onLog(message));
  let lastErr: unknown = null;
  for (const base of CORE_BASES) {
    try {
      await loadFromBase(ff, base);
      ffmpegSingleton = ff;
      return ff;
    } catch (e) {
      lastErr = e;
      console.warn("[reelEngine] ffmpeg load failed from", base, e);
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "unknown");
  throw new Error(`Could not load video engine (ffmpeg.wasm). ${msg}. Check your network/adblocker and retry.`);
}

// Pre-render image to 1080x1920 cover-fit JPEG via canvas — guarantees correct size and decodable input.
async function imageUrlToCoverJpeg(url: string, w = 1080, h = 1920): Promise<Uint8Array> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`fetch failed ${res.status}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  // cover fit
  const scale = Math.max(w / bmp.width, h / bmp.height);
  const dw = bmp.width * scale, dh = bmp.height * scale;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
  bmp.close();
  const outBlob: Blob = await new Promise(r => canvas.toBlob(b => r(b!), "image/jpeg", 0.9)!);
  return new Uint8Array(await outBlob.arrayBuffer());
}

function escapeDrawtext(s: string): string {
  // ffmpeg drawtext escaping: backslash, colon, single quote, percent, comma, brackets
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function wrapCaption(s: string, maxChars = 32): string {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur ? cur + " " : "") + w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3).join("\n");
}

export async function generateReel(input: ReelInput, onProgress: ReelProgress): Promise<{ blob: Blob; durationSec: number }> {
  const { imageUrls, captions, headline, mood, platform, secondsPerSlide } = input;
  if (imageUrls.length === 0) throw new Error("No images selected");
  const platMeta = REEL_PLATFORMS.find(p => p.id === platform)!;
  const dur = Math.min(platMeta.maxDur, imageUrls.length * secondsPerSlide);
  const slideDur = dur / imageUrls.length;
  const fps = 30;

  onProgress("Loading video engine…", 5);
  const ff = await getFFmpeg();

  onProgress("Loading font…", 10);
  try {
    const fontBytes = await fetchFile(FONT_URL);
    await ff.writeFile("/font.ttf", fontBytes);
  } catch {
    throw new Error("Could not load typography. Check your connection and retry.");
  }

  onProgress("Preparing slides…", 15);
  for (let i = 0; i < imageUrls.length; i++) {
    const bytes = await imageUrlToCoverJpeg(imageUrls[i]);
    await ff.writeFile(`/img${i}.jpg`, bytes);
    onProgress(`Preparing slide ${i + 1}/${imageUrls.length}`, 15 + Math.round((i + 1) / imageUrls.length * 25));
  }

  onProgress("Composing soundtrack…", 45);
  const musicBlob = await generateMoodMusic(mood, dur);
  await ff.writeFile("/music.wav", new Uint8Array(await musicBlob.arrayBuffer()));

  // Build filtergraph
  const W = 1080, H = 1920;
  const fadeOutStart = Math.max(0, slideDur - 0.4);
  const slidesPerFrame = Math.round(slideDur * fps);
  const zoomStep = 0.0008; // gentle ken burns

  const inputs: string[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    inputs.push("-loop", "1", "-t", slideDur.toFixed(3), "-i", `/img${i}.jpg`);
  }
  inputs.push("-i", "/music.wav");

  const filterParts: string[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    // alternate zoom in / zoom out
    const zoomExpr = i % 2 === 0
      ? `min(zoom+${zoomStep},1.15)`
      : `if(lte(zoom,1.0),1.15,max(1.001,zoom-${zoomStep}))`;
    filterParts.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,zoompan=z='${zoomExpr}':d=${slidesPerFrame}:s=${W}x${H}:fps=${fps},fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.4[v${i}]`
    );
  }
  // Concat
  const concatIns = Array.from({ length: imageUrls.length }, (_, i) => `[v${i}]`).join("");
  filterParts.push(`${concatIns}concat=n=${imageUrls.length}:v=1:a=0[vc]`);

  // Subtitles + headline overlays
  const headlineEsc = escapeDrawtext(headline.toUpperCase());
  let lastLabel = "vc";
  // Headline: top, first 2.5s
  filterParts.push(
    `[${lastLabel}]drawtext=fontfile=/font.ttf:text='${headlineEsc}':fontcolor=white:fontsize=64:borderw=4:bordercolor=black@0.6:x=(w-text_w)/2:y=140:enable='between(t,0,2.5)'[h0]`
  );
  lastLabel = "h0";

  // Per-slide caption
  for (let i = 0; i < imageUrls.length; i++) {
    const cap = captions[i] ?? captions[i % Math.max(captions.length, 1)] ?? "";
    if (!cap) continue;
    const wrapped = wrapCaption(cap, 28);
    const esc = escapeDrawtext(wrapped);
    const start = i * slideDur + 0.3;
    const end = (i + 1) * slideDur - 0.3;
    const next = `c${i}`;
    filterParts.push(
      `[${lastLabel}]drawtext=fontfile=/font.ttf:text='${esc}':fontcolor=white:fontsize=52:line_spacing=10:box=1:boxcolor=black@0.45:boxborderw=24:x=(w-text_w)/2:y=h-text_h-220:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[${next}]`
    );
    lastLabel = next;
  }

  // Final relabel for clarity
  filterParts.push(`[${lastLabel}]format=yuv420p[vout]`);

  // Audio: take music input (last input index)
  const audioIdx = imageUrls.length;

  const filter = filterParts.join(";");

  onProgress("Rendering reel — this can take a minute…", 55);

  // Progress hook
  const progHandler = ({ progress }: { progress: number }) => {
    if (progress > 0 && progress <= 1) onProgress("Rendering reel…", 55 + Math.round(progress * 40));
  };
  ff.on("progress", progHandler);

  try {
    await ff.exec([
      ...inputs,
      "-filter_complex", filter,
      "-map", "[vout]",
      "-map", `${audioIdx}:a`,
      "-r", String(fps),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-profile:v", "high",
      "-level", "4.0",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      "-shortest",
      "/out.mp4",
    ]);
  } finally {
    ff.off("progress", progHandler);
  }

  onProgress("Finalizing…", 96);
  const data = (await ff.readFile("/out.mp4")) as Uint8Array;
  const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer], { type: "video/mp4" });

  // Cleanup files
  try {
    for (let i = 0; i < imageUrls.length; i++) await ff.deleteFile(`/img${i}.jpg`);
    await ff.deleteFile("/music.wav");
    await ff.deleteFile("/out.mp4");
  } catch { /* ignore */ }

  onProgress("Done", 100);
  return { blob, durationSec: dur };
}
