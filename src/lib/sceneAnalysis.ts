// @ts-nocheck -- pixel-buffer math; indices are bounds-checked by loop limits
export type Swatch = { hex: string; name: string; share: number };
export type Suggestion = { title: string; text: string; colors?: string[] };
export type SceneReport = {
  background: { summary: string; swatches: Swatch[] };
  outfit: { summary: string; swatches: Swatch[]; source: "person-mask" | "frame-region" };
  lighting: { level: string; direction: string; temperature: string; contrast: string; mood: string };
  suggestions: Suggestion[];
  preset: string;
};

type RGB = [number, number, number];

const hex = ([r, g, b]: RGB) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

function hsl([r, g, b]: RGB) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function fromHsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return hex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

export function colorName(rgb: RGB) {
  const { h, s, l } = hsl(rgb);
  if (s < 0.15 || l < 0.08 || l > 0.95) {
    if (l < 0.15) return "black";
    if (l < 0.35) return "charcoal";
    if (l < 0.65) return "gray";
    if (l < 0.88) return "light gray";
    return "white";
  }
  let n =
    h < 15 || h >= 345 ? "red" : h < 40 ? "orange" : h < 65 ? "yellow" : h < 160 ? "green" : h < 195 ? "teal" : h < 250 ? "blue" : h < 290 ? "purple" : "pink";
  if ((n === "orange" || n === "red" || n === "yellow") && l < 0.4 && s < 0.7) n = "brown";
  if (n === "orange" && l > 0.65) n = "beige";
  const tone = l < 0.3 ? "dark " : l > 0.72 ? "light " : "";
  return n === "brown" || n === "beige" ? n : tone + n;
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

function relLum([r, g, b]: RGB) {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function dominant(px: Uint8ClampedArray, idx: number[]): { rgb: RGB; share: number }[] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const i of idx) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const e = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    bins.set(k, e);
  }
  const total = idx.length || 1;
  return [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .filter((e) => e.n / total >= 0.06)
    .map((e) => ({ rgb: [e.r / e.n, e.g / e.n, e.b / e.n] as RGB, share: e.n / total }));
}

const toSwatches = (d: { rgb: RGB; share: number }[]): Swatch[] =>
  d.map((x) => ({ hex: hex(x.rgb), name: colorName(x.rgb), share: x.share }));

