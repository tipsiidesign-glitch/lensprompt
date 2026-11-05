import { expect, test } from "bun:test";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { buildPairUrl, isValidSession, makeSessionId } from "../src/lib/pairing";

function decode(text: string): string | undefined {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size, scale = 4, margin = 4, size = (n + margin * 2) * scale;
  const px = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!qr.modules.get(x, y)) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + margin) * scale + dy) * size + (x + margin) * scale + dx) * 4;
      px[i] = px[i + 1] = px[i + 2] = 0;
    }
  }
  return jsQR(px, size, size)?.data;
}

test("QR decodes to the exact public HTTPS pairing URL with a valid session", () => {
  const id = makeSessionId();
  expect(isValidSession(id)).toBe(true);
  const url = buildPairUrl("https://id-preview--abc.lovable.app", id);
  expect(url).toBe(`https://lensprompt-irshad-2026.lovable.app/pair?session=${id}`);
  expect(decode(url)).toBe(url);
});

test("public HTTPS origins are kept as-is", () => {
  expect(buildPairUrl("https://example.com", "abcdefabcdef")).toBe("https://example.com/pair?session=abcdefabcdef");
});
