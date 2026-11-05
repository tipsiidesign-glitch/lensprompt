/** The bundled selfie model has one confidence mask, labelled "selfie". */
export function writePersonAlpha(
  confidence: Float32Array,
  previous: Float32Array,
  pixels: Uint8ClampedArray,
) {
  if (previous.length !== confidence.length || pixels.length !== confidence.length * 4) {
    throw new Error("Person mask dimensions do not match.");
  }
  for (let i = 0; i < confidence.length; i++) {
    const current = confidence[i] ?? 0;
    const smoothed = (previous[i] ?? current) * 0.35 + current * 0.65;
    previous[i] = smoothed;
    const alpha = Number.isFinite(smoothed) ? Math.max(0, Math.min(1, (smoothed - 0.3) / 0.45)) : 0;
    pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = 255;
    pixels[i * 4 + 3] = Math.round(alpha * 255);
  }
}