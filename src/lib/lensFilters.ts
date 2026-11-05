export type FilterState = {
  preset: string;
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  grain: number;
  mono: boolean;
  bake: boolean;
};

type Values = Omit<FilterState, "preset" | "bake">;

export const FILTER_DEFAULTS: FilterState = {
  preset: "Natural",
  brightness: 100,
  contrast: 100,
  saturation: 100,
  temperature: 0,
  grain: 0,
  mono: false,
  bake: false,
};

export const PRESETS: { name: string; values: Values }[] = [
  { name: "Natural", values: { brightness: 100, contrast: 100, saturation: 100, temperature: 0, grain: 0, mono: false } },
  { name: "Soft Light", values: { brightness: 107, contrast: 88, saturation: 95, temperature: 6, grain: 0, mono: false } },
  { name: "Warm", values: { brightness: 102, contrast: 102, saturation: 110, temperature: 30, grain: 0, mono: false } },
  { name: "Cool", values: { brightness: 100, contrast: 104, saturation: 95, temperature: -30, grain: 0, mono: false } },
  { name: "Cinematic", values: { brightness: 95, contrast: 118, saturation: 82, temperature: -10, grain: 15, mono: false } },
  { name: "Grain", values: { brightness: 100, contrast: 106, saturation: 92, temperature: 0, grain: 40, mono: false } },
  { name: "B&W", values: { brightness: 100, contrast: 118, saturation: 100, temperature: 0, grain: 10, mono: true } },
];

export function cssFilter(f: FilterState) {
  return `brightness(${f.brightness / 100}) contrast(${f.contrast / 100}) saturate(${f.saturation / 100})${f.mono ? " grayscale(1)" : ""}`;
}

export function tempOverlay(t: number): string | null {
  if (!t) return null;
  const a = Math.min(0.5, (Math.abs(t) / 50) * 0.5);
  return t > 0 ? `rgba(255,140,40,${a})` : `rgba(60,140,255,${a})`;
}

let grain: HTMLCanvasElement | null = null;
let grainUrl: string | null = null;
export function grainCanvas() {
  if (grain) return grain;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas drawing is unavailable in this browser.");
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grain = c;
  return c;
}
export function grainDataUrl() {
  if (!grainUrl) grainUrl = grainCanvas().toDataURL();
  return grainUrl;
}

export function canvasFilterSupported() {
  try {
    const ctx = document.createElement("canvas").getContext("2d") as unknown as { filter?: unknown } | null;
    return !!ctx && typeof ctx.filter === "string";
  } catch {
    return false;
  }
}
