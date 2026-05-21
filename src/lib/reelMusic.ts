// Procedural mood music — generates a WAV Blob via OfflineAudioContext.
// No external assets required; ships entirely in the bundle.

export type Mood = "cinematic" | "energetic" | "corporate" | "upbeat";

export const MOODS: { id: Mood; label: string; description: string }[] = [
  { id: "cinematic", label: "Cinematic", description: "Slow pads, wide & emotional" },
  { id: "energetic", label: "Energetic", description: "Driving pulse, fast tempo" },
  { id: "corporate", label: "Corporate", description: "Clean, measured, professional" },
  { id: "upbeat",    label: "Upbeat",    description: "Bright, friendly, bouncy" },
];

const SR = 44100;

function noteHz(midi: number) { return 440 * Math.pow(2, (midi - 69) / 12); }

function adsr(t: number, dur: number, a = 0.01, d = 0.1, s = 0.7, r = 0.2) {
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < dur - r) return s;
  if (t < dur) return s * (1 - (t - (dur - r)) / r);
  return 0;
}

type Voice = (t: number, freq: number) => number;
const sine: Voice = (t, f) => Math.sin(2 * Math.PI * f * t);
const tri: Voice = (t, f) => {
  const x = (t * f) % 1;
  return 4 * Math.abs(x - 0.5) - 1;
};
const saw: Voice = (t, f) => 2 * ((t * f) % 1) - 1;

function addNote(buf: Float32Array, startSec: number, durSec: number, midi: number, gain: number, voice: Voice) {
  const start = Math.floor(startSec * SR);
  const end = Math.min(buf.length, start + Math.floor(durSec * SR));
  const f = noteHz(midi);
  for (let i = start; i < end; i++) {
    const t = (i - start) / SR;
    buf[i] += voice(t, f) * adsr(t, durSec) * gain;
  }
}

function addKick(buf: Float32Array, startSec: number) {
  const start = Math.floor(startSec * SR);
  const len = Math.floor(0.18 * SR);
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const t = i / SR;
    const f = 110 * Math.exp(-t * 25) + 50;
    buf[start + i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 8) * 0.55;
  }
}

function addHat(buf: Float32Array, startSec: number) {
  const start = Math.floor(startSec * SR);
  const len = Math.floor(0.05 * SR);
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const t = i / SR;
    buf[start + i] += (Math.random() * 2 - 1) * Math.exp(-t * 60) * 0.18;
  }
}

// Mood definitions: scale (semitones from root), bpm, voice, drums
const PRESETS: Record<Mood, {
  root: number; scale: number[]; bpm: number; voice: Voice; pad: boolean; drums: "soft" | "driving" | "off" | "light";
}> = {
  cinematic: { root: 55, scale: [0, 3, 7, 10, 12, 15], bpm: 70,  voice: sine, pad: true,  drums: "off" },
  energetic: { root: 57, scale: [0, 3, 5, 7, 10, 12], bpm: 124, voice: saw,  pad: false, drums: "driving" },
  corporate: { root: 60, scale: [0, 4, 7, 11, 12],     bpm: 92,  voice: tri,  pad: true,  drums: "light" },
  upbeat:    { root: 62, scale: [0, 2, 4, 7, 9, 12],   bpm: 110, voice: tri,  pad: false, drums: "soft" },
};

export async function generateMoodMusic(mood: Mood, durationSec: number): Promise<Blob> {
  const p = PRESETS[mood];
  const total = Math.ceil(durationSec * SR);
  const left = new Float32Array(total);
  const right = new Float32Array(total);

  const beat = 60 / p.bpm;
  const stepDur = beat / 2; // 8th notes

  // Bass line (root, fifth, octave wandering)
  for (let t = 0; t < durationSec; t += beat) {
    const deg = [0, 0, 7, 0, 5, 0, 7, 3][Math.floor(t / beat) % 8];
    addNote(left, t, beat * 0.95, p.root - 12 + deg, 0.22, sine);
    addNote(right, t, beat * 0.95, p.root - 12 + deg, 0.22, sine);
  }

  // Lead arpeggio
  let step = 0;
  for (let t = 0; t < durationSec; t += stepDur) {
    const deg = p.scale[step % p.scale.length];
    const oct = step % 3 === 0 ? 12 : 0;
    addNote(left, t, stepDur * 1.4, p.root + deg + oct, 0.16, p.voice);
    addNote(right, t, stepDur * 1.4, p.root + deg + oct + (step % 2 === 0 ? 0 : 7), 0.14, p.voice);
    step++;
  }

  // Pad (sustained chord)
  if (p.pad) {
    const chord = [0, p.scale[1] ?? 4, p.scale[2] ?? 7];
    for (const d of chord) {
      addNote(left, 0, durationSec, p.root + d, 0.10, sine);
      addNote(right, 0, durationSec, p.root + d + 12, 0.08, sine);
    }
  }

  // Drums
  if (p.drums !== "off") {
    for (let t = 0; t < durationSec; t += beat) {
      const beatIdx = Math.round(t / beat);
      if (p.drums === "driving") { addKick(left, t); addKick(right, t); }
      else if (p.drums === "soft" && beatIdx % 2 === 0) { addKick(left, t); addKick(right, t); }
      else if (p.drums === "light" && beatIdx % 4 === 0) { addKick(left, t); addKick(right, t); }
    }
    for (let t = 0; t < durationSec; t += stepDur) {
      if (p.drums === "driving" || p.drums === "soft") { addHat(left, t); addHat(right, t); }
    }
  }

  // Soft master limiter
  const limit = 0.85;
  for (let i = 0; i < total; i++) {
    if (left[i] > limit) left[i] = limit; else if (left[i] < -limit) left[i] = -limit;
    if (right[i] > limit) right[i] = limit; else if (right[i] < -limit) right[i] = -limit;
  }

  // Fade in/out
  const fadeLen = Math.min(SR, total / 4);
  for (let i = 0; i < fadeLen; i++) {
    const g = i / fadeLen;
    left[i] *= g; right[i] *= g;
    left[total - 1 - i] *= g; right[total - 1 - i] *= g;
  }

  return encodeWav(left, right, SR);
}

function encodeWav(l: Float32Array, r: Float32Array, sr: number): Blob {
  const n = l.length;
  const bytesPerSample = 2;
  const blockAlign = 2 * bytesPerSample;
  const dataSize = n * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  let p = 0;
  const ws = (s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(p++, s.charCodeAt(i)); };
  const w32 = (x: number) => { v.setUint32(p, x, true); p += 4; };
  const w16 = (x: number) => { v.setUint16(p, x, true); p += 2; };
  ws("RIFF"); w32(36 + dataSize); ws("WAVE");
  ws("fmt "); w32(16); w16(1); w16(2); w32(sr); w32(sr * blockAlign); w16(blockAlign); w16(16);
  ws("data"); w32(dataSize);
  for (let i = 0; i < n; i++) {
    const sl = Math.max(-1, Math.min(1, l[i])); const sr2 = Math.max(-1, Math.min(1, r[i]));
    v.setInt16(p, sl < 0 ? sl * 0x8000 : sl * 0x7FFF, true); p += 2;
    v.setInt16(p, sr2 < 0 ? sr2 * 0x8000 : sr2 * 0x7FFF, true); p += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}
