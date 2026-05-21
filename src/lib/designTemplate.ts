// Auto Design Templates — render a branded social card on a canvas.
// Pure client-side, no backend dependency. Falls back to original image if anything fails.

export type DesignFormat = "1:1" | "9:16" | "16:9";

const DIMS: Record<DesignFormat, { w: number; h: number }> = {
  "1:1": { w: 1080, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1200, h: 675 },
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = w;
      if (lines.length === maxLines - 1) break;
    } else {
      current = test;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  // Truncate last with ellipsis if needed
  const remaining = words.slice(lines.join(" ").split(" ").length).join(" ");
  if (remaining && lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(last + "…").width > maxWidth && last.length > 0) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = last + "…";
  }
  return lines;
}

export interface DesignOptions {
  imageUrl: string;
  caption: string;
  format: DesignFormat;
  brandColor?: string;
  brandName?: string;
  platform?: string;
}

export async function renderDesignedPost(opts: DesignOptions): Promise<Blob> {
  const { w, h } = DIMS[opts.format] ?? DIMS["1:1"];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const brand = opts.brandColor || "#111111";

  // Background
  ctx.fillStyle = "#0f0f0f";
  ctx.fillRect(0, 0, w, h);

  // Background image (cover)
  try {
    const img = await loadImage(opts.imageUrl);
    const ir = img.width / img.height;
    const cr = w / h;
    let dw = w, dh = h, dx = 0, dy = 0;
    if (ir > cr) { dh = h; dw = h * ir; dx = (w - dw) / 2; }
    else { dw = w; dh = w / ir; dy = (h - dh) / 2; }
    ctx.drawImage(img, dx, dy, dw, dh);
  } catch {
    // keep solid bg
  }

  // Bottom gradient overlay for text readability
  const gradH = Math.round(h * 0.55);
  const grad = ctx.createLinearGradient(0, h - gradH, 0, h);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.85)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - gradH, w, gradH);

  // Brand accent bar
  ctx.fillStyle = brand;
  ctx.fillRect(0, h - 8, w, 8);

  // Logo placeholder (top-left): brand-color circle + brand name
  const padding = Math.round(w * 0.05);
  const dotR = Math.round(w * 0.022);
  ctx.fillStyle = brand;
  ctx.beginPath();
  ctx.arc(padding + dotR, padding + dotR, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${Math.round(w * 0.028)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText((opts.brandName || "AutoEvent").toUpperCase(), padding + dotR * 2 + 16, padding + dotR);

  // Platform tag (top-right)
  if (opts.platform) {
    const tag = opts.platform.toUpperCase();
    ctx.font = `500 ${Math.round(w * 0.022)}px system-ui, sans-serif`;
    const tw = ctx.measureText(tag).width;
    const tagPadX = 20, tagPadY = 12;
    const tagW = tw + tagPadX * 2;
    const tagH = Math.round(w * 0.022) + tagPadY * 2;
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 2;
    const tx = w - padding - tagW, ty = padding;
    ctx.beginPath();
    const r = tagH / 2;
    ctx.moveTo(tx + r, ty);
    ctx.arcTo(tx + tagW, ty, tx + tagW, ty + tagH, r);
    ctx.arcTo(tx + tagW, ty + tagH, tx, ty + tagH, r);
    ctx.arcTo(tx, ty + tagH, tx, ty, r);
    ctx.arcTo(tx, ty, tx + tagW, ty, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(tag, tx + tagPadX, ty + tagH / 2);
  }

  // Caption block (bottom)
  const captionMaxWidth = w - padding * 2;
  const firstSentence = (opts.caption || "").split(/(?<=[.!?])\s+/)[0] || opts.caption || "";
  const headlineText = firstSentence.length > 120 ? firstSentence.slice(0, 117) + "…" : firstSentence;

  // Headline (large)
  const headlineSize = Math.round(w * 0.055);
  ctx.font = `700 ${headlineSize}px Georgia, "Times New Roman", serif`;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  const headlineLines = wrapText(ctx, headlineText, captionMaxWidth, 3);
  const headlineLineHeight = Math.round(headlineSize * 1.15);
  const headlineBlockH = headlineLines.length * headlineLineHeight;

  // Subtext (rest of caption, smaller)
  const restText = (opts.caption || "").slice(firstSentence.length).trim();
  const subSize = Math.round(w * 0.026);
  ctx.font = `400 ${subSize}px system-ui, sans-serif`;
  const subLines = restText ? wrapText(ctx, restText, captionMaxWidth, 2) : [];
  const subLineHeight = Math.round(subSize * 1.4);
  const subBlockH = subLines.length * subLineHeight;

  const totalTextH = headlineBlockH + (subBlockH ? subBlockH + 20 : 0);
  let y = h - padding - totalTextH - 20;

  ctx.font = `700 ${headlineSize}px Georgia, "Times New Roman", serif`;
  ctx.fillStyle = "#ffffff";
  for (const line of headlineLines) {
    y += headlineLineHeight;
    ctx.fillText(line, padding, y);
  }

  if (subLines.length) {
    y += 20;
    ctx.font = `400 ${subSize}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (const line of subLines) {
      y += subLineHeight;
      ctx.fillText(line, padding, y);
    }
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

export function formatForPlatform(platform: string, format: string): DesignFormat {
  if (format === "9:16" || format === "16:9" || format === "1:1") return format;
  if (platform === "linkedin" || platform === "twitter") return "16:9";
  return "1:1";
}