export function analyzeFrame(video: HTMLVideoElement, mask: HTMLCanvasElement | null): SceneReport | null {
  const W = video.videoWidth, H = video.videoHeight;
  if (!W || !H) return null;
  const w = 96, h = Math.max(1, Math.round((96 * H) / W));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  let alpha: Uint8ClampedArray | null = null;
  if (mask && mask.width > 1) {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(mask, 0, 0, w, h);
    alpha = ctx.getImageData(0, 0, w, h).data;
  }

  const bg: number[] = [], outfit: number[] = [];
  let sum = 0, sumSq = 0, left = 0, right = 0, top = 0, bottom = 0, warm = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const L = luma(px[i], px[i + 1], px[i + 2]);
      sum += L; sumSq += L * L; warm += px[i] - px[i + 2];
      if (x < w / 3) left += L; else if (x >= (2 * w) / 3) right += L;
      if (y < h / 3) top += L; else if (y >= (2 * h) / 3) bottom += L;
      if (alpha) {
        const a = alpha[i + 3];
        if (a < 90) bg.push(i);
        else if (a > 170 && y > h * 0.55) outfit.push(i);
      } else {
        if (x < w * 0.15 || x > w * 0.85 || y < h * 0.18) bg.push(i);
        if (x > w * 0.3 && x < w * 0.7 && y > h * 0.68) outfit.push(i);
      }
    }
  const n = w * h;
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  const third = n / 3;
  const lr = (left - right) / third, tb = (top - bottom) / third;
  const warmth = warm / n;

  // background texture: mean abs luma diff between horizontal neighbours
  let tex = 0, texN = 0;
  for (const i of bg) {
    const j = i + 4;
    if (j < px.length && (j / 4) % w !== 0) {
      tex += Math.abs(luma(px[i], px[i + 1], px[i + 2]) - luma(px[j], px[j + 1], px[j + 2]));
      texN++;
    }
  }
  tex = texN ? tex / texN : 0;

  const bgDom = dominant(px, bg);
  const outDom = dominant(px, outfit);
  const bgSw = toSwatches(bgDom), outSw = toSwatches(outDom);

  const texture = tex > 16 ? "Busy, detailed" : tex > 8 ? "Lightly textured" : "Plain";
  const tempWord = warmth > 15 ? "warm" : warmth < -8 ? "cool" : "neutral";
  const bgSummary = bgSw.length
    ? `${texture} background, mostly ${bgSw[0].name}${bgSw[1] && bgSw[1].name !== bgSw[0].name ? ` with ${bgSw[1].name}` : ""}.`
    : "Not enough background visible to measure.";
  const outSummary = outSw.length
    ? `Mainly ${outSw[0].name}${outSw[1] && outSw[1].name !== outSw[0].name ? ` and ${outSw[1].name}` : ""}.`
    : "Could not isolate clothing pixels.";

  const level = mean < 60 ? "Dim" : mean < 100 ? "Low-key" : mean < 165 ? "Balanced" : mean < 205 ? "Bright" : "Very bright — may clip";
  const direction =
    Math.abs(lr) > 15 ? `Stronger on the ${lr > 0 ? "left" : "right"} of the camera frame` : Math.abs(tb) > 25 ? (tb > 0 ? "Mostly from above" : "Brighter low in frame") : "Fairly even";
  const contrast = sd > 62 ? "High contrast" : sd < 35 ? "Soft / flat" : "Moderate";
  const mood =
    sd > 62 ? "Dramatic, moody" : mean < 90 && tempWord === "warm" ? "Cozy, intimate" : mean > 150 && tempWord !== "warm" ? "Clean, airy" : sd < 35 ? "Soft, calm" : tempWord === "warm" ? "Friendly, warm" : "Natural, neutral";

  const suggestions: Suggestion[] = [];
  if (outDom[0]) {
    const o = hsl(outDom[0].rgb);
    if (o.s >= 0.15) {
      suggestions.push({ title: "Complementary", text: `Accents opposite your ${outSw[0].name} on the colour wheel will pop.`, colors: [fromHsl(o.h + 180, Math.max(0.45, o.s), 0.5)] });
      suggestions.push({ title: "Analogous", text: "Neighbouring hues for a calm, harmonious set.", colors: [fromHsl(o.h - 30, o.s, o.l), fromHsl(o.h + 30, o.s, o.l)] });
    } else {
      suggestions.push({ title: "Neutral outfit", text: "Neutrals pair with almost anything — a single saturated background accent adds interest.", colors: [fromHsl(200, 0.6, 0.5), fromHsl(25, 0.7, 0.55)] });
    }
    if (bgDom[0]) {
      const L1 = relLum(outDom[0].rgb), L2 = relLum(bgDom[0].rgb);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const b = hsl(bgDom[0].rgb);
      const diff = Math.abs(((o.h - b.h + 540) % 360) - 180);
      const rel = o.s < 0.15 || b.s < 0.15 ? "neutral pairing" : diff > 140 ? "complementary (high energy)" : diff < 40 ? "analogous (harmonious)" : "contrasting hues";
      suggestions.push({
        title: "Contrast",
        text:
          ratio < 1.6
            ? `Outfit and background are close in brightness (${ratio.toFixed(1)}:1, ${rel}) — you may blend in. Try a lighter/darker top or background.`
            : `Good separation from the background (${ratio.toFixed(1)}:1, ${rel}).`,
      });
    }
  }
  const preset = mean < 85 ? "Soft Light" : tempWord === "cool" ? "Warm" : sd < 35 ? "Cinematic" : warmth > 35 ? "Cool" : "Natural";
  suggestions.push({ title: "Filter", text: `Try the ${preset} preset for this lighting.` });

  return {
    background: { summary: bgSummary, swatches: bgSw },
    outfit: { summary: outSummary, swatches: outSw, source: alpha ? "person-mask" : "frame-region" },
    lighting: { level, direction, temperature: tempWord[0].toUpperCase() + tempWord.slice(1), contrast, mood },
    suggestions,
    preset,
  };
}
